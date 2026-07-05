import { createError } from "../errors";
import {
  LocationRepository,
  ModerationRepository,
  RoomRepository,
  type DrizzleClient,
} from "../repositories";
import type { Result } from "../types";
import { err, ok } from "../types";

export class WriteGuardService {
  private readonly locationRepo: LocationRepository;
  private readonly moderationRepo: ModerationRepository;
  private readonly roomRepo: RoomRepository;

  constructor(db: DrizzleClient) {
    this.locationRepo = new LocationRepository(db);
    this.moderationRepo = new ModerationRepository(db);
    this.roomRepo = new RoomRepository(db);
  }

  async requireWriteAccess(input: {
    roomAlreadyValidated?: boolean;
    roomId?: string;
    sessionId: string;
    userId: string;
  }): Promise<Result<void>> {
    const interactionAccess = await this.requireInteractionAccess(input);
    if (!interactionAccess.ok) return err(interactionAccess.error);

    return this.requireCampusWriteAccess(input.sessionId);
  }

  async requireInteractionAccess(input: {
    roomAlreadyValidated?: boolean;
    roomId?: string;
    sessionId: string;
    userId: string;
  }): Promise<Result<void>> {
    if (input.roomId && !input.roomAlreadyValidated) {
      const roomAccess = await this.requireActiveRoom(input.roomId);
      if (!roomAccess.ok) return err(roomAccess.error);
    }

    const activeBan = await this.moderationRepo.findMostSevereActiveBan(input);
    if (activeBan && activeBan.banType !== "room_ban") {
      return err(
        createError("BAN_ACTIVE", "User is banned from interacting.", {
          banType: activeBan.banType,
        }),
      );
    }
    if (activeBan?.banType === "room_ban") {
      return err(createError("ROOM_BANNED", "User is banned from this room."));
    }

    return ok(undefined);
  }

  async requireRoomEntryAccess(input: {
    roomId: string;
    sessionId?: string;
    userId: string;
  }): Promise<Result<void>> {
    const [activeBan, roomBan] = await Promise.all([
      this.moderationRepo.findMostSevereActiveBan(input),
      this.moderationRepo.findActiveRoomBan(input),
    ]);
    if (activeBan?.banType === "global_hard_ban") {
      return err(
        createError("BAN_ACTIVE", "User is banned from accessing the app.", {
          banType: activeBan.banType,
        }),
      );
    }
    if (roomBan) {
      return err(createError("ROOM_BANNED", "User is banned from this room."));
    }

    return ok(undefined);
  }

  async requireCampusWriteAccess(sessionId: string): Promise<Result<void>> {
    const locationCheck = await this.locationRepo.findValidCheck(sessionId);

    if (!locationCheck) {
      return err(
        createError(
          "LOCATION_OUTSIDE_GEOFENCE",
          "A valid campus location check is required before writing.",
        ),
      );
    }

    return ok(undefined);
  }

  private async requireActiveRoom(roomId: string): Promise<Result<void>> {
    const room = await this.roomRepo.findById(roomId);
    if (!room) return err(createError("ROOM_NOT_FOUND", "Room not found."));

    if (room.status === "locked") {
      return err(createError("ROOM_LOCKED", "Room is locked."));
    }
    if (room.status === "archived") {
      return err(createError("ROOM_ARCHIVED", "Room is archived."));
    }
    if (room.status !== "active") {
      return err(createError("ROOM_NOT_FOUND", "Room is not active."));
    }
    if (room.expiresAt && room.expiresAt <= new Date()) {
      return err(createError("ROOM_EXPIRED", "Room has expired."));
    }

    return ok(undefined);
  }
}
