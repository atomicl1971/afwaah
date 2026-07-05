import { useState } from "react";
import { X, Lock, Globe } from "lucide-react";
import { api } from "@/lib/api/client";
import type { Room } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export function RoomCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (room: Room) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [submitting, setSubmitting] = useState(false);

  const { data: limits } = useQuery({
    queryKey: ["room-limits"],
    queryFn: () => api.rooms.limits(),
    enabled: open,
  });

  if (!open) return null;

  const atLimit = limits ? limits.currentRoomsCreated >= limits.maxRoomsPerUser : false;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || atLimit) return;
    setSubmitting(true);
    try {
      const room = await api.rooms.create({
        description: description.trim() || undefined,
        name: name.trim(),
        visibility,
      });
      toast.success("Room created");
      setName("");
      setDescription("");
      setVisibility("public");
      onCreated(room);
      onClose();
    } catch {
      toast.error("Could not create room");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Create a room</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Rooms are visible to anyone on campus.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="north-quad-study-group"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Description <span className="opacity-60">(optional)</span></span>
          <input
            value={description}
            maxLength={120}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this room for?"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </label>

        <div className="mt-3">
          <span className="text-xs font-medium text-muted-foreground">Visibility</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["public", "private"] as const).map((v) => {
              const active = visibility === v;
              const Icon = v === "public" ? Globe : Lock;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-sm capitalize transition-colors " +
                    (active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent")
                  }
                >
                  <Icon className="h-4 w-4" /> {v}
                </button>
              );
            })}
          </div>
        </div>

        {limits && (
          <p className="mt-3 text-xs text-muted-foreground">
            {atLimit ? (
              <span className="text-warning" style={{ color: "var(--warning)" }}>
                Room limit reached ({limits.currentRoomsCreated}/{limits.maxRoomsPerUser}).
              </span>
            ) : (
              <>Rooms used: {limits.currentRoomsCreated} of {limits.maxRoomsPerUser}</>
            )}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || atLimit}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
