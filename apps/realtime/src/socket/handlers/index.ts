import type { RealtimeClients } from "../../clients";
import type { RealtimeServer, RealtimeSocket } from "../../types/socket";
import type { PresenceManager } from "../presence";
import { registerMessageHandlers } from "./message";
import { registerProfileHandlers } from "./profile";
import { registerRoomHandlers } from "./room";
import { registerTypingHandlers } from "./typing";

export function registerAllHandlers(
  io: RealtimeServer,
  socket: RealtimeSocket,
  clients: RealtimeClients,
  presenceManager: PresenceManager,
): void {
  registerRoomHandlers(io, socket, clients, presenceManager);
  registerMessageHandlers(io, socket, clients, presenceManager);
  registerProfileHandlers(io, socket, clients, presenceManager);
  registerTypingHandlers(io, socket, clients, presenceManager);
}
