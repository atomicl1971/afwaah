import { createTRPCProxyClient, httpBatchLink } from "@campus-chat/trpc/client";
import type {
  RouterInputs,
  RouterOutputs,
  ServerRouter,
} from "@campus-chat/trpc/client";
import superjson from "superjson";

import { randomDisplayColor, randomDisplayName } from "../constants";
import { env } from "../env";
import {
  mockAdminUsers,
  mockGeofenceSettings,
  mockMessages,
  mockOverview,
  mockReports,
  mockRooms,
} from "../mocks/data";
import { loadAdminSession, loadSession } from "../session";
import type {
  AdminOverview,
  AdminUser,
  AnonSession,
  BanKind,
  BanState,
  GeofenceSettings,
  Message,
  Report,
  ReportReason,
  Room,
} from "../types";

const delay = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const trpc = createTRPCProxyClient<ServerRouter>({
  links: [
    httpBatchLink({
      transformer: superjson,
      url: env.trpcUrl,
      headers: authHeaders,
    }),
  ],
});

type SessionCreateOutput = RouterOutputs["session"]["create"];
type SessionValidateOutput = RouterOutputs["session"]["validate"];
type RoomSummaryOutput = RouterOutputs["room"]["list"]["items"][number];
type RoomDetailsOutput = RouterOutputs["room"]["getById"];
type MessageOutput = RouterOutputs["message"]["getHistory"]["items"][number];
type ReportOutput = RouterOutputs["report"]["create"];
type LocationStatusOutput = RouterOutputs["location"]["checkStatus"];
type AdminLoginOutput = RouterOutputs["admin"]["login"];
type AdminOverviewOutput = RouterOutputs["admin"]["overview"];
type AdminGeofenceOutput = RouterOutputs["admin"]["geofence"];
type AdminReportOutput = RouterOutputs["admin"]["reports"][number];
type AdminRoomOutput = RouterOutputs["admin"]["rooms"][number];
type AdminUserOutput = RouterOutputs["admin"]["users"][number];
type BanUserInput = RouterInputs["moderation"]["banUser"];

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const session = loadSession();
  const admin = loadAdminSession();

  if (session?.token) headers["x-session-token"] = session.token;
  if (admin?.token) headers["x-admin-token"] = admin.token;

  return headers;
}

async function withFallback<T>(
  real: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  if (env.useMocks) return fallback();

  try {
    return await real();
  } catch (error) {
    if (shouldUseMockFallback(error)) return fallback();
    throw readableError(error);
  }
}

function shouldUseMockFallback(error: unknown): boolean {
  const code = trpcErrorCode(error);
  if (!code) return true;
  return false;
}

function readableError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error("Request failed");
}

function trpcErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: { code?: string } }).data;
  return typeof data?.code === "string" ? data.code : null;
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
}

function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function fallbackSession(existing: AnonSession | null): AnonSession {
  if (existing) return existing;

  return {
    ban: null,
    createdAt: new Date().toISOString(),
    displayColor: randomDisplayColor(),
    displayName: randomDisplayName(),
    token: `anon_${Math.random().toString(36).slice(2, 14)}`,
    userId: `u_${Math.random().toString(36).slice(2, 10)}`,
    writeAccess: { kind: "unverified" },
  };
}

function mapSession(
  token: string,
  session: NonNullable<SessionValidateOutput["session"]>,
  banInfo: SessionCreateOutput["banInfo"],
  writeAccess?: AnonSession["writeAccess"],
): AnonSession {
  return {
    ban: mapBanInfo(banInfo),
    createdAt: toIso(session.createdAt),
    displayColor: session.displayColor,
    displayName: session.displayName,
    token,
    userId: session.userId,
    writeAccess:
      writeAccess ??
      (session.locationVerified ? { kind: "allowed" } : { kind: "unverified" }),
  };
}

function mapLocationStatus(status: LocationStatusOutput): AnonSession["writeAccess"] {
  if (status.hasValidLocation) {
    return {
      kind: "allowed",
      validUntil: status.validUntil ? toIso(status.validUntil) : undefined,
    };
  }

  return { kind: "unverified" };
}

async function getCurrentWriteAccess(
  session: NonNullable<SessionValidateOutput["session"]>,
): Promise<AnonSession["writeAccess"]> {
  if (!session.locationVerified) return { kind: "unverified" };

  const locationStatus = await trpc.location.checkStatus.query();
  return mapLocationStatus(locationStatus);
}

