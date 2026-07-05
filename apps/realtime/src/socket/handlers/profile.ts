import { SessionCache } from "@campus-chat/services/cache";
import { UserService } from "@campus-chat/services/services";

import type { RealtimeClients } from "../../clients";
import type { ProfileRefreshResponse } from "../../types/events";
import type { RealtimeServer, RealtimeSocket } from "../../types/socket";
import { respondOrEmit } from "../errors";
import type { PresenceManager } from "../presence";

export function registerProfileHandlers(
  io: RealtimeServer,
  socket: RealtimeSocket,
  clients: RealtimeClients,
  presenceManager: PresenceManager,
): void {
  const sessionCache = new SessionCache(clients.redis);
  const userService = new UserService(clients.db, clients.redis);

  socket.on("profile:refresh", async (callback) => {
    try {
      const identity = await readTrustedIdentity(
        sessionCache,
        userService,
        socket,
      );
      if (!identity) {
        respondOrEmit<ProfileRefreshResponse>(
          socket,
          callback,
          {
            error: "Profile could not be refreshed.",
            success: false,
          },
          "PROFILE_REFRESH_FAILED",
        );
        return;
      }

      socket.data.displayColor = identity.displayColor;
      socket.data.displayName = identity.displayName;

      respondOrEmit<ProfileRefreshResponse>(socket, callback, {
        displayColor: identity.displayColor,
        displayName: identity.displayName,
        success: true,
      });

      await Promise.all(
        Array.from(socket.data.rooms).map((roomId) =>
          presenceManager.broadcastPresence(io, roomId),
        ),
      );
    } catch (error) {
      console.error("profile:refresh failed", error);
      respondOrEmit<ProfileRefreshResponse>(
        socket,
        callback,
        {
          error: "Failed to refresh profile.",
          success: false,
        },
        "PROFILE_REFRESH_FAILED",
      );
    }
  });
}

async function readTrustedIdentity(
  sessionCache: SessionCache,
  userService: UserService,
  socket: RealtimeSocket,
): Promise<{ displayColor: string; displayName: string } | null> {
  const cached = await sessionCache.get(socket.data.tokenHashHex);
  if (
    cached &&
    cached.sessionId === socket.data.sessionId &&
    cached.userId === socket.data.userId
  ) {
    return {
      displayColor: cached.displayColor,
      displayName: cached.displayName,
    };
  }

  const profile = await userService.getUserProfile(socket.data.userId);
  if (!profile.ok) return null;

  return {
    displayColor: profile.value.currentDisplayColor,
    displayName: profile.value.currentDisplayName,
  };
}
