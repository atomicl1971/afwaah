import { RoomService } from "@campus-chat/services/services";

import type { RealtimeClients } from "../clients";
import type { RealtimeEnv } from "../env";
import type { RealtimeServer, RealtimeSocket } from "../types/socket";

export class PresenceManager {
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();
  private readonly heartbeatMs: number;
  private readonly roomService: RoomService;

  constructor(
    clients: RealtimeClients,
    env: Pick<RealtimeEnv, "PRESENCE_HEARTBEAT_SECONDS">,
  ) {
    this.heartbeatMs = env.PRESENCE_HEARTBEAT_SECONDS * 1000;
    this.roomService = new RoomService(clients.db, clients.redis);
  }

  async addToRoom(
    io: RealtimeServer,
    socket: RealtimeSocket,
    roomId: string,
  ): Promise<void> {
    socket.data.rooms.add(roomId);
    await socket.join(roomId);
    void this.roomService
      .setPresence(roomId, socket.data.sessionId, socket.id)
      .catch((error) => {
        console.error("Presence add failed", {
          error,
          roomId,
          socketId: socket.id,
        });
      });
    void this.broadcastPresence(io, roomId).catch((error) => {
      console.error("Presence broadcast failed", {
        error,
        roomId,
        socketId: socket.id,
      });
    });
  }

  async removeFromRoom(
    io: RealtimeServer,
    socket: RealtimeSocket,
    roomId: string,
  ): Promise<void> {
    socket.data.rooms.delete(roomId);
    await socket.leave(roomId);
    await Promise.all([
      this.roomService.removePresence(roomId, socket.data.sessionId, socket.id),
      this.roomService.removeTyping(roomId, socket.data.sessionId),
    ]);
    await Promise.all([
      this.broadcastPresence(io, roomId),
      this.broadcastTyping(io, roomId),
    ]);
  }

  async removeFromAllRooms(
    io: RealtimeServer,
    socket: RealtimeSocket,
  ): Promise<void> {
    const rooms = Array.from(socket.data.rooms);
    await Promise.all(
      rooms.map((roomId) => this.removeFromRoom(io, socket, roomId)),
    );
  }

  startHeartbeat(socket: RealtimeSocket): void {
    this.stopHeartbeat(socket);
    const timer = setInterval(() => {
      this.refreshSocketPresence(socket).catch((error) => {
        console.error("Presence heartbeat failed", {
          error,
          socketId: socket.id,
        });
      });
    }, this.heartbeatMs);
    timer.unref();
    this.heartbeatTimers.set(socket.id, timer);
  }

  stopHeartbeat(socket: RealtimeSocket): void {
    const timer = this.heartbeatTimers.get(socket.id);
    if (!timer) return;

    clearInterval(timer);
    this.heartbeatTimers.delete(socket.id);
  }

  async broadcastPresence(io: RealtimeServer, roomId: string): Promise<void> {
    const [sessionIds, sockets] = await Promise.all([
      this.roomService.getActivePresence(roomId),
      io.in(roomId).fetchSockets(),
    ]);
    const users = new Map<
      string,
      { displayColor: string; displayName: string; userId: string }
    >();

    for (const socket of sockets) {
      users.set(socket.data.userId, {
        displayColor: socket.data.displayColor,
        displayName: socket.data.displayName,
        userId: socket.data.userId,
      });
    }

    io.to(roomId).emit("presence:update", {
      count: users.size || sessionIds.length,
      roomId,
      users: [...users.values()],
    });
  }

  async broadcastTyping(io: RealtimeServer, roomId: string): Promise<void> {
    const typingUsers = await this.roomService.getTypingUsers(roomId);
    io.to(roomId).emit("typing:update", {
      roomId,
      users: typingUsers.map((user) => ({
        displayName: user.displayName,
        userId: user.userId,
      })),
    });
  }

  async refreshSocketPresence(socket: RealtimeSocket): Promise<void> {
    await Promise.all(
      Array.from(socket.data.rooms).map((roomId) =>
        this.roomService.setPresence(roomId, socket.data.sessionId, socket.id),
      ),
    );
  }
}
