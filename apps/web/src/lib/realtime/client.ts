/**
 * Realtime client (ISOLATED).
 *
 * In production this wraps `socket.io-client` against `env.realtimeUrl`.
 * When no backend is reachable, falls back to a local mock event bus that
 * simulates message arrival, typing, and presence.
 */
import { io, type Socket } from "socket.io-client";
import { env } from "../env";
import { mockGenerateMessage } from "../mocks/data";
import type {
  Message,
  MessageDeletedUpdate,
  MessageReactionUpdate,
  Presence,
  TypingUser,
} from "../types";

type Listener<T> = (payload: T) => void;

const TYPING_START_REFRESH_MS = 4_000;
const TYPING_STOP_IDLE_MS = 1_800;

export interface RoomChannel {
  onMessage: (fn: Listener<Message>) => () => void;
  onMessageDeleted: (fn: Listener<MessageDeletedUpdate>) => () => void;
  onReaction: (fn: Listener<MessageReactionUpdate>) => () => void;
  onTyping: (fn: Listener<TypingUser[]>) => () => void;
  onPresence: (fn: Listener<Presence[]>) => () => void;
  deleteMessage: (messageId: string) => Promise<void>;
  react: (messageId: string, emoji: string, remove?: boolean) => Promise<void>;
  sendMessage: (content: string) => Promise<{
    clientMessageId: string;
    createdAt: string;
    messageId: string;
  }>;
  sendTyping: () => void;
  leave: () => void;
}

interface ConnectOpts {
  displayColor?: string;
  displayName?: string;
  token: string;
  userId?: string;
}

let socket: Socket | null = null;
let socketIdentityKey: string | null = null;

function ensureSocket(opts: ConnectOpts): Socket | null {
  if (env.useMocks) return null;
  const nextIdentityKey = [
    opts.token,
    opts.userId ?? "",
    opts.displayName ?? "",
    opts.displayColor ?? "",
  ].join("|");

  if (socket && socketIdentityKey !== nextIdentityKey) {
    socket.disconnect();
    socket = null;
    socketIdentityKey = null;
  }

  if (socket) return socket;
  try {
    socket = io(env.realtimeUrl, {
      auth: { token: opts.token },
      transports: ["websocket"],
      autoConnect: true,
    });
    socketIdentityKey = nextIdentityKey;
    return socket;
  } catch {
    return null;
  }
}

export function resetRealtimeConnection(): void {
  socket?.disconnect();
  socket = null;
  socketIdentityKey = null;
}

export function refreshRealtimeProfile(): Promise<boolean> {
  const currentSocket = socket;
  if (!currentSocket?.connected) return Promise.resolve(false);

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 1500);
    currentSocket.emit(
      "profile:refresh",
      (response: { success: boolean }) => {
        window.clearTimeout(timer);
        resolve(response.success);
      },
    );
  });
}

