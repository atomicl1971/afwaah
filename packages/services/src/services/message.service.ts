import { createHash } from "node:crypto";

import { RateLimitCache, RoomCache, type RedisClient } from "../cache";
import { createError } from "../errors";
import {
  MessageRepository,
  RoomRepository,
  type DrizzleClient,
} from "../repositories";
import type {
  AddReactionInput,
  MessageAck,
  MessageData,
  MessageHistoryParams,
  PaginatedResult,
  ReactionData,
  Result,
  SendMessageInput,
} from "../types";
import { err, ok } from "../types";
import { WriteGuardService } from "./write-guard.service";

const MESSAGE_GLOBAL_LIMIT = {
  burstMax: 4,
  burstWindowSeconds: 6,
  maxRequests: 24,
  windowSeconds: 60,
} as const;

const MESSAGE_ROOM_LIMIT = {
  burstMax: 3,
  burstWindowSeconds: 6,
  maxRequests: 12,
  windowSeconds: 30,
} as const;

const MESSAGE_DUPLICATE_LIMIT = {
  maxRequests: 2,
  windowSeconds: 20,
} as const;

const MESSAGE_SHORT_TEXT_LIMIT = {
  maxRequests: 6,
  windowSeconds: 20,
} as const;

const SHORT_TEXT_MAX_LENGTH = 12;
const MESSAGE_SEND_SLOW_LOG_MS = 1000;

interface MessageSendTiming {
  ms: number;
  stage: string;
}

export class MessageService {
  private readonly messageRepo: MessageRepository;
  private readonly rateLimitCache: RateLimitCache;
  private readonly roomCache: RoomCache;
  private readonly roomRepo: RoomRepository;
  private readonly writeGuard: WriteGuardService;

  constructor(db: DrizzleClient, redis: RedisClient) {
    this.messageRepo = new MessageRepository(db);
    this.rateLimitCache = new RateLimitCache(redis);
    this.roomCache = new RoomCache(redis);
    this.roomRepo = new RoomRepository(db);
    this.writeGuard = new WriteGuardService(db);
  }

  async addReaction(
    userId: string,
    sessionId: string,
    input: AddReactionInput,
  ): Promise<Result<ReactionData>> {
    const emoji = input.emoji.trim();
    if (!isValidReactionEmoji(emoji)) {
      return err(createError("VALIDATION_ERROR", "Invalid reaction emoji."));
    }

    const message = await this.messageRepo.findById(input.messageId);
    if (!message || message.status !== "visible") {
      return err(createError("MESSAGE_NOT_FOUND", "Message not found."));
    }

    const writeAccess = await this.writeGuard.requireWriteAccess({
      roomId: message.roomId,
      sessionId,
      userId,
    });
    if (!writeAccess.ok) return err(writeAccess.error);

    const limit = await this.rateLimitCache.checkWithBurst(
      "reaction_add",
      userId,
      {
        burstMax: 10,
        burstWindowSeconds: 10,
        maxRequests: 30,
        windowSeconds: 60,
      },
    );
    if (!limit.allowed)
      return err(createError("RATE_LIMITED", "Reaction rate limited."));

    const participant = await this.roomRepo.getParticipant(
      message.roomId,
      userId,
    );
    if (!participant || participant.status !== "active") {
      return err(
        createError("NOT_ROOM_PARTICIPANT", "Not a room participant."),
      );
    }

    const reaction = await this.messageRepo.addReaction(
      input.messageId,
      userId,
      emoji,
    );
    return ok({
      createdAt: reaction.createdAt,
      emoji: reaction.emoji,
      id: reaction.id,
      messageId: reaction.messageId,
      userId: reaction.anonymousUserId,
    });
  }

  async getMessageHistory(
    params: MessageHistoryParams,
    viewerUserId?: string,
  ): Promise<PaginatedResult<MessageData>> {
    const limit = clampLimit(params.limit, 1, 100);
    const messages = await this.messageRepo.getHistory({
      ...params,
      limit: limit + 1,
    });
    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, limit) : messages;
    const mappedItems = await this.addViewerReactions(
      items.map(mapMessage),
      viewerUserId,
    );

