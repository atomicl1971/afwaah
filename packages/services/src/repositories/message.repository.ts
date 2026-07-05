import { messageReactions, messages } from "@campus-chat/database/schema";
import type { Message, MessageReaction } from "@campus-chat/database/models";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import type {
  MessageHistoryParams,
  MessageStatus,
  SendMessageInput,
} from "../types";
import { BaseRepository, type DrizzleClient } from "./base";

export interface MessageSendAccessSnapshot {
  banType: string | null;
  existingAnonymousUserId: string | null;
  existingClientMessageId: string | null;
  existingCreatedAt: Date | null;
  existingMessageId: string | null;
  existingSessionId: string | null;
  locationValid: boolean;
  participantId: string | null;
  participantStatus: string | null;
  roomExpiresAt: Date | null;
  roomId: string;
  roomStatus: string;
}

export class MessageRepository extends BaseRepository {
  constructor(db: DrizzleClient) {
    super(db);
  }

  async addReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageReaction> {
    const [reaction] = await this.db
      .insert(messageReactions)
      .values({ anonymousUserId: userId, emoji, messageId })
      .onConflictDoNothing()
      .returning();

    if (reaction) return reaction;

    const [existing] = await this.db
      .select()
      .from(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.anonymousUserId, userId),
          eq(messageReactions.emoji, emoji),
        ),
      )
      .limit(1);

    if (!existing) throw new Error("Failed to create message reaction.");
    return existing;
  }

  async countByRoom(roomId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.roomId, roomId), eq(messages.status, "visible")));

    return result?.count ?? 0;
  }

  async create(
    userId: string,
    sessionId: string,
    displayName: string,
    displayColor: string,
    input: SendMessageInput,
  ): Promise<Message> {
    const [message] = await this.db
      .insert(messages)
      .values({
        anonymousUserId: userId,
        body: input.body,
        bodyType: input.bodyType ?? "text",
        clientMessageId: input.clientMessageId,
        displayColorSnapshot: displayColor,
        displayNameSnapshot: displayName,
        mediaAssetId: input.mediaAssetId,
        replyToMessageId: input.replyToMessageId,
        roomId: input.roomId,
        sessionId,
      })
      .returning();

    if (!message) throw new Error("Failed to create message.");
    return message;
  }

  async findByClientMessageId(
    roomId: string,
    clientMessageId: string,
  ): Promise<Message | null> {
    const [message] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.roomId, roomId),
          eq(messages.clientMessageId, clientMessageId),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return message ?? null;
  }

  async findById(messageId: string): Promise<Message | null> {
    const [message] = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);

    return message ?? null;
  }

  async getHistory(params: MessageHistoryParams): Promise<Message[]> {
    const conditions = [
      eq(messages.roomId, params.roomId),
      eq(messages.status, "visible"),
    ];

    if (params.before) conditions.push(lt(messages.createdAt, params.before));
    if (params.after) conditions.push(gt(messages.createdAt, params.after));

    return this.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(params.after ? messages.createdAt : desc(messages.createdAt))
      .limit(params.limit);
  }

  async getReactions(messageId: string): Promise<MessageReaction[]> {
    return this.db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.messageId, messageId))
      .orderBy(messageReactions.createdAt);
  }

  async getReactionsForMessages(
    messageIds: string[],
  ): Promise<MessageReaction[]> {
    if (messageIds.length === 0) return [];

    return this.db
      .select()
      .from(messageReactions)
      .where(inArray(messageReactions.messageId, messageIds))
      .orderBy(messageReactions.createdAt);
  }

  async getSendAccessSnapshot(
    roomId: string,
    userId: string,
    sessionId: string,
    clientMessageId: string,
  ): Promise<MessageSendAccessSnapshot | null> {
    const result = await this.db.execute(sql`
      SELECT
        room.id::text AS "roomId",
        room.status AS "roomStatus",
        room.expires_at AS "roomExpiresAt",
        participant.id::text AS "participantId",
        participant.status AS "participantStatus",
        existing_message.id::text AS "existingMessageId",
        existing_message.client_message_id::text AS "existingClientMessageId",
        existing_message.anonymous_user_id::text AS "existingAnonymousUserId",
        existing_message.session_id::text AS "existingSessionId",
        existing_message.created_at AS "existingCreatedAt",
        EXISTS (
          SELECT 1
          FROM core.location_checks AS location_check
          WHERE location_check.session_id = ${sessionId}::uuid
            AND location_check.is_within_geofence = TRUE
            AND location_check.valid_until > NOW()
          LIMIT 1
        ) AS "locationValid",
        (
          SELECT ban.ban_type
          FROM moderation.bans AS ban
          WHERE ban.is_active = TRUE
            AND (ban.expires_at IS NULL OR ban.expires_at > NOW())
            AND (
              ban.target_user_id = ${userId}::uuid
              OR ban.target_session_id = ${sessionId}::uuid
            )
            AND (
              ban.ban_type IN (
                'global_hard_ban',
                'global_write_ban',
                'quarantine'
              )
              OR (
                ban.ban_type = 'room_ban'
                AND ban.target_room_id = ${roomId}::uuid
              )
            )
          ORDER BY
            CASE ban.ban_type
              WHEN 'global_hard_ban' THEN 1
              WHEN 'global_write_ban' THEN 2
              WHEN 'quarantine' THEN 3
              WHEN 'room_ban' THEN 4
              ELSE 5
            END,
            ban.confidence_score DESC,
            ban.created_at DESC
          LIMIT 1
        ) AS "banType"
      FROM core.rooms AS room
      LEFT JOIN core.room_participants AS participant
        ON participant.room_id = room.id
        AND participant.anonymous_user_id = ${userId}::uuid
      LEFT JOIN LATERAL (
        SELECT
          message.id,
          message.client_message_id,
          message.anonymous_user_id,
          message.session_id,
          message.created_at
        FROM core.messages AS message
        WHERE message.room_id = room.id
          AND message.client_message_id = ${clientMessageId}::uuid
        ORDER BY message.created_at DESC
        LIMIT 1
      ) AS existing_message ON TRUE
      WHERE room.id = ${roomId}::uuid
      LIMIT 1
    `);

    const [snapshot] = rowsFromResult<MessageSendAccessSnapshot>(result);
    return snapshot ?? null;
  }

  async removeReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<boolean> {
    const removed = await this.db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.anonymousUserId, userId),
          eq(messageReactions.emoji, emoji),
        ),
      )
      .returning({ id: messageReactions.id });

    return removed.length > 0;
  }

  async updateStatus(
    messageId: string,
    status: MessageStatus,
    options?: { adminId?: string; reason?: string },
  ): Promise<Message | null> {
    const [message] = await this.db
      .update(messages)
      .set({
        deletedAt: status === "deleted" ? new Date() : undefined,
        deletedByAdminId: options?.adminId,
        deletionReason: options?.reason,
        status,
      })
      .where(eq(messages.id, messageId))
      .returning();

    return message ?? null;
  }
}

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}
