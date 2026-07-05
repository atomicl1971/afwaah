"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, CheckCircle2, MapPin, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api/client";
import {
  getPosition,
  isGeolocationPositionError,
  LOCATION_CACHE_MAX_AGE_MS,
  LocationVerificationError,
  QUICK_GEOLOCATION_TIMEOUT_MS,
  VERIFY_REQUEST_TIMEOUT_MS,
  withTimeout,
} from "@/lib/location";
import type { WriteAccessState } from "@/lib/types";

const SLOW_FEEDBACK_MS = 3500;

type LocationPageState =
  "allowed" | "denied" | "error" | "idle" | "loading" | "off_campus";

export default function VerifyLocationPage() {
  const { session, setWriteAccess } = useSession();
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [slowCheck, setSlowCheck] = useState(false);
  const [state, setState] = useState<LocationPageState>(
    session?.writeAccess.kind === "allowed"
      ? "allowed"
      : session?.writeAccess.kind === "off_campus"
        ? "off_campus"
        : session?.writeAccess.kind === "denied"
          ? "denied"
          : "idle",
  );

  const verify = async () => {
    setState("loading");
    setErrorMessage(null);
    setSlowCheck(false);
    setWriteAccess({ kind: "loading" });
    const slowFeedbackTimer = window.setTimeout(() => {
      setSlowCheck(true);
    }, SLOW_FEEDBACK_MS);

    try {
      if (!("geolocation" in navigator)) {
        throw new LocationVerificationError(
          "Geolocation is not available in this browser.",
        );
      }

      const res = await verifyFast();

      setErrorMessage(null);
      setState(
        res.kind === "allowed"
          ? "allowed"
          : res.kind === "off_campus"
            ? "off_campus"
            : "denied",
      );
      setWriteAccess(res);
      if (res.kind === "allowed") toast.success("Location verified");
    } catch (error) {
      const failure = locationFailure(error);
      setErrorMessage(failure.message);
      setState(failure.state);
      setWriteAccess(failure.writeAccess);
      if (failure.state === "denied") {
        toast.error(failure.message);
      }
    } finally {
      window.clearTimeout(slowFeedbackTimer);
      setSlowCheck(false);
    }
  };

  const Icon =
    state === "allowed"
      ? CheckCircle2
      : state === "off_campus" || state === "denied"
        ? XCircle
        : state === "error"
          ? AlertCircle
          : MapPin;

  const iconColor =
    state === "allowed"
      ? "var(--success)"
      : state === "off_campus" || state === "denied" || state === "error"
        ? "var(--warning)"
        : "var(--muted-foreground)";

  const title =
    state === "allowed"
      ? "You're on campus"
      : state === "off_campus"
        ? "You're off campus"
        : state === "denied"
          ? "Location permission denied"
          : state === "error"
            ? "Couldn't check location"
            : state === "loading"
              ? slowCheck
                ? "Still checking location..."
                : "Checking location..."
              : "Verify your location";

  const body =
    state === "allowed"
      ? "You can send messages anywhere in campus chat."
      : state === "off_campus"
        ? "You can browse and read, but sending is disabled off campus."
        : state === "denied"
          ? "Enable location access in your browser to write."
          : state === "error"
            ? errorMessage ??
              "Try again, or continue reading without write access."
            : state === "loading"
              ? slowCheck
                ? "Your browser is still resolving your position."
                : "Hang tight for a moment."
              : "Location is only used to enable write access. Reading works from anywhere.";

  return (
    <AppShell maxWidth="max-w-lg">
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
          style={{
            backgroundColor: `color-mix(in oklab, ${iconColor} 15%, transparent)`,
          }}
        >
          <Icon className="h-6 w-6" style={{ color: iconColor }} />
        </div>
        <h1 className="mt-4 text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>

        <div className="mt-6 flex justify-center gap-2">
          {state === "allowed" ? (
            <button
              onClick={() => router.push("/rooms")}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Continue
            </button>
          ) : (
            <button
              disabled={state === "loading"}
              onClick={verify}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {state === "loading"
                ? "Checking..."
                : state === "idle"
                  ? "Verify now"
                  : "Try again"}
            </button>
          )}
          <Link
            href="/rooms"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-accent"
          >
            Skip for now
          </Link>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Location is only used to gate writing. It is not stored or shared.
        </p>
      </div>
    </AppShell>
  );
}

async function verifyFast(): Promise<
  | { kind: "allowed"; validUntil?: string }
  | { kind: "off_campus" }
  | { kind: "denied" }
> {
  try {
    const position = await getPosition(
      {
        enableHighAccuracy: false,
        maximumAge: LOCATION_CACHE_MAX_AGE_MS,
        timeout: QUICK_GEOLOCATION_TIMEOUT_MS,
      },
      QUICK_GEOLOCATION_TIMEOUT_MS + 500,
    );

    return withTimeout(
      api.session.verifyLocation({
        accuracyMeters: position.coords.accuracy,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      VERIFY_REQUEST_TIMEOUT_MS,
      "Location verification took too long. The server may still be waking up.",
    );
  } catch (error) {
    if (
      isGeolocationPositionError(error) &&
      error.code === error.PERMISSION_DENIED
    ) {
      throw error;
    }

    return withTimeout(
      api.session.verifyLocationByIp(),
      VERIFY_REQUEST_TIMEOUT_MS,
      "Fast desktop location fallback took too long. The server may still be waking up.",
    );
  }
}

function locationFailure(error: unknown): {
  message: string;
  state: Extract<LocationPageState, "denied" | "error">;
  writeAccess: WriteAccessState;
} {
  if (
    isGeolocationPositionError(error) &&
    error.code === error.PERMISSION_DENIED
  ) {
    return {
      message: "Location permission was denied.",
      state: "denied",
      writeAccess: { kind: "denied" },
    };
  }

  if (isGeolocationPositionError(error)) {
    const message =
      error.code === error.TIMEOUT
        ? "Your browser could not resolve location."
        : "Location is unavailable in this browser right now.";

    return {
      message,
      state: "error",
      writeAccess: { kind: "error", message },
    };
  }

  const message =
    error instanceof Error
      ? error.message
      : "Location could not be checked right now.";

  return {
    message,
    state: "error",
    writeAccess: { kind: "error", message },
  };
}
