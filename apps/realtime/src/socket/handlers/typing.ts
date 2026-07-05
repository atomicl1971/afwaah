import { RoomService } from "@campus-chat/services/services";

import type { RealtimeClients } from "../../clients";
import type { RealtimeServer, RealtimeSocket } from "../../types/socket";
import { emitSocketError } from "../errors";
import type { PresenceManager } from "../presence";
import { typingPayloadSchema } from "../schemas";

const TYPING_START_REFRESH_MS = 3_000;

export function registerTypingHandlers(
  io: RealtimeServer,
  socket: RealtimeSocket,
  clients: RealtimeClients,
  presenceManager: PresenceManager,
): void {
  const roomService = new RoomService(clients.db, clients.redis);
  const lastTypingStartByRoom = new Map<string, number>();

  socket.on("typing:start", async (payload) => {
    try {
      const input = typingPayloadSchema.safeParse(payload);
      if (!input.success || !socket.data.rooms.has(input.data.roomId)) return;
      if (socket.data.readOnly) {
        emitSocketError(
          socket,
          "READ_ONLY",
          "Read-only sessions cannot send typing events.",
        );
        return;
      }

      const now = Date.now();
      const lastTypingStart =
        lastTypingStartByRoom.get(input.data.roomId) ?? 0;
      if (now - lastTypingStart < TYPING_START_REFRESH_MS) return;
      lastTypingStartByRoom.set(input.data.roomId, now);

      const result = await roomService.setTyping(
        input.data.roomId,
        socket.data.userId,
        socket.data.sessionId,
        socket.data.displayName,
      );
      if (!result.ok) {
        emitSocketError(socket, result.error.code, result.error.message);
        return;
      }

      await presenceManager.broadcastTyping(io, input.data.roomId);
    } catch (error) {
      console.error("typing:start failed", error);
    }
  });

  socket.on("typing:stop", async (payload) => {
    try {
      const input = typingPayloadSchema.safeParse(payload);
      if (!input.success || !socket.data.rooms.has(input.data.roomId)) return;

      lastTypingStartByRoom.delete(input.data.roomId);
      await roomService.removeTyping(input.data.roomId, socket.data.sessionId);
      await presenceManager.broadcastTyping(io, input.data.roomId);
    } catch (error) {
      console.error("typing:stop failed", error);
    }
  });
}