function mapBanInfo(
  banInfo: SessionCreateOutput["banInfo"] | SessionValidateOutput["banInfo"],
): BanState | null {
  if (!banInfo) return null;

  const kindByType = {
    global_hard_ban: "hard",
    global_write_ban: "read_only",
    quarantine: "quarantine",
    room_ban: "room_ban",
  } satisfies Record<string, BanKind>;

  return {
    expiresAt: banInfo.expiresAt ? toIso(banInfo.expiresAt) : null,
    kind: kindByType[banInfo.banType],
    reason: banInfo.reason,
    roomId: banInfo.targetRoomId ?? undefined,
  };
}

function mapRoom(
  room: RoomSummaryOutput | RoomDetailsOutput | AdminRoomOutput,
): Room {
  const createdBy = room.createdByUserId;
  const session = loadSession();

  return {
    createdAt: toIso(room.createdAt),
    createdBy,
    createdByMe: Boolean(createdBy && createdBy === session?.userId),
    description: room.description ?? undefined,
    expiresAt:
      "expiresAt" in room && room.expiresAt ? toIso(room.expiresAt) : null,
    id: room.id,
    lastActivityAt: toIso(
      "lastActivityAt" in room
        ? room.lastActivityAt
        : (room.lastMessageAt ?? room.createdAt),
    ),
    name: room.name,
    participantCount: room.participantCount,
    visibility: room.roomType === "private" ? "private" : "public",
  };
}

function mapMessage(message: MessageOutput): Message {
  const session = loadSession();

  return {
    content: message.status === "deleted" ? "" : message.body,
    createdAt: toIso(message.createdAt),
    deleted: message.status === "deleted",
    displayColor: message.displayColorSnapshot,
    displayName: message.displayNameSnapshot,
    id: message.id,
    isMine: message.userId === session?.userId,
    myReactions: message.myReactions,
    reactions: message.reactionCounts,
    roomId: message.roomId,
    userId: message.userId,
  };
}

function mapReport(report: ReportOutput | AdminReportOutput): Report {
  const targetId =
    "targetId" in report
      ? report.targetId
      : (report.targetMessageId ??
        report.targetRoomId ??
        report.targetUserId ??
        report.id);

  return {
    context: "context" in report ? report.context : undefined,
    createdAt: toIso(report.createdAt),
    details: report.description ?? undefined,
    id: report.id,
    reason: mapReportReasonToFrontend(report.reason),
    reportedUserId:
      "reportedUserId" in report
        ? (report.reportedUserId ?? undefined)
        : (report.targetUserId ?? undefined),
    reporterId: report.reporterUserId,
    roomId: report.targetRoomId ?? undefined,
    status: mapReportStatusToFrontend(report.status),
    targetId,
    targetType: report.targetType,
  };
}

function mapAdminUser(user: AdminUserOutput): AdminUser {
  return {
    banHistory: user.banHistory.map(mapBanData),
    createdAt: toIso(user.createdAt),
    currentBan: user.currentBan ? mapBanData(user.currentBan) : null,
    displayColor: user.displayColor,
    displayName: user.displayName,
    id: user.id,
    lastSeenAt: toIso(user.lastSeenAt),
    reportCount: user.reportCount,
  };
}

function mapAdminOverview(output: AdminOverviewOutput): AdminOverview {
  return {
    activeBans: output.activeBans,
    flaggedUsers: output.flaggedUsers.map(mapAdminUser),
    openReports: output.openReports,
    recentActions: output.recentActions.map((action) => ({
      ...action,
      at: toIso(action.at),
    })),
    recentRooms: output.recentRooms.map(mapRoom),
  };
}

function mapGeofenceSettings(output: AdminGeofenceOutput): GeofenceSettings {
  return {
    centerLatitude: output.centerLatitude,
    centerLongitude: output.centerLongitude,
    id: output.id,
    name: output.name,
    radiusKm: output.radiusKm,
    updatedAt: toIso(output.updatedAt),
  };
}

