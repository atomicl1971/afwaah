import { randomUUID } from "node:crypto";

import { redisKeys } from "@campus-chat/database/redis";

import type { RateLimitAction } from "../types";
import type { RedisClient } from "./client";

export interface RateLimitConfig {
  burstMax?: number;
  burstWindowSeconds?: number;
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number | null;
}

export class RateLimitCache {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  async checkAndIncrement(
    action: RateLimitAction,
    subjectId: string,
    config: RateLimitConfig,
    trustMultiplier = 1,
  ): Promise<RateLimitResult> {
    return this.checkWindow(
      redisKeys.rateLimit(action, subjectId),
      config.maxRequests,
      config.windowSeconds,
      trustMultiplier,
    );
  }

  async checkWithBurst(
    action: RateLimitAction,
    subjectId: string,
    config: RateLimitConfig,
    trustMultiplier = 1,
  ): Promise<RateLimitResult> {
    if (config.burstMax && config.burstWindowSeconds) {
      const burst = await this.checkWindow(
        redisKeys.rateLimitBurst(action, subjectId),
        config.burstMax,
        config.burstWindowSeconds,
        trustMultiplier,
      );

      if (!burst.allowed) {
        return burst;
      }
    }

    return this.checkAndIncrement(action, subjectId, config, trustMultiplier);
  }

  private async checkWindow(
    key: string,
    maxRequests: number,
    windowSeconds: number,
    trustMultiplier: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const member = `${now}:${randomUUID()}`;
    const max = Math.max(1, Math.floor(maxRequests * trustMultiplier));

    const results = await this.redis
      .multi()
      .zremrangebyscore(key, "-inf", now - windowMs)
      .zcard(key)
      .zadd(key, now, member)
      .expire(key, windowSeconds)
      .exec();

    const currentCount = Number(results?.[1]?.[1] ?? 0);
    const allowed = currentCount < max;

    if (!allowed) {
      await this.redis.zrem(key, member);
    }

    if (allowed) {
      return {
        allowed,
        remaining: Math.max(0, max - currentCount - 1),
        resetAt: new Date(now + windowMs),
        retryAfterSeconds: null,
      };
    }

    const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
    const resetAt =
      oldest.length >= 2
        ? new Date(Number(oldest[1]) + windowMs)
        : new Date(now + windowMs);

    return {
      allowed,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((resetAt.getTime() - now) / 1000),
      ),
    };
  }
}
