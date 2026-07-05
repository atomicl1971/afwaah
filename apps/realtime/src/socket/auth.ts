import type { RedisClient } from "@campus-chat/services/cache";
import type { DrizzleClient } from "@campus-chat/services/repositories";
import { SessionService } from "@campus-chat/services/services";
import { hashToken } from "@campus-chat/services/utils";

import type { RealtimeEnv } from "../env";
import type { RealtimeSocket } from "../types/socket";

export function createAuthMiddleware(
  db: DrizzleClient,
  redis: RedisClient,
  env: RealtimeEnv,
) {
  const sessionService = new SessionService(db, redis);

  return async (socket: RealtimeSocket, next: (err?: Error) => void) => {
    try {
      const token = extractSessionToken(socket, env.SESSION_COOKIE_NAME);
      if (!token) {
        next(new Error("Authentication required."));
        return;
      }
      const tokenHashHex = hashToken(token).toString("hex");

      const result = await sessionService.validateSession(token);
      if (!result.ok || !result.value.valid || !result.value.session) {
        next(new Error("Invalid or expired session."));
        return;
      }

      socket.data.banType = result.value.banInfo?.banType ?? null;
      socket.data.displayColor = result.value.session.displayColor;
      socket.data.displayName = result.value.session.displayName;
      socket.data.readOnly =
        result.value.banInfo?.banType === "global_write_ban" ||
        result.value.banInfo?.banType === "quarantine";
      socket.data.rooms = new Set();
      socket.data.sessionId = result.value.session.sessionId;
      socket.data.tokenHashHex = tokenHashHex;
      socket.data.userId = result.value.session.userId;

      next();
    } catch (error) {
      console.error("Socket authentication failed", error);
      next(new Error("Authentication failed."));
    }
  };
}

function extractSessionToken(
  socket: RealtimeSocket,
  cookieName: string,
): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const authorization = socket.handshake.headers.authorization;
  if (authorization) {
    const [scheme, token] = authorization.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && token?.trim()) {
      return token.trim();
    }
  }

  const headerToken = socket.handshake.headers["x-session-token"];
  if (typeof headerToken === "string" && headerToken.trim()) {
    return headerToken.trim();
  }
  if (Array.isArray(headerToken) && headerToken[0]?.trim()) {
    return headerToken[0].trim();
  }

  const cookieHeader = socket.handshake.headers.cookie;
  return cookieHeader ? readCookie(cookieHeader, cookieName) : null;
}

function readCookie(cookieHeader: string, name: string): string | null {
  for (const cookie of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = cookie.trim().split("=");
    if (rawKey === name) {
      const value = rawValue.join("=");
      return value ? decodeURIComponent(value) : null;
    }
  }

  return null;
}
