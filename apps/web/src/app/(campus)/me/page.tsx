"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shuffle } from "lucide-react";
import { toast } from "sonner";
import { AccessStateBanner } from "@/components/AccessStateBanner";
import { AppShell } from "@/components/AppShell";
import { LocationStatus } from "@/components/LocationStatus";
import { ProfileColorPicker } from "@/components/ProfileColorPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api/client";
import { randomDisplayName } from "@/lib/constants";
import {
  refreshRealtimeProfile,
  resetRealtimeConnection,
} from "@/lib/realtime/client";

export default function ProfilePage() {
  const { session, update } = useSession();
  const [name, setName] = useState(session?.displayName ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (session) setName(session.displayName);
  }, [session?.displayName, session]);

  if (!session) {
    return (
      <AppShell>
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      </AppShell>
    );
  }

  const displayName = name || session.displayName;

  const save = async () => {
    const nextName = displayName.trim();
    if (!nextName || nextName === session.displayName) return;

    setSaving(true);
    try {
      await api.session.updateProfile({ displayName: nextName });
      update({ displayName: nextName });
      await syncRealtimeProfile();
      setName(nextName);
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Profile update failed");
    } finally {
      setSaving(false);
    }
  };

  const rerollName = () => setName(randomDisplayName());

  const setColor = async (c: string) => {
    update({ displayColor: c });
    try {
      await api.session.updateProfile({ displayColor: c });
      await syncRealtimeProfile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Color update failed");
    }
  };

  return (
    <AppShell maxWidth="max-w-xl">
      <h1 className="text-lg font-semibold tracking-tight">Profile</h1>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Your identity is anonymous and only used inside campus chat.
      </p>

      {(session.ban || session.writeAccess.kind !== "allowed") && (
        <div className="mt-4">
          <AccessStateBanner ban={session.ban} write={session.writeAccess} />
        </div>
      )}

      <div className="mt-6 space-y-6">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-3">
            <span
              className="h-10 w-10 rounded-full ring-1 ring-border"
              style={{ backgroundColor: session.displayColor }}
            />
            <div>
              <div className="text-sm font-medium">{session.displayName}</div>
              <div className="text-xs text-muted-foreground">
                Session {session.token.slice(0, 10)}...
              </div>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Display name</span>
            <div className="mt-1 flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
              <button
                onClick={rerollName}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Shuffle className="h-3.5 w-3.5" /> Random
              </button>
            </div>
          </label>

          <div className="mt-4">
            <span className="text-xs font-medium text-muted-foreground">Display color</span>
            <div className="mt-2">
              <ProfileColorPicker value={session.displayColor} onChange={setColor} />
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              disabled={saving || displayName === session.displayName}
              onClick={save}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save name"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Theme</div>
              <div className="text-xs text-muted-foreground">Switch appearance.</div>
            </div>
            <ThemeToggle />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Location</div>
              <div className="text-xs text-muted-foreground">Required to send messages.</div>
            </div>
            <div className="flex items-center gap-2">
              <LocationStatus state={session.writeAccess} />
              <Link
                href="/verify-location"
                className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent"
              >
                Manage
              </Link>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

async function syncRealtimeProfile(): Promise<void> {
  const refreshed = await refreshRealtimeProfile();
  if (!refreshed) resetRealtimeConnection();
}
