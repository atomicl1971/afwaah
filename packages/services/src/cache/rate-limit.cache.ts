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

export interface RateLimitCheckInput {
  action: RateLimitAction;
  config: RateLimitConfig;
  subjectId: string;
  trustMultiplier?: number;
}

interface ExpandedRateLimitWindow {
  checkIndex: number;
  isBurst: boolean;
  key: string;
  max: number;
  member: string;
  windowMs: number;
  windowSeconds: number;
}

interface RateLimitWindowState extends ExpandedRateLimitWindow {
  allowed: boolean;
  count: number;
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
      return this.checkBurstAndWindow(
        redisKeys.rateLimitBurst(action, subjectId),
        redisKeys.rateLimit(action, subjectId),
        {
          burstMax: config.burstMax,
          burstWindowSeconds: config.burstWindowSeconds,
          maxRequests: config.maxRequests,
          windowSeconds: config.windowSeconds,
        },
        trustMultiplier,
      );
    }

    return this.checkAndIncrement(action, subjectId, config, trustMultiplier);
  }

  async checkMany(
    checks: RateLimitCheckInput[],
  ): Promise<RateLimitResult[]> {
    if (checks.length === 0) return [];

    const now = Date.now();
    const windows: ExpandedRateLimitWindow[] = [];

    checks.forEach((check, checkIndex) => {
      const trustMultiplier = check.trustMultiplier ?? 1;
      if (check.config.burstMax && check.config.burstWindowSeconds) {
        windows.push({
          checkIndex,
          isBurst: true,
          key: redisKeys.rateLimitBurst(check.action, check.subjectId),
          max: Math.max(
            1,
            Math.floor(check.config.burstMax * trustMultiplier),
          ),
          member: `${now}:burst:${randomUUID()}`,
          windowMs: check.config.burstWindowSeconds * 1000,
          windowSeconds: check.config.burstWindowSeconds,
        });
      }

      windows.push({
        checkIndex,
        isBurst: false,
        key: redisKeys.rateLimit(check.action, check.subjectId),
        max: Math.max(
          1,
          Math.floor(check.config.maxRequests * trustMultiplier),
        ),
        member: `${now}:window:${randomUUID()}`,
        windowMs: check.config.windowSeconds * 1000,
        windowSeconds: check.config.windowSeconds,
      });
    });

    let pipeline = this.redis.multi();
    for (const window of windows) {
      pipeline = pipeline
        .zremrangebyscore(window.key, "-inf", now - window.windowMs)
        .zcard(window.key)
        .zadd(window.key, now, window.member)
        .expire(window.key, window.windowSeconds);
    }
    const rawResults = await pipeline.exec();

    const states = windows.map((window, index): RateLimitWindowState => {
      const count = Number(rawResults?.[index * 4 + 1]?.[1] ?? 0);
      return {
        ...window,
        allowed: count < window.max,
        count,
      };
    });

    const removals: Array<{ key: string; member: string }> = [];
    const results: Array<RateLimitResult | RateLimitWindowState> = [];
    let firstFailedCheckIndex: number | null = null;

    checks.forEach((_, checkIndex) => {
      const checkStates = states.filter(
        (state) => state.checkIndex === checkIndex,
      );
      const burst = checkStates.find((state) => state.isBurst);
      const main = checkStates.find((state) => !state.isBurst);

      if (firstFailedCheckIndex !== null) {
        removals.push(...checkStates.map(removalForWindow));
        results[checkIndex] = {
          allowed: true,
          remaining: 0,
          resetAt: new Date(now),
          retryAfterSeconds: null,
        };
        return;
      }

      if (burst && !burst.allowed) {
        removals.push(...checkStates.map(removalForWindow));
        results[checkIndex] = burst;
        firstFailedCheckIndex = checkIndex;
        return;
      }

      if (main && !main.allowed) {
        removals.push(removalForWindow(main));
        results[checkIndex] = main;
        firstFailedCheckIndex = checkIndex;
        return;
      }

      const successful = main ?? checkStates.at(-1);
      results[checkIndex] = {
        allowed: true,
        remaining: successful
          ? Math.max(0, successful.max - successful.count - 1)
          : 0,
        resetAt: new Date(now + (successful?.windowMs ?? 0)),
        retryAfterSeconds: null,
      };
    });

    if (removals.length > 0) {
      await Promise.all(
        removals.map((removal) =>
          this.redis.zrem(removal.key, removal.member),
        ),
      );
    }

    return Promise.all(
      checks.map((_, index) => results[index]!).map((result) =>
        "retryAfterSeconds" in result
          ? result
          : this.rateLimitedResult(result.key, result.windowMs, now),
      ),
    );
  }

  private async checkBurstAndWindow(
    burstKey: string,
    windowKey: string,
    config: Required<RateLimitConfig>,
    trustMultiplier: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const burstWindowMs = config.burstWindowSeconds * 1000;
    const windowMs = config.windowSeconds * 1000;
    const burstMember = `${now}:burst:${randomUUID()}`;
    const windowMember = `${now}:window:${randomUUID()}`;
    const burstMax = Math.max(
      1,
      Math.floor(config.burstMax * trustMultiplier),
    );
    const windowMax = Math.max(
      1,
      Math.floor(config.maxRequests * trustMultiplier),
    );

    const results = await this.redis
      .multi()
      .zremrangebyscore(burstKey, "-inf", now - burstWindowMs)
      .zcard(burstKey)
      .zadd(burstKey, now, burstMember)
      .expire(burstKey, config.burstWindowSeconds)
      .zremrangebyscore(windowKey, "-inf", now - windowMs)
      .zcard(windowKey)
      .zadd(windowKey, now, windowMember)
      .expire(windowKey, config.windowSeconds)
      .exec();

    const burstCount = Number(results?.[1]?.[1] ?? 0);
    const windowCount = Number(results?.[5]?.[1] ?? 0);
    const burstAllowed = burstCount < burstMax;
    const windowAllowed = windowCount < windowMax;

    if (burstAllowed && windowAllowed) {
      return {
        allowed: true,
        remaining: Math.max(0, windowMax - windowCount - 1),
        resetAt: new Date(now + windowMs),
        retryAfterSeconds: null,
      };
    }

    await Promise.all([
      this.redis.zrem(burstKey, burstMember),
      this.redis.zrem(windowKey, windowMember),
    ]);

    if (!burstAllowed) {
      return this.rateLimitedResult(burstKey, burstWindowMs, now);
    }

    return this.rateLimitedResult(windowKey, windowMs, now);
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

  private async rateLimitedResult(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<RateLimitResult> {
    const oldest = await this.redis.zrange(key, 0, 0, "WITHSCORES");
    const resetAt =
      oldest.length >= 2
        ? new Date(Number(oldest[1]) + windowMs)
        : new Date(now + windowMs);

    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((resetAt.getTime() - now) / 1000),
      ),
    };
  }
}

function removalForWindow(window: RateLimitWindowState): {
  key: string;
  member: string;
} {
  return {
    key: window.key,
    member: window.member,
  };
}
