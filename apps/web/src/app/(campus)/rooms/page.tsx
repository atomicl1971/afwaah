"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { AccessStateBanner } from "@/components/AccessStateBanner";
import { AppShell } from "@/components/AppShell";
import { CampusModulePanel } from "@/components/CampusModulePanel";
import { RoomCreateModal } from "@/components/RoomCreateModal";
import { RoomList } from "@/components/RoomList";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/api/client";
import type { Room } from "@/lib/types";

export default function RoomsPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "public" | "private" | "mine">("all");
  const [modal, setModal] = useState(false);
  const roomsQueryKey = useMemo(
    () => ["rooms", session?.token] as const,
    [session?.token],
  );

  const { data: rooms, isLoading, refetch } = useQuery({
    enabled: !!session,
    queryKey: roomsQueryKey,
    queryFn: () => api.rooms.list(),
    refetchInterval: 5000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const visible = useMemo(() => {
    const list = rooms ?? [];
    return list.filter((r) => {
      if (filter === "public" && r.visibility !== "public") return false;
      if (filter === "private" && r.visibility !== "private") return false;
      if (filter === "mine" && !r.createdByMe) return false;
      if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [rooms, query, filter]);

  const mine = (rooms ?? []).filter((r) => r.createdByMe);
  const handleRoomCreated = (room: Room) => {
    queryClient.setQueryData<Room[]>(roomsQueryKey, (current) => {
      const existing = current ?? [];
      return [room, ...existing.filter((item) => item.id !== room.id)];
    });
    void refetch();
  };

  return (
    <AppShell maxWidth="max-w-6xl">
      <section className="min-w-0">
        {session?.ban || (session && session.writeAccess.kind !== "allowed") ? (
          <div className="mb-4">
            <AccessStateBanner ban={session?.ban ?? null} write={session?.writeAccess} />
          </div>
        ) : null}

        <div className="mb-5 flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <CampusModulePanel />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">Rooms</h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Anonymous chat for your campus.
              </p>
            </div>
          </div>
          <button
            onClick={() => setModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New
          </button>
        </div>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search rooms"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "public", "private", "mine"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "rounded-md border px-2.5 py-1.5 text-xs capitalize transition-colors " +
                  (filter === f
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent")
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {mine.length > 0 && (
          <div className="mb-4">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your rooms
            </h2>
            <RoomList rooms={mine} />
          </div>
        )}

        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {filter === "mine" ? "Your rooms" : "Discover"}
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg border border-border bg-card" />
            ))}
          </div>
        ) : (
          <RoomList rooms={visible} />
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Need to change your name or color?{" "}
          <Link href="/me" className="text-primary hover:underline">
            Edit profile
          </Link>
        </p>
      </section>

      <RoomCreateModal
        open={modal}
        onClose={() => setModal(false)}
        onCreated={handleRoomCreated}
      />
    </AppShell>
  );
}
