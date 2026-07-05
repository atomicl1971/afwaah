import { useEffect, useState } from "react";
import type { Message } from "@/lib/types";
import { api } from "@/lib/api/client";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

type State = "idle" | "loading" | "success" | "error";

export function DeleteMessageDialog({
  open,
  message,
  onClose,
  onDelete,
  onDeleted,
}: {
  open: boolean;
  message: Message | null;
  onClose: () => void;
  onDelete?: (id: string) => Promise<void>;
  onDeleted: (id: string) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setState("idle");
      setError(null);
    }
  }, [open, message?.id]);

  if (!open || !message) return null;

  const confirm = async () => {
    setState("loading");
    setError(null);
    try {
      await (onDelete ?? api.messages.remove)(message.id);
      setState("success");
      onDeleted(message.id);
      setTimeout(() => onClose(), 600);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm animate-fade-in"
      onClick={state === "loading" ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-popover shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Delete message?</h2>
              <p className="text-[11px] text-muted-foreground">This cannot be undone.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={state === "loading"}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="mb-1 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: message.displayColor }}
              />
              <span
                className="text-xs font-medium"
                style={{ color: message.displayColor }}
              >
                {message.displayName}
              </span>
            </div>
            <p
              className="text-xs text-foreground/90"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {message.content}
            </p>
          </div>

          {state === "error" && error && (
            <p className="mt-2 text-[11px] text-destructive">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          <button
            onClick={onClose}
            disabled={state === "loading"}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={state === "loading" || state === "success"}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-70"
          >
            {state === "loading" && <Loader2 className="h-3 w-3 animate-spin" />}
            {state === "success" && <Check className="h-3 w-3" />}
            {state === "idle" && "Delete message"}
            {state === "loading" && "Deleting…"}
            {state === "success" && "Deleted"}
            {state === "error" && "Try again"}
          </button>
        </div>
      </div>
    </div>
  );
}