export function joinRoom(roomId: string, opts: ConnectOpts): RoomChannel {
  const s = ensureSocket(opts);

  const messageListeners = new Set<Listener<Message>>();
  const messageDeletedListeners = new Set<Listener<MessageDeletedUpdate>>();
  const reactionListeners = new Set<Listener<MessageReactionUpdate>>();
  const typingListeners = new Set<Listener<TypingUser[]>>();
  const presenceListeners = new Set<Listener<Presence[]>>();
  const pendingMessages = new Map<
    string,
    { content: string; displayColor: string; displayName: string; userId: string }
  >();

  let mockInterval: ReturnType<typeof setInterval> | null = null;
  let mockTypingTimer: ReturnType<typeof setTimeout> | null = null;
  let typingStopTimer: ReturnType<typeof setTimeout> | null = null;
  let typingActive = false;
  let lastTypingStartAt = 0;

  if (s) {
    const emitTypingStop = () => {
      if (typingStopTimer) {
        clearTimeout(typingStopTimer);
        typingStopTimer = null;
      }
      if (!typingActive) return;

      typingActive = false;
      lastTypingStartAt = 0;
      s.emit("typing:stop", { roomId });
    };

    s.emit("room:join", { roomId });
    const onMsg = (payload: {
      body: string;
      clientMessageId: string;
      createdAt: string;
      displayColor: string;
      displayName: string;
      id: string;
      reactionCounts: Record<string, number>;
      roomId: string;
      userId: string;
      myReactions?: string[];
    }) => {
      if (payload.roomId !== roomId) return;

      const pending = pendingMessages.get(payload.clientMessageId);
      if (pending) pendingMessages.delete(payload.clientMessageId);

      const message: Message = {
        content: payload.body,
        createdAt: payload.createdAt,
        displayColor: payload.displayColor,
        displayName: payload.displayName,
        id: payload.id,
        isMine: Boolean(pending),
        myReactions: payload.myReactions ?? [],
        reactions: payload.reactionCounts,
        roomId: payload.roomId,
        userId: payload.userId || pending?.userId || `remote_${payload.displayName}`,
      };

      messageListeners.forEach((listener) => listener(message));
    };
    const onTyping = (payload: {
      roomId: string;
      users: Array<{ displayName: string; userId?: string }>;
    }) => {
      if (payload.roomId !== roomId) return;
      typingListeners.forEach((listener) =>
        listener(
          payload.users.map((user) => ({
            displayName: user.displayName,
            userId: user.userId ?? user.displayName,
          })),
        ),
      );
    };
    const onPresence = (payload: {
      count: number;
      roomId: string;
      users?: Presence[];
    }) => {
      if (payload.roomId !== roomId) return;
      presenceListeners.forEach((listener) => listener(payload.users ?? []));
    };
    const onReaction = (payload: MessageReactionUpdate) => {
      if (payload.roomId !== roomId) return;
      reactionListeners.forEach((listener) => listener(payload));
    };
    const onMessageDeleted = (payload: MessageDeletedUpdate) => {
      if (payload.roomId !== roomId) return;
      messageDeletedListeners.forEach((listener) => listener(payload));
    };
    s.on("message:new", onMsg);
    s.on("message:deleted", onMessageDeleted);
    s.on("message:reaction:update", onReaction);
    s.on("typing:update", onTyping);
    s.on("presence:update", onPresence);

    return {
      onMessage: (fn) => (messageListeners.add(fn), () => messageListeners.delete(fn)),
      onMessageDeleted: (fn) =>
        (messageDeletedListeners.add(fn), () => messageDeletedListeners.delete(fn)),
      onReaction: (fn) =>
        (reactionListeners.add(fn), () => reactionListeners.delete(fn)),
      onTyping: (fn) => (typingListeners.add(fn), () => typingListeners.delete(fn)),
      onPresence: (fn) => (presenceListeners.add(fn), () => presenceListeners.delete(fn)),
      react: (messageId, emoji, remove) =>
        new Promise((resolve, reject) => {
          s.emit(
            "message:react",
            { emoji, messageId, remove, roomId },
            (response: { error?: string; success: boolean }) => {
              if (!response.success) {
                reject(new Error(response.error ?? "Failed to update reaction."));
                return;
              }
              resolve();
            },
          );
        }),
      deleteMessage: (messageId) =>
        new Promise((resolve, reject) => {
          s.emit(
            "message:delete",
            { messageId, roomId },
            (response: { error?: string; success: boolean }) => {
              if (!response.success) {
                reject(new Error(response.error ?? "Failed to delete message."));
                return;
              }
              resolve();
            },
          );
        }),
      sendMessage: (content) => {
        emitTypingStop();
        const clientMessageId = createClientMessageId();
        pendingMessages.set(clientMessageId, {
          content,
          displayColor: opts.displayColor ?? "#60a5fa",
          displayName: opts.displayName ?? "you",
          userId: opts.userId ?? "me",
        });

        return new Promise((resolve, reject) => {
          s.emit(
            "message:send",
            {
              body: content,
              bodyType: "text",
              clientMessageId,
              roomId,
            },
            (response: {
              clientMessageId?: string;
              createdAt?: string;
              error?: string;
              messageId?: string;
              success: boolean;
            }) => {
              if (!response.success || !response.messageId) {
                pendingMessages.delete(clientMessageId);
                reject(new Error(response.error ?? "Failed to send message."));
                return;
              }

              resolve({
                clientMessageId: response.clientMessageId ?? clientMessageId,
                createdAt: response.createdAt ?? new Date().toISOString(),
                messageId: response.messageId,
              });
            },
          );
        });
      },
      sendTyping: () => {
        const now = Date.now();
        if (
          !typingActive ||
          now - lastTypingStartAt >= TYPING_START_REFRESH_MS
        ) {
          const isRefresh = typingActive;
          typingActive = true;
          lastTypingStartAt = now;
          if (isRefresh) s.volatile.emit("typing:start", { roomId });
          else s.emit("typing:start", { roomId });
        }

        if (typingStopTimer) clearTimeout(typingStopTimer);
        typingStopTimer = setTimeout(() => {
          emitTypingStop();
        }, TYPING_STOP_IDLE_MS);
      },
      leave: () => {
        emitTypingStop();
        s.emit("room:leave", { roomId });
        s.off("message:new", onMsg);
        s.off("message:deleted", onMessageDeleted);
        s.off("message:reaction:update", onReaction);
        s.off("typing:update", onTyping);
        s.off("presence:update", onPresence);
      },
    };
  }

  // Mock mode
  const emitPresence = () =>
    presenceListeners.forEach((l) =>
      l([
        { userId: "u_a", displayName: "quiet-otter-42", displayColor: "#22d3ee" },
        { userId: "u_b", displayName: "brave-heron-08", displayColor: "#f472b6" },
        { userId: "u_c", displayName: "amber-koi-77", displayColor: "#fbbf24" },
      ]),
    );

  setTimeout(emitPresence, 200);

  mockInterval = setInterval(() => {
    if (Math.random() > 0.55) {
      const m = mockGenerateMessage(roomId);
      messageListeners.forEach((l) => l(m));
    } else {
      typingListeners.forEach((l) =>
        l([{ userId: "u_a", displayName: "quiet-otter-42" }]),
      );
      if (mockTypingTimer) clearTimeout(mockTypingTimer);
      mockTypingTimer = setTimeout(() => {
        typingListeners.forEach((l) => l([]));
      }, 2200);
    }
  }, 6500);

  return {
    onMessage: (fn) => (messageListeners.add(fn), () => messageListeners.delete(fn)),
    onMessageDeleted: (fn) =>
      (messageDeletedListeners.add(fn), () => messageDeletedListeners.delete(fn)),
    onReaction: (fn) =>
      (reactionListeners.add(fn), () => reactionListeners.delete(fn)),
    onTyping: (fn) => (typingListeners.add(fn), () => typingListeners.delete(fn)),
    onPresence: (fn) => (presenceListeners.add(fn), () => presenceListeners.delete(fn)),
    react: async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    },
    deleteMessage: async (messageId) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      messageDeletedListeners.forEach((listener) =>
        listener({
          messageId,
          roomId,
          userId: opts.userId ?? "me",
        }),
      );
    },
    sendMessage: async (content) => ({
      clientMessageId: createClientMessageId(),
      createdAt: new Date().toISOString(),
      messageId: `local_${Math.random().toString(36).slice(2, 8)}`,
    }),
    sendTyping: () => {},
    leave: () => {
      if (mockInterval) clearInterval(mockInterval);
      if (mockTypingTimer) clearTimeout(mockTypingTimer);
      messageListeners.clear();
      messageDeletedListeners.clear();
      typingListeners.clear();
      presenceListeners.clear();
    },
  };
}

export function disconnectRealtime() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

function createClientMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