function mapBanData(ban: RouterOutputs["moderation"]["banUser"]): BanState {
  const kindByType = {
    global_hard_ban: "hard",
    global_write_ban: "read_only",
    quarantine: "quarantine",
    room_ban: "room_ban",
  } satisfies Record<string, BanKind>;

  return {
    expiresAt: ban.expiresAt ? toIso(ban.expiresAt) : null,
    kind: kindByType[ban.banType],
    reason: ban.reason,
    roomId: ban.targetRoomId ?? undefined,
  };
}

function mapReportReasonToServer(
  reason: string,
): RouterInputs["report"]["create"]["reason"] {
  const map: Record<string, RouterInputs["report"]["create"]["reason"]> = {
    harassment: "harassment",
    hate: "hate_speech",
    hate_speech: "hate_speech",
    off_topic: "other",
    other: "other",
    personal_info: "other",
    sexual: "illegal_content",
    spam: "spam",
    threat: "threats",
    threats: "threats",
  };

  return map[reason] ?? "other";
}

function mapReportReasonToFrontend(reason: string): ReportReason {
  const map: Record<string, ReportReason> = {
    harassment: "harassment",
    hate_speech: "hate",
    illegal_content: "other",
    impersonation: "other",
    other: "other",
    spam: "spam",
    threats: "threat",
  };

  return map[reason] ?? "other";
}

function mapReportStatusToFrontend(status: string): Report["status"] {
  if (status === "resolved") return "resolved";
  if (status === "dismissed") return "dismissed";
  return "open";
}

function mapBanKind(kind: BanKind): BanUserInput["banType"] {
  const map: Record<BanKind, BanUserInput["banType"]> = {
    hard: "global_hard_ban",
    quarantine: "quarantine",
    rate_limited: "global_write_ban",
    read_only: "global_write_ban",
    room_ban: "room_ban",
  };

  return map[kind];
}

function mapAdminLogin(output: AdminLoginOutput): {
  token: string;
  name: string;
} {
  return {
    name: output.admin.displayName,
    token: output.token,
  };
}

function mockAdminLogin(input: { email: string; password: string }) {
  if (input.password.length < 3) throw new Error("Invalid credentials");
  return {
    name: input.email.split("@")[0] ?? "admin",
    token: `admin_${Math.random().toString(36).slice(2, 12)}`,
  };
}

function canCallUuidProcedure(...values: Array<string | undefined>): boolean {
  return values.every((value) => !value || isUuid(value));
}

