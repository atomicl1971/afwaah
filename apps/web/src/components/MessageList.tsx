import { useEffect, useRef } from "react";
import type { Message } from "@/lib/types";
import { MessageItem } from "./MessageItem";

export function MessageList({
  messages,
  loading,
  currentUserId,
  onReport,
  onDelete,
  onReact,
}: {
  messages: Message[];
  loading?: boolean;
  currentUserId: string;
  onReport: (m: Message) => void;
  onDelete: (m: Message) => void;
  onReact: (messageId: string, emoji: string) => void;
}) {

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (loading) {
    return (
      <div className="min-h-0 flex-1 space-y-3 px-4 py-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-6 w-6 flex-shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 py-16 text-center">
        <p className="text-sm text-foreground">No messages yet</p>
        <p className="text-xs text-muted-foreground">Be the first to say something.</p>
      </div>
    );
  }

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto py-2">
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const isMine = m.userId === currentUserId;
        const sameAuthor = prev?.userId === m.userId;
        return (
          <MessageItem
            key={m.id}
            message={m}
            isMine={isMine}
            sameAuthor={sameAuthor}
            onReport={onReport}
            onDelete={onDelete}
            onReact={onReact}
          />
        );

      })}
    </div>
  );
}