    return {
      hasMore,
      items: mappedItems,
      nextCursor: hasMore
        ? (items.at(-1)?.createdAt.toISOString() ?? null)
        : null,
    };
  }

  async getMessageById(
    messageId: string,
    viewerUserId?: string,
  ): Promise<Result<MessageData>> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) {
      return err(createError("MESSAGE_NOT_FOUND", "Message not found."));
    }

    const [mapped] = await this.addViewerReactions(
      [mapMessage(message)],
      viewerUserId,
    );

    return mapped
      ? ok(mapped)
      : err(createError("MESSAGE_NOT_FOUND", "Message not found."));
  }

  async getRecentMessages(
    roomId: string,
    limit = 50,
    viewerUserId?: string,
  ): Promise<MessageData[]> {
    const safeLimit = clampLimit(limit, 1, 100);
    const cached = await this.roomCache.getRecentMessages(roomId, safeLimit);
    if (cached.length > 0) {
      const parsed = cached.flatMap(parseCachedMessage);
      if (parsed.length > 0) {
        return this.addViewerReactions(parsed, viewerUserId);
      }
    }

    const messages = await this.messageRepo.getHistory({
      limit: safeLimit,
      roomId,
    });
    return this.addViewerReactions(messages.map(mapMessage), viewerUserId);
  }

  async removeReaction(
    userId: string,
    sessionId: string,
    messageId: string,
    emoji: string,
  ): Promise<Result<void>> {
    const message = await this.messageRepo.findById(messageId);
    if (!message || message.status !== "visible") {
      return err(createError("MESSAGE_NOT_FOUND", "Message not found."));
    }

    const interactionAccess = await this.writeGuard.requireInteractionAccess({
      roomId: message.roomId,
      sessionId,
      userId,
    });
    if (!interactionAccess.ok) return err(interactionAccess.error);

    const removed = await this.messageRepo.removeReaction(
      messageId,
      userId,
      emoji,
    );
    return removed
      ? ok(undefined)
      : err(createError("MESSAGE_NOT_FOUND", "Reaction not found."));
  }

  async deleteOwnMessage(
    messageId: string,
    userId: string,
    sessionId: string,
  ): Promise<Result<void>> {
    const message = await this.messageRepo.findById(messageId);
    if (!message)
      return err(createError("MESSAGE_NOT_FOUND", "Message not found."));
    if (message.anonymousUserId !== userId) {
      return err(
        createError(
          "VALIDATION_ERROR",
          "Cannot delete another user's message.",
        ),
      );
    }

    const interactionAccess = await this.writeGuard.requireInteractionAccess({
      roomId: message.roomId,
      sessionId,
      userId,
    });
    if (!interactionAccess.ok) return err(interactionAccess.error);

    await this.messageRepo.updateStatus(messageId, "deleted");
    return ok(undefined);
  }

  async countRoomMessages(roomId: string): Promise<number> {
    return this.messageRepo.countByRoom(roomId);
  }

  async sendMessage(
    userId: string,
    sessionId: string,
    displayName: string,
    displayColor: string,
    input: SendMessageInput,
  ): Promise<Result<MessageAck>> {
    const sendStartedAt = Date.now();
    let stageStartedAt = sendStartedAt;
    const timings: MessageSendTiming[] = [];
    const body = input.body.trim();
    if (!body)
      return err(createError("MESSAGE_EMPTY", "Message cannot be empty."));
    if (body.length > 4000) {
      return err(
        createError("MESSAGE_TOO_LONG", "Message exceeds maximum length."),
      );
    }
    if (!isUuid(input.clientMessageId)) {
      return err(
        createError("VALIDATION_ERROR", "clientMessageId must be a UUID."),
      );
    }
    if (input.bodyType === "image" && !input.mediaAssetId) {
      return err(
        createError("VALIDATION_ERROR", "Image messages require media."),
      );
    }

    const access = await this.messageRepo.getSendAccessSnapshot(
      input.roomId,
      userId,
      sessionId,
      input.clientMessageId,
    );
    stageStartedAt = markTiming(
      timings,
      "access_snapshot",
      stageStartedAt,
    );
    if (!access) return err(createError("ROOM_NOT_FOUND", "Room not found."));
    if (access.roomStatus !== "active")
      return err(createError("ROOM_LOCKED", "Room is not active."));
    if (access.roomExpiresAt && access.roomExpiresAt <= new Date()) {
      return err(createError("ROOM_EXPIRED", "Room has expired."));
    }

    if (access.existingMessageId) {
      if (
        access.existingAnonymousUserId !== userId ||
        access.existingSessionId !== sessionId ||
        !access.existingClientMessageId ||
        !access.existingCreatedAt
      ) {
        return err(
          createError("VALIDATION_ERROR", "clientMessageId is already used."),
        );
      }

      return ok({
        clientMessageId: access.existingClientMessageId,
        createdAt: access.existingCreatedAt,
        messageId: access.existingMessageId,
        wasCreated: false,
      });
    }

    if (access.banType && access.banType !== "room_ban") {
      return err(
        createError("BAN_ACTIVE", "User is banned from interacting.", {
          banType: access.banType,
        }),
      );
    }
    if (access.banType === "room_ban") {
      return err(createError("ROOM_BANNED", "User is banned from this room."));
    }
    if (!access.locationValid) {
      return err(
        createError(
          "LOCATION_OUTSIDE_GEOFENCE",
          "A valid campus location check is required before writing.",
        ),
      );
    }

    const rateLimit = await this.enforceMessageRateLimits(
      userId,
      input.roomId,
      body,
    );
    stageStartedAt = markTiming(timings, "rate_limits", stageStartedAt);
    if (!rateLimit.ok) return err(rateLimit.error);

    if (access.participantStatus !== "active") {
      return err(
        createError("NOT_ROOM_PARTICIPANT", "Not a room participant."),
      );
    }

    if (input.replyToMessageId) {
      const replyTarget = await this.messageRepo.findById(
        input.replyToMessageId,
      );
      stageStartedAt = markTiming(timings, "reply_lookup", stageStartedAt);
      if (!replyTarget || replyTarget.roomId !== input.roomId) {
        return err(
          createError("INVALID_REPLY_TARGET", "Invalid reply target."),
        );
      }
    }

    const message = await this.messageRepo.create(
      userId,
      sessionId,
      displayName,
      displayColor,
      {
        ...input,
        body,
      },
    );
    stageStartedAt = markTiming(timings, "message_insert", stageStartedAt);
    const mappedMessage = mapMessage(message);
    void this.roomRepo
      .updateParticipantLastMessage(input.roomId, userId)
      .catch((error) => {
        console.error("Participant last-message update failed", {
          error,
          messageId: message.id,
          roomId: input.roomId,
        });
      });
    void this.roomCache
      .pushRecentMessage(input.roomId, JSON.stringify(mappedMessage))
      .catch((error) => {
        console.error("Recent message cache push failed", {
          error,
          messageId: message.id,
          roomId: input.roomId,
        });
        void this.roomCache.clearRecentMessages(input.roomId).catch(
          (clearError) => {
            console.error("Recent message cache invalidation failed", {
              error: clearError,
              messageId: message.id,
              roomId: input.roomId,
            });
          },
        );
      });
    markTiming(timings, "post_insert_scheduled", stageStartedAt);
    logSlowMessageSend(input.roomId, message.id, sendStartedAt, timings);

    return ok({
      clientMessageId: message.clientMessageId,
      createdAt: message.createdAt,
      message: mappedMessage,
      messageId: message.id,
      wasCreated: true,
    });
  }

  private async enforceMessageRateLimits(
    userId: string,
    roomId: string,
    body: string,
  ): Promise<Result<void>> {
    const normalizedBody = normalizeMessageBody(body);
    const includeShortTextLimit =
      normalizedBody.length <= SHORT_TEXT_MAX_LENGTH;
    const checks = [
      {
        action: "message_send" as const,
        config: MESSAGE_GLOBAL_LIMIT,
        subjectId: userId,
      },
      {
        action: "message_burst" as const,
        config: MESSAGE_ROOM_LIMIT,
        subjectId: `${userId}:${roomId}`,
      },
      ...(includeShortTextLimit
        ? [
            {
              action: "message_burst" as const,
              config: MESSAGE_SHORT_TEXT_LIMIT,
              subjectId: `${userId}:${roomId}:short`,
            },
          ]
        : []),
      {
        action: "message_burst" as const,
        config: MESSAGE_DUPLICATE_LIMIT,
        subjectId: `${userId}:${roomId}:same:${hashMessageBody(normalizedBody)}`,
      },
    ];
    const results = await this.rateLimitCache.checkMany(checks);
    const global = results[0]!;
    const room = results[1]!;
    const shortText = includeShortTextLimit ? results[2] : null;
    const duplicate = results[includeShortTextLimit ? 3 : 2]!;

    if (!global.allowed) {
      return rateLimited(
        "You're sending messages too quickly.",
        global.retryAfterSeconds,
        "global",
      );
    }

    if (!room.allowed) {
      return rateLimited(
        "Slow down in this room.",
        room.retryAfterSeconds,
        "room",
      );
    }

    if (shortText && !shortText.allowed) {
      return rateLimited(
        "Too many short messages.",
        shortText.retryAfterSeconds,
        "short_text",
      );
    }

    if (!duplicate.allowed) {
      return rateLimited(
        "Repeated message blocked.",
        duplicate.retryAfterSeconds,
        "duplicate",
      );
    }

    return ok(undefined);
  }

  private async addViewerReactions(
    messages: MessageData[],
    viewerUserId?: string,
  ): Promise<MessageData[]> {
    if (!viewerUserId || messages.length === 0) return messages;

    const reactions = await this.messageRepo.getReactionsForMessages(
      messages.map((message) => message.id),
    );
    const byMessageId = new Map<string, string[]>();

    for (const reaction of reactions) {
      if (reaction.anonymousUserId !== viewerUserId) continue;
      const current = byMessageId.get(reaction.messageId) ?? [];
      current.push(reaction.emoji);
      byMessageId.set(reaction.messageId, current);
    }

    return messages.map((message) => ({
      ...message,
      myReactions: byMessageId.get(message.id) ?? [],
    }));
  }
}