export const api = {
  session: {
    async bootstrap(existing: AnonSession | null): Promise<AnonSession> {
      return withFallback(
        async () => {
          if (existing?.token) {
            const validated = await trpc.session.validate.query({
              token: existing.token,
            });

            if (validated.valid && validated.session) {
              const writeAccess = await getCurrentWriteAccess(
                validated.session,
              );

              return mapSession(
                existing.token,
                validated.session,
                validated.banInfo,
                writeAccess,
              );
            }
          }

          const created = await trpc.session.create.mutate({});
          return mapSession(created.token, created.session, created.banInfo);
        },
        async () => {
          await delay(300);
          return fallbackSession(existing);
        },
      );
    },

    async updateProfile(input: {
      displayColor?: string;
      displayName?: string;
    }): Promise<void> {
      return withFallback(
        async () => {
          if (input.displayName) {
            await trpc.session.updateDisplayName.mutate({
              displayName: input.displayName,
            });
          }

          if (input.displayColor) {
            await trpc.session.updateDisplayColor.mutate({
              displayColor: input.displayColor,
            });
          }
        },
        async () => {
          await delay(200);
        },
      );
    },

    async verifyLocation(input?: {
      accuracyMeters?: number;
      latitude: number;
      longitude: number;
    }): Promise<
      | { kind: "allowed"; validUntil?: string }
      | { kind: "off_campus" }
      | { kind: "denied" }
    > {
      return withFallback(
        async () => {
          if (!input) return { kind: "denied" };

          const result = await trpc.location.verify.mutate({
            accuracyMeters: input.accuracyMeters,
            latitude: input.latitude,
            longitude: input.longitude,
            method: "browser_geolocation",
          });

          return result.isWithinGeofence
            ? { kind: "allowed", validUntil: toIso(result.validUntil) }
            : { kind: "off_campus" };
        },
        async () => {
          await delay(700);
          return {
            kind: "allowed",
            validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          };
        },
      );
    },

    async verifyLocationByIp(): Promise<
      { kind: "allowed"; validUntil?: string } | { kind: "denied" }
    > {
      return withFallback(
        async () => {
          const result = await trpc.location.verifyIpFallback.mutate();
          return result.isWithinGeofence
            ? { kind: "allowed", validUntil: toIso(result.validUntil) }
            : { kind: "denied" };
        },
        async () => {
          await delay(250);
          return {
            kind: "allowed",
            validUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          };
        },
      );
    },

    async checkLocationStatus(): Promise<AnonSession["writeAccess"]> {
      return withFallback(
        async () => mapLocationStatus(await trpc.location.checkStatus.query()),
        async () => {
          await delay(150);
          return { kind: "unverified" };
        },
      );
    },
  },

  rooms: {
    async list(): Promise<Room[]> {
      return withFallback(
        async () => {
          const rooms = await trpc.room.list.query({ limit: 100 });
          return rooms.items.map(mapRoom);
        },
        async () => {
          await delay(200);
          return mockRooms;
        },
      );
    },

    async get(id: string): Promise<Room | null> {
      return withFallback(
        async () => {
          const room = isUuid(id)
            ? await trpc.room.getById.query({ roomId: id })
            : await trpc.room.getBySlug.query({ slug: id });
          return mapRoom(room);
        },
        async () => {
          await delay(200);
          return mockRooms.find((room) => room.id === id) ?? null;
        },
      );
    },

    async create(input: {
      description?: string;
      name: string;
      visibility: "public" | "private";
    }): Promise<Room> {
      return withFallback(
        async () => {
          const room = await trpc.room.create.mutate({
            description: input.description,
            name: input.name,
            roomType: input.visibility,
          });
          return mapRoom(room);
        },
        async () => {
          await delay(300);
          return {
            createdAt: new Date().toISOString(),
            createdBy: "me",
            createdByMe: true,
            description: input.description,
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            id: `r_${Math.random().toString(36).slice(2, 8)}`,
            lastActivityAt: new Date().toISOString(),
            name: input.name,
            participantCount: 1,
            visibility: input.visibility,
          };
        },
      );
    },

    async limits(): Promise<{
      currentRoomsCreated: number;
      maxRoomsPerUser: number;
    }> {
      return withFallback(
        async () => trpc.room.creationLimits.query(),
        async () => {
          await delay(120);
          return { currentRoomsCreated: 1, maxRoomsPerUser: 3 };
        },
      );
    },

    async createInvite(roomId: string): Promise<{ code: string; url: string }> {
      if (!isUuid(roomId)) {
        await delay(200);
        const code = Math.random().toString(36).slice(2, 10).toUpperCase();
        return { code, url: `${origin()}/rooms/${roomId}?inviteCode=${code}` };
      }

      return withFallback(
        async () => {
          const info = await trpc.room.getShareInfo.query({ roomId });
          return {
            code: info.inviteCode ?? "",
            url: `${origin()}${info.sharePath}`,
          };
        },
        async () => {
          await delay(200);
          const code = Math.random().toString(36).slice(2, 10).toUpperCase();
          return {
            code,
            url: `${origin()}/rooms/${roomId}?inviteCode=${code}`,
          };
        },
      );
    },

    async joinByInvite(
      roomId: string,
      code: string,
    ): Promise<{
      ok: boolean;
      reason?: "invalid" | "expired" | "disabled" | "room_banned";
    }> {
      if (!isUuid(roomId)) {
        await delay(300);
        if (code === "EXPIRED") return { ok: false, reason: "expired" };
        if (code === "INVALID") return { ok: false, reason: "invalid" };
        return { ok: true };
      }

      try {
        await trpc.room.join.mutate({ inviteCode: code, roomId });
        return { ok: true };
      } catch (error) {
        if (shouldUseMockFallback(error)) {
          if (code === "EXPIRED") return { ok: false, reason: "expired" };
          if (code === "INVALID") return { ok: false, reason: "invalid" };
          return { ok: true };
        }

        const message = readableError(error).message.toLowerCase();
        if (message.includes("banned"))
          return { ok: false, reason: "room_banned" };
        if (message.includes("expired"))
          return { ok: false, reason: "expired" };
        if (message.includes("disabled"))
          return { ok: false, reason: "disabled" };
        return { ok: false, reason: "invalid" };
      }
    },

    async leave(roomId: string): Promise<void> {
      if (!isUuid(roomId)) {
        await delay(250);
        return;
      }

      return withFallback(
        async () => {
          await trpc.room.leave.mutate({ roomId });
        },
        async () => {
          await delay(250);
        },
      );
    },
  },

  messages: {
    async list(roomId: string): Promise<Message[]> {
      if (!isUuid(roomId)) {
        await delay(200);
        return mockMessages.filter((message) => message.roomId === roomId);
      }

      return withFallback(
        async () => {
          const result = await trpc.message.getHistory.query({
            limit: 100,
            roomId,
          });
          return result.items.map(mapMessage).reverse();
        },
        async () => {
          await delay(200);
          return mockMessages.filter((message) => message.roomId === roomId);
        },
      );
    },

    async send(_input: { content: string; roomId: string }): Promise<void> {
      await delay(150);
    },

    async react(input: {
      emoji: string;
      messageId: string;
      remove?: boolean;
    }): Promise<void> {
      if (!isUuid(input.messageId)) {
        await delay(120);
        return;
      }

      return withFallback(
        async () => {
          if (input.remove) {
            await trpc.message.removeReaction.mutate({
              emoji: input.emoji,
              messageId: input.messageId,
            });
          } else {
            await trpc.message.addReaction.mutate({
              emoji: input.emoji,
              messageId: input.messageId,
            });
          }
        },
        async () => {
          await delay(120);
        },
      );
    },

    async remove(messageId: string): Promise<void> {
      if (!isUuid(messageId)) {
        await delay(150);
        return;
      }

      return withFallback(
        async () => {
          await trpc.message.deleteOwn.mutate({ messageId });
        },
        async () => {
          await delay(150);
        },
      );
    },
  },

  reports: {
    async create(input: {
      context?: Report["context"];
      details?: string;
      reportedUserId?: string;
      reporterId?: string;
      roomId?: string;
      targetId: string;
      targetType: "message" | "room" | "user";
      reason: string;
    }): Promise<Report> {
      if (
        !canCallUuidProcedure(
          input.targetId,
          input.roomId,
          input.reportedUserId,
        )
      ) {
        return createMockReport(input);
      }

      return withFallback(
        async () => {
          const report = await trpc.report.create.mutate({
            description: input.details,
            evidenceSnapshot: input.context,
            reason: mapReportReasonToServer(input.reason),
            targetMessageId:
              input.targetType === "message" ? input.targetId : undefined,
            targetRoomId:
              input.targetType === "room" ? input.targetId : undefined,
            targetType: input.targetType,
            targetUserId:
              input.targetType === "user"
                ? input.targetId
                : input.reportedUserId,
          });

          return mapReport(report);
        },
        async () => createMockReport(input),
      );
    },
  },

  admin: {
    async login(input: {
      email: string;
      password: string;
    }): Promise<{ token: string; name: string }> {
      return withFallback(
        async () => mapAdminLogin(await trpc.admin.login.mutate(input)),
        async () => {
          await delay(400);
          return mockAdminLogin(input);
        },
      );
    },

    async overview(): Promise<AdminOverview> {
      return withFallback(
        async () => mapAdminOverview(await trpc.admin.overview.query()),
        async () => {
          await delay(250);
          return mockOverview;
        },
      );
    },

    async geofence(): Promise<GeofenceSettings> {
      return withFallback(
        async () => mapGeofenceSettings(await trpc.admin.geofence.query()),
        async () => {
          await delay(180);
          return { ...mockGeofenceSettings };
        },
      );
    },

    async updateGeofenceRadius(radiusKm: number): Promise<GeofenceSettings> {
      return withFallback(
        async () =>
          mapGeofenceSettings(
            await trpc.admin.updateGeofence.mutate({ radiusKm }),
          ),
        async () => {
          await delay(220);
          mockGeofenceSettings.radiusKm = radiusKm;
          mockGeofenceSettings.updatedAt = new Date().toISOString();
          return { ...mockGeofenceSettings };
        },
      );
    },

    async reports(): Promise<Report[]> {
      return withFallback(
        async () =>
          (await trpc.admin.reports.query({ limit: 100 })).map(mapReport),
        async () => {
          await delay(220);
          return mockReports;
        },
      );
    },

    async resolveReport(reportId: string): Promise<void> {
      if (!isUuid(reportId)) {
        await delay(180);
        return;
      }

      return withFallback(
        async () => {
          await trpc.moderation.resolveReport.mutate({
            reportId,
            resolutionAction: "resolved",
            status: "resolved",
          });
        },
        async () => {
          await delay(180);
        },
      );
    },

    async dismissReport(reportId: string): Promise<void> {
      if (!isUuid(reportId)) {
        await delay(180);
        return;
      }

      return withFallback(
        async () => {
          await trpc.moderation.resolveReport.mutate({
            reportId,
            resolutionAction: "dismissed",
            status: "dismissed",
          });
        },
        async () => {
          await delay(180);
        },
      );
    },

    async user(id: string): Promise<AdminUser | null> {
      if (!isUuid(id)) {
        await delay(220);
        return (
          mockAdminUsers.find((user) => user.id === id) ??
          mockAdminUsers[0] ??
          null
        );
      }

      return withFallback(
        async () => {
          const user = await trpc.admin.user.query({ userId: id });
          return user ? mapAdminUser(user) : null;
        },
        async () => {
          await delay(220);
          return (
            mockAdminUsers.find((user) => user.id === id) ??
            mockAdminUsers[0] ??
            null
          );
        },
      );
    },

    async users(): Promise<AdminUser[]> {
      return withFallback(
        async () =>
          (await trpc.admin.users.query({ limit: 100 })).map(mapAdminUser),
        async () => {
          await delay(220);
          return mockAdminUsers;
        },
      );
    },

    async banUser(input: {
      expiresAt?: string | null;
      kind: BanState["kind"];
      reason?: string;
      roomId?: string;
      userId: string;
    }): Promise<void> {
      if (!isUuid(input.userId) || (input.roomId && !isUuid(input.roomId))) {
        await delay(250);
        return;
      }

      return withFallback(
        async () => {
          const isPermanent = !input.expiresAt;
          await trpc.moderation.banUser.mutate({
            banType: mapBanKind(input.kind),
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
            isPermanent,
            reason: input.reason ?? "Moderation action",
            targetRoomId: input.kind === "room_ban" ? input.roomId : undefined,
            targetUserId: input.userId,
          });
        },
        async () => {
          await delay(250);
        },
      );
    },

    async rooms(): Promise<Room[]> {
      return withFallback(
        async () => (await trpc.admin.rooms.query({ limit: 100 })).map(mapRoom),
        async () => {
          await delay(220);
          return mockRooms;
        },
      );
    },

    async room(id: string): Promise<Room | null> {
      if (!isUuid(id)) {
        await delay(200);
        return mockRooms.find((room) => room.id === id) ?? null;
      }

      return withFallback(
        async () => {
          const room = await trpc.admin.room.query({ roomId: id });
          return room ? mapRoom(room) : null;
        },
        async () => {
          await delay(200);
          return mockRooms.find((room) => room.id === id) ?? null;
        },
      );
    },

    async roomMessages(roomId: string): Promise<Message[]> {
      if (!isUuid(roomId)) {
        await delay(200);
        return mockMessages.filter((message) => message.roomId === roomId);
      }

      return withFallback(
        async () => {
          const result = await trpc.admin.roomMessages.query({
            limit: 100,
            roomId,
          });
          return result.map(mapMessage).reverse();
        },
        async () => {
          await delay(200);
          return mockMessages.filter((message) => message.roomId === roomId);
        },
      );
    },

    async removeRoom(id: string): Promise<void> {
      if (!isUuid(id)) {
        await delay(220);
        return;
      }

      return withFallback(
        async () => {
          await trpc.admin.removeRoom.mutate({ roomId: id });
        },
        async () => {
          await delay(220);
        },
      );
    },
  },
};

async function createMockReport(input: {
  context?: Report["context"];
  details?: string;
  reportedUserId?: string;
  reporterId?: string;
  roomId?: string;
  targetId: string;
  targetType: "message" | "room" | "user";
  reason: string;
}): Promise<Report> {
  await delay(220);

  const report: Report = {
    context: input.context,
    createdAt: new Date().toISOString(),
    details: input.details,
    id: `rep_${Date.now().toString(36)}`,
    reason: input.reason,
    reportedUserId: input.reportedUserId,
    reporterId: input.reporterId,
    roomId: input.roomId,
    status: "open",
    targetId: input.targetId,
    targetType: input.targetType,
  };

  mockReports.unshift(report);
  return report;
}

export type Api = typeof api;
