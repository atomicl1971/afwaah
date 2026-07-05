import { randomUUID } from "node:crypto";

import type { RedisClient } from "@campus-chat/services/cache";
import type { DrizzleClient } from "@campus-chat/services/repositories";
import type { PasswordVerifier } from "@campus-chat/services/services";
import type {
  ActiveBanInfo,
  AdminUserData,
  SessionData,
} from "@campus-chat/services/types";

export type HeaderValue = string | string[] | null | undefined;

export interface HeaderGetter {
  get(name: string): HeaderValue;
}

export type HeaderSource = HeaderGetter | Record<string, HeaderValue>;

export interface CreateContextOptions {
  adminCookieName?: string;
  adminSessionTtlSeconds?: number;
  db: DrizzleClient;
  redis: RedisClient;
  req: {
    headers: HeaderSource;
  };
  allowIpLocationFallback?: boolean;
  sessionCookieName?: string;
  verifyAdminPassword?: PasswordVerifier;
}

export interface BaseContext {
  adminCookieName: string;
  adminSessionTtlSeconds: number;
  adminToken: string | null;
  allowIpLocationFallback: boolean;
  db: DrizzleClient;
  ipAddress: string;
  redis: RedisClient;
  requestId: string;
  sessionCookieName: string;
  sessionToken: string | null;
  userAgent: string;
  verifyAdminPassword?: PasswordVerifier;
}

export interface AuthenticatedContext extends BaseContext {
  banInfo: ActiveBanInfo | null;
  session: SessionData;
  sessionTokenHashHex: string;
}

export interface AdminContext extends BaseContext {
  admin: AdminUserData;
  adminSessionId: string;
  adminTokenHashHex: string;
}

export type Context = BaseContext;

const DEFAULT_SESSION_COOKIE_NAME = "campus_session";
const DEFAULT_ADMIN_COOKIE_NAME = "campus_admin_session";
const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

export function createContext(opts: CreateContextOptions): Context {
  const sessionCookieName =
    opts.sessionCookieName ?? DEFAULT_SESSION_COOKIE_NAME;
  const adminCookieName = opts.adminCookieName ?? DEFAULT_ADMIN_COOKIE_NAME;
  const cookieHeader = readHeader(opts.req.headers, "cookie");
  const authorization = readHeader(opts.req.headers, "authorization");

  return {
    adminCookieName,
    adminSessionTtlSeconds:
      opts.adminSessionTtlSeconds ?? DEFAULT_ADMIN_SESSION_TTL_SECONDS,
    adminToken:
      readHeader(opts.req.headers, "x-admin-token") ??
      readCookie(cookieHeader, adminCookieName),
    allowIpLocationFallback: opts.allowIpLocationFallback ?? false,
    db: opts.db,
    ipAddress:
      firstForwardedIp(readHeader(opts.req.headers, "x-forwarded-for")) ??
      readHeader(opts.req.headers, "x-real-ip") ??
      "127.0.0.1",
    redis: opts.redis,
    requestId: readHeader(opts.req.headers, "x-request-id") ?? randomUUID(),
    sessionCookieName,
    sessionToken:
      readBearerToken(authorization) ??
      readHeader(opts.req.headers, "x-session-token") ??
      readCookie(cookieHeader, sessionCookieName),
    userAgent: readHeader(opts.req.headers, "user-agent") ?? "unknown",
    verifyAdminPassword: opts.verifyAdminPassword,
  };
}

function readHeader(headers: HeaderSource, name: string): string | null {
  if ("get" in headers && typeof headers.get === "function") {
    return normalizeHeaderValue(headers.get(name));
  }

  const record = headers as Record<string, HeaderValue>;
  return normalizeHeaderValue(record[name] ?? record[name.toLowerCase()]);
}

function normalizeHeaderValue(value: HeaderValue): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value?.trim() ? value.trim() : null;
}

function readBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer") return null;
  return token?.trim() ? token.trim() : null;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) {
      const value = rawValue.join("=");
      return value ? decodeURIComponent(value) : null;
    }
  }

  return null;
}

function firstForwardedIp(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}
