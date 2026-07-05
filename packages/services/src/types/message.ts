import type { MessageBodyType, MessageStatus } from "./common";

export interface SendMessageInput {
  body: string;
  bodyType?: MessageBodyType;
  clientMessageId: string;
  mediaAssetId?: string;
  replyToMessageId?: string;
  roomId: string;
}

export interface MessageAck {
  clientMessageId: string;
  createdAt: Date;
  message?: MessageData;
  messageId: string;
  wasCreated: boolean;
}

export interface MessageData {
  body: string;
  bodyType: MessageBodyType;
  clientMessageId: string;
  createdAt: Date;
  displayColorSnapshot: string;
  displayNameSnapshot: string;
  editedAt: Date | null;
  id: string;
  mediaAssetId: string | null;
  myReactions: string[];
  reactionCounts: Record<string, number>;
  replyToMessageId: string | null;
  roomId: string;
  sessionId: string;
  status: MessageStatus;
  userId: string;
}

export interface MessageHistoryParams {
  after?: Date;
  before?: Date;
  limit: number;
  roomId: string;
}

export interface AddReactionInput {
  emoji: string;
  messageId: string;
}

export interface ReactionData {
  createdAt: Date;
  emoji: string;
  id: string;
  messageId: string;
  userId: string;
}
