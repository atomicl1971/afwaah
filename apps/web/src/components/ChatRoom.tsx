import Link from "next/link";
import type { Message, Presence, TypingUser } from "@/lib/types";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { TypingIndicator } from "./TypingIndicator";
import { PresenceBar } from "./PresenceBar";
import { AccessStateBanner } from "./AccessStateBanner";
import { ShareRoomModal } from "./ShareRoomModal";
import { ReportDialog } from "./ReportDialog";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { LeaveRoomDialog } from "./LeaveRoomDialog";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { joinRoom } from "@/lib/realtime/client";
import { api } from "@/lib/api/client";
import { ArrowLeft, AlertTriangle, Share2, Timer, Users } from "lucide-react";
import { toast } from "sonner";
import type { AnonSession, Room } from "@/lib/types";
import { formatTimeLeft } from "@/lib/time";

const ROOM_EXPIRY_WARNING_MS = 15 * 60 * 1000;

export function ChatRoom({
  room,
  session,
}: {
  room: Room;
  session: AnonSession;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState<TypingUser[]>([]);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<Message | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const channelRef = useRef<ReturnType<typeof joinRoom> | null>(null);
  const expiryHandledRef = useRef(false);

  useEffect(() => {
    let active = true;
    const initialExpiresAtMs = room.expiresAt
      ? new Date(room.expiresAt).getTime()
      : null;
    const expiredOnLoad =
      initialExpiresAtMs !== null &&
      !Number.isNaN(initialExpiresAtMs) &&
      initialExpiresAtMs <= Date.now();

    if (expiredOnLoad) {
      setMessages([]);
      setTyping([]);
      setPresence([]);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    api.messages.list(room.id).then((m) => {
      if (!active) return;
      // Remap mock "me" messages to the current session identity so ownership
      // is determined by userId, never by display name.
      const remapped = m.map((msg) =>
        msg.userId === "me"
          ? {
              ...msg,
              userId: session.userId,
              displayName: session.displayName,
              displayColor: session.displayColor,
            }
          : msg,
      );
      setMessages(remapped);
      setLoading(false);
    });

    const ch = joinRoom(room.id, {
      displayColor: session.displayColor,
      displayName: session.displayName,
      token: session.token,
      userId: session.userId,
    });
    channelRef.current = ch;
    const u1 = ch.onMessage((m) =>
      setMessages((prev) =>
        prev.some((existing) => existing.id === m.id) ? prev : [...prev, m],
      ),
    );
    const u2 = ch.onTyping((list) =>
      setTyping(list.filter((t) => t.userId !== session.userId)),
    );
    const u3 = ch.onPresence((list) => setPresence(list));
    const u4 = ch.onReaction((update) =>
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== update.messageId) return message;

          const myReactions = new Set(message.myReactions);
          if (update.userId === session.userId) {
            if (update.reacted) myReactions.add(update.emoji);
            else myReactions.delete(update.emoji);
          }

          return {
            ...message,
            myReactions: Array.from(myReactions),
            reactions: update.reactionCounts,
          };
        }),
      ),
    );
    return () => {
      active = false;
      u1();
      u2();
      u3();
      u4();
      ch.leave();
    };
  }, [
    room.id,
    room.expiresAt,
    session.token,
    session.userId,
    session.displayName,
    session.displayColor,
  ]);

  useEffect(() => {
    if (!room.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [room.expiresAt]);

  const expiresAtMs = room.expiresAt
    ? new Date(room.expiresAt).getTime()
    : null;
  const msLeft =
    expiresAtMs !== null && !Number.isNaN(expiresAtMs)
      ? expiresAtMs - now
      : null;
  const expiresSoon =
    msLeft !== null && msLeft > 0 && msLeft <= ROOM_EXPIRY_WARNING_MS;
  const roomExpired = msLeft !== null && msLeft <= 0;

  useEffect(() => {
    if (!roomExpired || expiryHandledRef.current) return;
    expiryHandledRef.current = true;
    setMessages([]);
    channelRef.current?.leave();
    toast.info("Room expired. Its data is being removed.");

    const timer = window.setTimeout(() => router.replace("/rooms"), 1200);
    return () => window.clearTimeout(timer);
  }, [roomExpired, router]);

  const canWrite = useMemo(() => {
    if (roomExpired) return false;
    if (
      session.ban &&
      (session.ban.kind === "hard" ||
        session.ban.kind === "read_only" ||
        session.ban.kind === "room_ban" ||
        session.ban.kind === "quarantine")
    )
      return false;
    return session.writeAccess.kind === "allowed";
  }, [roomExpired, session]);

  const disabledReason = roomExpired
    ? "This room has expired."
    : session.ban
      ? "You can't send messages while restricted."
      : session.writeAccess.kind === "off_campus"
        ? "You're off campus — reading only."
        : session.writeAccess.kind !== "allowed"
          ? "Verify location to send messages."
          : undefined;

  const send = async (content: string) => {
    if (roomExpired) {
      toast.error("This room has expired.");
      return;
    }

    const optimisticId = createOptimisticMessageId();
    const optimisticCreatedAt = new Date().toISOString();
    const optimisticMessage: Message = {
      content,
      createdAt: optimisticCreatedAt,
      displayColor: session.displayColor,
      displayName: session.displayName,
      id: optimisticId,
      isMine: true,
      myReactions: [],
      pending: true,
      reactions: {},
      roomId: room.id,
      userId: session.userId,
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    try {
      const sent = channelRef.current
        ? await channelRef.current.sendMessage(content)
        : (await api.messages.send({ roomId: room.id, content }),
          {
            createdAt: new Date().toISOString(),
            messageId: `local_${Math.random().toString(36).slice(2, 8)}`,
          });

      setMessages((prev) => {
        const withoutOptimistic = prev.filter(
          (message) => message.id !== optimisticId,
        );
        if (
          withoutOptimistic.some((message) => message.id === sent.messageId)
        ) {
          return withoutOptimistic.map((message) =>
            message.id === sent.messageId
              ? { ...message, isMine: true, pending: false }
              : message,
          );
        }

        return prev.map((message) =>
          message.id === optimisticId
            ? {
                ...message,
                createdAt: sent.createdAt,
                id: sent.messageId,
                pending: false,
              }
            : message,
        );
      });
    } catch (error) {
      setMessages((prev) =>
        prev.filter((message) => message.id !== optimisticId),
      );
      toast.error(errorMessage(error));
      throw error;
    }
  };

  const handleReact = async (messageId: string, emoji: string) => {
    if (roomExpired) {
      toast.error("This room has expired.");
      return;
    }

    const shouldRemove = messages
      .find((message) => message.id === messageId)
      ?.myReactions.includes(emoji);

    // Optimistic toggle
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const hadIt = m.myReactions.includes(emoji);
        const nextCount = Math.max(
          0,
          (m.reactions[emoji] ?? 0) + (hadIt ? -1 : 1),
        );
        const nextReactions = { ...m.reactions };
        if (nextCount === 0) delete nextReactions[emoji];
        else nextReactions[emoji] = nextCount;
        return {
          ...m,
          reactions: nextReactions,
          myReactions: hadIt
            ? m.myReactions.filter((e) => e !== emoji)
            : [...m.myReactions, emoji],
        };
      }),
    );
    try {
      if (channelRef.current) {
        await channelRef.current.react(messageId, emoji, shouldRemove);
      } else {
        await api.messages.react({ emoji, messageId, remove: shouldRemove });
      }
    } catch {
      // Roll back on failure
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const hadIt = m.myReactions.includes(emoji);
          const nextCount = Math.max(
            0,
            (m.reactions[emoji] ?? 0) + (hadIt ? -1 : 1),
          );
          const nextReactions = { ...m.reactions };
          if (nextCount === 0) delete nextReactions[emoji];
          else nextReactions[emoji] = nextCount;
          return {
            ...m,
            reactions: nextReactions,
            myReactions: hadIt
              ? m.myReactions.filter((e) => e !== emoji)
              : [...m.myReactions, emoji],
          };
        }),
      );
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-2.5">
        <Link
          href="/rooms"
          aria-label="Back"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold">{room.name}</h1>
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {room.visibility}
            </span>
          </div>
          {room.description && (
            <p className="truncate text-xs text-muted-foreground">
              {room.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />{" "}
            {presence.length || room.participantCount}
          </span>
          <PresenceBar users={presence} />
          <button
            onClick={() => setShareOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Share"
          >
            <Share2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setLeaveOpen(true)}
            className="inline-flex h-8 items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Leave
          </button>
        </div>
      </header>

      {(session.ban || session.writeAccess.kind !== "allowed") && (
        <div className="border-b border-border px-4 py-2.5">
          <AccessStateBanner ban={session.ban} write={session.writeAccess} />
        </div>
      )}

      {(expiresSoon || roomExpired) && (
        <div className="border-b border-amber-400/20 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
          <div className="mx-auto flex max-w-5xl items-center gap-2">
            {roomExpired ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Timer className="h-4 w-4" />
            )}
            <span>
              {roomExpired
                ? "This room has expired. Messages and room data are being deleted."
                : `This room expires in ${formatTimeLeft(msLeft ?? 0)}. Messages and room data will be deleted.`}
            </span>
          </div>
        </div>
      )}

      <MessageList
        messages={messages}
        loading={loading}
        currentUserId={session.userId}
        onReport={setReportTarget}
        onDelete={setDeleteTarget}
        onReact={handleReact}
      />

      <div className="px-4 pb-1">
        <TypingIndicator users={typing} />
      </div>

      <MessageComposer
        onSend={send}
        onTyping={() => channelRef.current?.sendTyping()}
        disabled={!canWrite}
        disabledReason={disabledReason}
        placeholder={`Message #${room.name}`}
      />

      <ShareRoomModal
        roomId={room.id}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
      <ReportDialog
        open={!!reportTarget}
        message={reportTarget}
        onClose={() => setReportTarget(null)}
        roomName={room.name}
        reporterId={session.userId}
        restricted={
          session.ban?.kind === "read_only"
            ? {
                title: "Reporting is disabled",
                description:
                  "Your account is currently read-only. You cannot submit reports.",
              }
            : session.ban?.kind === "quarantine"
              ? {
                  title: "Reporting is disabled",
                  description:
                    "Your account is under review. Reporting is temporarily unavailable.",
                }
              : session.ban?.kind === "room_ban" &&
                  session.ban.roomId === room.id
                ? {
                    title: "Reporting is disabled in this room",
                    description:
                      "You are banned from this room and cannot submit reports for its messages.",
                  }
                : null
        }
      />
      <DeleteMessageDialog
        open={!!deleteTarget}
        message={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(id) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, deleted: true, content: "" } : m,
            ),
          )
        }
      />
      <LeaveRoomDialog
        open={leaveOpen}
        room={room}
        onClose={() => setLeaveOpen(false)}
      />
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to send message.";
}

function createOptimisticMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pending_${crypto.randomUUID()}`;
  }

  return `pending_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
}
