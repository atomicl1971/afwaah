import type { BanType, MessageBodyType } from "@campus-chat/services/types";

export interface ClientToServerEvents {
  "message:send": (
    payload: MessageSendPayload,
    callback?: (response: MessageSendResponse) => void,
  ) => void;
  "message:react": (
    payload: MessageReactionPayload,
    callback?: (response: MessageReactionResponse) => void,
  ) => void;
  "message:delete": (
    payload: MessageDeletePayload,
    callback?: (response: MessageDeleteResponse) => void,
  ) => void;
  "profile:refresh": (
    callback?: (response: ProfileRefreshResponse) => void,
  ) => void;
  "room:join": (
    payload: RoomJoinPayload,
    callback?: (response: RoomJoinResponse) => void,
  ) => void;
  "room:leave": (
    payload: RoomLeavePayload,
    callback?: (response: RoomLeaveResponse) => void,
  ) => void;
  "typing:start": (payload: TypingPayload) => void;
  "typing:stop": (payload: TypingPayload) => void;
}

export interface ServerToClientEvents {
  error: (payload: ErrorPayload) => void;
  "message:deleted": (payload: MessageDeletedPayload) => void;
  "message:new": (payload: MessageNewPayload) => void;
  "message:reaction:update": (payload: MessageReactionUpdatePayload) => void;
  "presence:update": (payload: PresenceUpdatePayload) => void;
  "room:joined": (payload: RoomJoinedPayload) => void;
  "room:left": (payload: RoomLeftPayload) => void;
  "typing:update": (payload: TypingUpdatePayload) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  banType: BanType | null;
  displayColor: string;
  displayName: string;
  readOnly: boolean;
  rooms: Set<string>;
  sessionId: string;
  tokenHashHex: string;
  userId: string;
}

export interface RoomJoinPayload {
  roomId: string;
}

export interface RoomJoinResponse {
  error?: string;
  roomId?: string;
  success: boolean;
}

export interface RoomJoinedPayload {
  roomId: string;
}

export interface RoomLeavePayload {
  roomId: string;
}

export interface RoomLeaveResponse {
  error?: string;
  roomId?: string;
  success: boolean;
}

export interface RoomLeftPayload {
  roomId: string;
}

export interface MessageSendPayload {
  body: string;
  bodyType?: MessageBodyType;
  clientMessageId: string;
  mediaAssetId?: string;
  replyToMessageId?: string;
  roomId: string;
}

export interface MessageSendResponse {
  clientMessageId?: string;
  createdAt?: string;
  error?: string;
  messageId?: string;
  success: boolean;
  wasCreated?: boolean;
}

export interface MessageReactionPayload {
  emoji: string;
  messageId: string;
  remove?: boolean;
  roomId: string;
}

export interface MessageReactionResponse {
  emoji?: string;
  error?: string;
  messageId?: string;
  reactionCounts?: Record<string, number>;
  roomId?: string;
  success: boolean;
}

export interface MessageDeletePayload {
  messageId: string;
  roomId: string;
}

export interface MessageDeleteResponse {
  error?: string;
  messageId?: string;
  roomId?: string;
  success: boolean;
}

export interface MessageDeletedPayload {
  messageId: string;
  roomId: string;
  userId: string;
}

export interface MessageReactionUpdatePayload {
  emoji: string;
  messageId: string;
  reactionCounts: Record<string, number>;
  reacted: boolean;
  roomId: string;
  userId: string;
}

export interface MessageNewPayload {
  body: string;
  bodyType: MessageBodyType;
  clientMessageId: string;
  createdAt: string;
  displayColor: string;
  displayName: string;
  id: string;
  mediaAssetId: string | null;
  myReactions: string[];
  reactionCounts: Record<string, number>;
  replyToMessageId: string | null;
  roomId: string;
  userId: string;
}

export interface TypingPayload {
  roomId: string;
}

export interface TypingUpdatePayload {
  roomId: string;
  users: Array<{ displayName: string; userId: string }>;
}

export interface PresenceUpdatePayload {
  count: number;
  roomId: string;
  users: Array<{ displayColor: string; displayName: string; userId: string }>;
}

export interface ProfileRefreshResponse {
  displayColor?: string;
  displayName?: string;
  error?: string;
  success: boolean;
}

export interface ErrorPayload {
  code: string;
  message: string;
}