function rateLimited(
  message: string,
  retryAfterSeconds: number | null,
  limitType: string,
): Result<void> {
  const cooldown = retryAfterSeconds
    ? ` Try again in ${retryAfterSeconds}s.`
    : " Try again in a few seconds.";

  return err(
    createError("RATE_LIMITED", `${message}${cooldown}`, {
      limitType,
      retryAfterSeconds,
    }),
  );
}

function markTiming(
  timings: MessageSendTiming[],
  stage: string,
  startedAt: number,
): number {
  const now = Date.now();
  timings.push({ ms: now - startedAt, stage });
  return now;
}

function logSlowMessageSend(
  roomId: string,
  messageId: string,
  startedAt: number,
  timings: MessageSendTiming[],
): void {
  const totalMs = Date.now() - startedAt;
  if (totalMs < MESSAGE_SEND_SLOW_LOG_MS) return;

  console.warn("Slow message send", {
    messageId,
    roomId,
    stages: timings,
    totalMs,
  });
}

function normalizeMessageBody(body: string): string {
  return body.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashMessageBody(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

function mapMessage(message: {
  anonymousUserId: string;
  body: string;
  bodyType: string;
  clientMessageId: string;
  createdAt: Date;
  displayColorSnapshot?: string;
  displayNameSnapshot: string;
  editedAt: Date | null;
  id: string;
  mediaAssetId: string | null;
  reactionCounts: Record<string, number>;
  replyToMessageId: string | null;
  roomId: string;
  sessionId: string;
  status: string;
}): MessageData {
  return {
    body: message.body,
    bodyType: message.bodyType as MessageData["bodyType"],
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt,
    displayColorSnapshot: message.displayColorSnapshot ?? "#64748B",
    displayNameSnapshot: message.displayNameSnapshot,
    editedAt: message.editedAt,
    id: message.id,
    mediaAssetId: message.mediaAssetId,
    myReactions: [],
    reactionCounts: message.reactionCounts,
    replyToMessageId: message.replyToMessageId,
    roomId: message.roomId,
    sessionId: message.sessionId,
    status: message.status as MessageData["status"],
    userId: message.anonymousUserId,
  };
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isValidReactionEmoji(value: string): boolean {
  return value.length > 0 && value.length <= 20 && !/\s/.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function parseCachedMessage(serialized: string): MessageData[] {
  try {
    const parsed = JSON.parse(serialized) as Omit<
      MessageData,
      "createdAt" | "editedAt"
    > & {
      createdAt: string;
      editedAt: string | null;
    };

    const createdAt = new Date(parsed.createdAt);
    const editedAt = parsed.editedAt ? new Date(parsed.editedAt) : null;
    if (Number.isNaN(createdAt.getTime())) return [];
    if (editedAt && Number.isNaN(editedAt.getTime())) return [];

    return [
      {
        ...parsed,
        createdAt,
        displayColorSnapshot: parsed.displayColorSnapshot ?? "#64748B",
        editedAt,
        myReactions: parsed.myReactions ?? [],
      },
    ];
  } catch {
    return [];
  }
}
