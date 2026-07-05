/**
 * Frontend contract types — reference only.
 * NOT final backend types. Real types come from `@campus-chat/trpc/client` in the monorepo.
 */

export type SessionToken = string;

export interface AnonSession {
  token: SessionToken;
  userId: string;
  displayName: string;
  displayColor: string; // hex, e.g. "#7dd3fc"
  createdAt: string;
  writeAccess: WriteAccessState;
  ban: BanState | null;
}

export type WriteAccessState =
  | { kind: "allowed"; validUntil?: string }
  | { kind: "off_campus" }
  | { kind: "unverified" }
  | { kind: "denied" }
  | { kind: "loading" }
  | { kind: "error"; message: string };

export type BanKind =
  "hard" | "read_only" | "quarantine" | "room_ban" | "rate_limited";

export interface BanState {
  kind: BanKind;
  reason?: string;
  expiresAt?: string | null;
  roomId?: string;
}

export interface Room {
  id: string;
  name: string;
  description?: string;
  expiresAt?: string | null;
  visibility: "public" | "private";
  participantCount: number;
  lastActivityAt: string;
  createdBy: string;
  createdAt: string;
  createdByMe?: boolean;
}

export interface RoomLimits {
  maxRoomsPerUser: number;
  currentRoomsCreated: number;
}

export interface Message {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  displayColor: string;
  content: string;
  createdAt: string;
  reactions: Record<string, number>; // emoji -> count
  myReactions: string[];
  deleted?: boolean;
  isMine?: boolean;
  pending?: boolean;
}

export interface MessageReactionUpdate {
  emoji: string;
  messageId: string;
  reactionCounts: Record<string, number>;
  reacted: boolean;
  roomId: string;
  userId: string;
}

export interface Presence {
  userId: string;
  displayName: string;
  displayColor: string;
}

export interface TypingUser {
  userId: string;
  displayName: string;
}

export type ReportReason =
  | "harassment"
  | "spam"
  | "hate"
  | "threat"
  | "sexual"
  | "personal_info"
  | "off_topic"
  | "other";

export interface Report {
  id: string;
  targetType: "message" | "user" | "room";
  targetId: string;
  reason: ReportReason | string;
  details?: string;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  reporterId?: string;
  reportedUserId?: string;
  roomId?: string;
  context?: {
    messageContent?: string;
    roomName?: string;
    displayName?: string;
    displayColor?: string;
  };
}

export interface AdminUser {
  id: string;
  displayName: string;
  displayColor: string;
  createdAt: string;
  lastSeenAt: string;
  reportCount: number;
  banHistory: BanState[];
  currentBan: BanState | null;
}

export interface AdminOverview {
  openReports: number;
  activeBans: number;
  recentRooms: Room[];
  flaggedUsers: AdminUser[];
  recentActions: {
    id: string;
    action: string;
    target: string;
    admin: string;
    at: string;
  }[];
}

export interface GeofenceSettings {
  centerLatitude: number;
  centerLongitude: number;
  id: string;
  name: string;
  radiusKm: number;
  updatedAt: string;
}
