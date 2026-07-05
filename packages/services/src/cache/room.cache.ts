import { redisKeys, redisTtlSeconds } from "@campus-chat/database/redis";

import type { RoomSummary } from "../types";
import type { RedisClient } from "./client";

export class RoomCache {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async addPresence(
    roomId: string,
    sessionId: string,
    connectionId?: string,
  ): Promise<void> {
    const key = redisKeys.roomPresence(roomId);
    await this.redis.zadd(
      key,
      Date.now(),
      presenceMember(sessionId, connectionId),
    );
    await this.redis.expire(key, redisTtlSeconds.presenceHeartbeat * 3);
  }

  async getActivePresence(roomId: string): Promise<string[]> {
    const cutoff = Date.now() - redisTtlSeconds.presenceHeartbeat * 1000;
    const members = await this.redis.zrangebyscore(
      redisKeys.roomPresence(roomId),
      cutoff,
      "+inf",
    );
    return Array.from(new Set(members.map(sessionIdFromPresenceMember)));
  }

  async getMetadata(roomId: string): Promise<RoomSummary | null> {
    const data = await this.redis.hgetall(redisKeys.roomMetadata(roomId));

    if (!data.id) {
      return null;
    }

    return {
      allowImages: data.allowImages === "1",
      allowLinks: data.allowLinks === "1",
      createdAt: new Date(data.createdAt ?? Date.now()),
      createdByUserId: data.createdByUserId ?? "",
      description: data.description || null,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      id: data.id,
      lastMessageAt: data.lastMessageAt ? new Date(data.lastMessageAt) : null,
      messageCount: Number(data.messageCount ?? 0),
      name: data.name ?? "",
      participantCount: Number(data.participantCount ?? 0),
      roomType: data.roomType as RoomSummary["roomType"],
      slug: data.slug || null,
      slowModeSeconds: Number(data.slowModeSeconds ?? 0),
      status: data.status as RoomSummary["status"],
    };
  }

  async getRecentMessages(roomId: string, limit: number): Promise<string[]> {
    return this.redis.lrange(
      redisKeys.recentRoomMessages(roomId),
      0,
      limit - 1,
    );
  }

  async clearRoom(roomId: string): Promise<void> {
    await this.redis.del(
      redisKeys.recentRoomMessages(roomId),
      redisKeys.roomMetadata(roomId),
      redisKeys.roomPresence(roomId),
      redisKeys.roomPresenceCount(roomId),
      redisKeys.typing(roomId),
    );
  }

  async clearRecentMessages(roomId: string): Promise<void> {
    await this.redis.del(redisKeys.recentRoomMessages(roomId));
  }

  async pushRecentMessage(
    roomId: string,
    serializedMessage: string,
  ): Promise<void> {
    const key = redisKeys.recentRoomMessages(roomId);
    await this.redis
      .multi()
      .lpush(key, serializedMessage)
      .ltrim(key, 0, redisTtlSeconds.recentMessagesCap - 1)
      .exec();
  }

  async removePresence(
    roomId: string,
    sessionId: string,
    connectionId?: string,
  ): Promise<void> {
    await this.redis.zrem(
      redisKeys.roomPresence(roomId),
      presenceMember(sessionId, connectionId),
    );
  }

  async setMetadata(roomId: string, room: RoomSummary): Promise<void> {
    const key = redisKeys.roomMetadata(roomId);
    await this.redis
      .multi()
      .hset(key, {
        allowImages: room.allowImages ? "1" : "0",
        allowLinks: room.allowLinks ? "1" : "0",
        createdAt: room.createdAt.toISOString(),
        createdByUserId: room.createdByUserId,
        description: room.description ?? "",
        expiresAt: room.expiresAt?.toISOString() ?? "",
        id: room.id,
        lastMessageAt: room.lastMessageAt?.toISOString() ?? "",
        messageCount: String(room.messageCount),
        name: room.name,
        participantCount: String(room.participantCount),
        roomType: room.roomType,
        slug: room.slug ?? "",
        slowModeSeconds: String(room.slowModeSeconds),
        status: room.status,
      })
      .expire(key, redisTtlSeconds.roomMetadata)
      .exec();
  }

  async setTyping(
    roomId: string,
    sessionId: string,
    displayName: string,
    userId: string,
  ): Promise<void> {
    const key = redisKeys.typing(roomId);
    await this.redis.hset(
      key,
      sessionId,
      JSON.stringify({ displayName, timestamp: Date.now(), userId }),
    );
    await this.redis.expire(key, redisTtlSeconds.typing);
  }

  async getTypingUsers(
    roomId: string,
  ): Promise<Array<{ displayName: string; sessionId: string; userId: string }>> {
    const data = await this.redis.hgetall(redisKeys.typing(roomId));
    const now = Date.now();
    const timeoutMs = redisTtlSeconds.typing * 1000;

    return Object.entries(data).flatMap(([sessionId, value]) => {
      const parsed = parseTypingValue(value);
      if (!parsed) return [];

      if (
        !parsed.displayName ||
        !parsed.timestamp ||
        now - parsed.timestamp > timeoutMs
      ) {
        return [];
      }

      return [
        {
          displayName: parsed.displayName,
          sessionId,
          userId: parsed.userId || sessionId,
        },
      ];
    });
  }

  async removeTyping(roomId: string, sessionId: string): Promise<void> {
    await this.redis.hdel(redisKeys.typing(roomId), sessionId);
  }
}

function presenceMember(sessionId: string, connectionId?: string): string {
  return connectionId ? `${sessionId}:${connectionId}` : sessionId;
}

function sessionIdFromPresenceMember(member: string): string {
  return member.split(":")[0] ?? member;
}

function parseTypingValue(
  value: string,
): { displayName: string; timestamp: number; userId: string } | null {
  try {
    const parsed = JSON.parse(value) as {
      displayName?: unknown;
      timestamp?: unknown;
      userId?: unknown;
    };
    if (
      typeof parsed.displayName === "string" &&
      typeof parsed.timestamp === "number"
    ) {
      return {
        displayName: parsed.displayName,
        timestamp: parsed.timestamp,
        userId: typeof parsed.userId === "string" ? parsed.userId : "",
      };
    }
  } catch {
    const separator = value.lastIndexOf(":");
    if (separator === -1) return null;

    return {
      displayName: value.slice(0, separator),
      timestamp: Number(value.slice(separator + 1)),
      userId: "",
    };
  }

  return null;
}
