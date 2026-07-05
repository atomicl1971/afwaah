import type { GeofenceConfig } from "@campus-chat/database/models";

import { SessionCache, type RedisClient } from "../cache";
import { createError } from "../errors";
import {
  LocationRepository,
  SessionRepository,
  type DrizzleClient,
} from "../repositories";
import type {
  GeofenceSettings,
  LocationVerificationResult,
  Result,
  UpdateGeofenceSettingsInput,
  VerifyLocationInput,
} from "../types";
import { err, ok } from "../types";

const LOCATION_VALIDITY_MINUTES = 15;
const MIN_GEOFENCE_RADIUS_KM = 0.1;
const MAX_GEOFENCE_RADIUS_KM = 50000;

export class LocationService {
  private readonly locationRepo: LocationRepository;
  private readonly sessionCache: SessionCache;
  private readonly sessionRepo: SessionRepository;

  constructor(db: DrizzleClient, redis: RedisClient) {
    this.locationRepo = new LocationRepository(db);
    this.sessionCache = new SessionCache(redis);
    this.sessionRepo = new SessionRepository(db);
  }

  async hasValidWriteLocation(sessionId: string): Promise<boolean> {
    return Boolean(await this.locationRepo.findValidCheck(sessionId));
  }

  async getWriteLocationStatus(sessionId: string): Promise<{
    hasValidLocation: boolean;
    validUntil: Date | null;
  }> {
    const locationCheck = await this.locationRepo.findValidCheck(sessionId);

    return {
      hasValidLocation: Boolean(locationCheck),
      validUntil: locationCheck?.validUntil ?? null,
    };
  }

  async getDefaultGeofenceSettings(): Promise<Result<GeofenceSettings>> {
    const geofence = await this.locationRepo.findDefaultGeofence();
    if (!geofence) {
      return err(
        createError(
          "GEOFENCE_NOT_CONFIGURED",
          "Default geofence is not configured.",
        ),
      );
    }

    return ok(toGeofenceSettings(geofence));
  }

  async updateDefaultGeofenceSettings(
    input: UpdateGeofenceSettingsInput,
  ): Promise<Result<GeofenceSettings>> {
    const validationError = validateGeofenceSettingsInput(input);
    if (validationError) {
      return err(createError("VALIDATION_ERROR", validationError));
    }

    const geofence = await this.locationRepo.updateDefaultGeofenceRadius(
      input.radiusKm,
    );
    if (!geofence) {
      return err(
        createError(
          "GEOFENCE_NOT_CONFIGURED",
          "Default geofence is not configured.",
        ),
      );
    }

    return ok(toGeofenceSettings(geofence));
  }

  async verifyLocation(
    input: VerifyLocationInput,
  ): Promise<Result<LocationVerificationResult>> {
    const validationError = validateLocationInput(input);
    if (validationError) {
      return err(createError("VALIDATION_ERROR", validationError));
    }

    const session = await this.sessionRepo.findById(input.sessionId);
    if (!session) {
      return err(createError("SESSION_NOT_FOUND", "Session not found."));
    }
    if (session.anonymousUserId !== input.userId) {
      return err(
        createError("VALIDATION_ERROR", "Session does not belong to the user."),
      );
    }

    const geofence = await this.locationRepo.findDefaultGeofence();
    if (!geofence) {
      return err(
        createError(
          "GEOFENCE_NOT_CONFIGURED",
          "Default geofence is not configured.",
        ),
      );
    }

    const distanceFromCenterKm = distanceKm(
      input.latitude,
      input.longitude,
      Number(geofence.centerLatitude),
      Number(geofence.centerLongitude),
    );
    const radiusKm = Number(geofence.radiusKm);
    const isWithinGeofence = distanceFromCenterKm <= radiusKm;
    const validUntil = new Date(
      Date.now() + LOCATION_VALIDITY_MINUTES * 60 * 1000,
    );
    const confidenceScore =
      input.accuracyMeters && input.accuracyMeters > 500 ? 60 : 90;

    const result = {
      confidenceScore,
      distanceFromCenterKm,
      isWithinGeofence,
      validUntil,
    };

    await this.locationRepo.createCheck(input, result, geofence);
    await this.sessionCache.updateLocationVerified(
      session.tokenHash.toString("hex"),
      isWithinGeofence,
    );
    return ok(result);
  }

  async verifyIpFallback(input: {
    sessionId: string;
    userId: string;
  }): Promise<Result<LocationVerificationResult>> {
    const session = await this.sessionRepo.findById(input.sessionId);
    if (!session) {
      return err(createError("SESSION_NOT_FOUND", "Session not found."));
    }
    if (session.anonymousUserId !== input.userId) {
      return err(
        createError("VALIDATION_ERROR", "Session does not belong to the user."),
      );
    }

    const geofence = await this.locationRepo.findDefaultGeofence();
    if (!geofence) {
      return err(
        createError(
          "GEOFENCE_NOT_CONFIGURED",
          "Default geofence is not configured.",
        ),
      );
    }

    const validUntil = new Date(
      Date.now() + LOCATION_VALIDITY_MINUTES * 60 * 1000,
    );
    const result = {
      confidenceScore: 35,
      distanceFromCenterKm: 0,
      isWithinGeofence: true,
      validUntil,
    };

    await this.locationRepo.createCheck(
      {
        latitude: Number(geofence.centerLatitude),
        longitude: Number(geofence.centerLongitude),
        method: "ip_geolocation",
        sessionId: input.sessionId,
        userId: input.userId,
      },
      result,
      geofence,
    );
    await this.sessionCache.updateLocationVerified(
      session.tokenHash.toString("hex"),
      true,
    );

    return ok(result);
  }
}

function validateLocationInput(input: VerifyLocationInput): string | null {
  if (!input.userId || !input.sessionId) {
    return "userId and sessionId are required.";
  }
  if (
    !Number.isFinite(input.latitude) ||
    input.latitude < -90 ||
    input.latitude > 90
  ) {
    return "Latitude must be between -90 and 90.";
  }
  if (
    !Number.isFinite(input.longitude) ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    return "Longitude must be between -180 and 180.";
  }
  if (
    input.accuracyMeters !== undefined &&
    (!Number.isFinite(input.accuracyMeters) || input.accuracyMeters <= 0)
  ) {
    return "accuracyMeters must be positive.";
  }

  return null;
}

function validateGeofenceSettingsInput(
  input: UpdateGeofenceSettingsInput,
): string | null {
  if (
    !Number.isFinite(input.radiusKm) ||
    input.radiusKm < MIN_GEOFENCE_RADIUS_KM ||
    input.radiusKm > MAX_GEOFENCE_RADIUS_KM
  ) {
    return `radiusKm must be between ${MIN_GEOFENCE_RADIUS_KM} and ${MAX_GEOFENCE_RADIUS_KM}.`;
  }

  return null;
}

function toGeofenceSettings(geofence: GeofenceConfig): GeofenceSettings {
  return {
    centerLatitude: Number(geofence.centerLatitude),
    centerLongitude: Number(geofence.centerLongitude),
    id: geofence.id,
    isActive: geofence.isActive,
    isDefault: geofence.isDefault,
    name: geofence.name,
    radiusKm: Number(geofence.radiusKm),
    updatedAt: geofence.updatedAt,
  };
}

function distanceKm(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number,
): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(latB - latA);
  const dLon = toRadians(lonB - lonA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
