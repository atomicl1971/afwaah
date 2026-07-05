import { LocationService } from "@campus-chat/services/services";
import { TRPCError } from "@trpc/server";

import { handleServiceResult } from "../errors";
import {
  locationStatusOutputSchema,
  verifyLocationInputSchema,
  verifyLocationOutputSchema,
} from "../schemas";
import { router, sessionProcedure } from "../trpc";

export const locationRouter = router({
  checkStatus: sessionProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/location/status",
        protected: "session",
        summary: "Check whether the current session has valid write location",
        tags: ["Location"],
      },
    })
    .output(locationStatusOutputSchema)
    .query(async ({ ctx }) => {
      const locationService = new LocationService(ctx.db, ctx.redis);
      const locationStatus = await locationService.getWriteLocationStatus(
        ctx.session.sessionId,
      );

      return {
        hasValidLocation: locationStatus.hasValidLocation,
        locationVerified: ctx.session.locationVerified,
        validUntil: locationStatus.validUntil,
      };
    }),

  verify: sessionProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/location/verify",
        protected: "session",
        summary: "Verify campus geofence location for write actions",
        tags: ["Location"],
      },
    })
    .input(verifyLocationInputSchema)
    .output(verifyLocationOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const locationService = new LocationService(ctx.db, ctx.redis);
      const result = await locationService.verifyLocation({
        ...input,
        sessionId: ctx.session.sessionId,
        userId: ctx.session.userId,
      });

      return handleServiceResult(result);
    }),

  verifyIpFallback: sessionProcedure
    .output(verifyLocationOutputSchema)
    .mutation(async ({ ctx }) => {
      if (!ctx.allowIpLocationFallback) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Fast desktop location fallback is not enabled.",
        });
      }

      const locationService = new LocationService(ctx.db, ctx.redis);
      const result = await locationService.verifyIpFallback({
        sessionId: ctx.session.sessionId,
        userId: ctx.session.userId,
      });

      return handleServiceResult(result);
    }),
});
