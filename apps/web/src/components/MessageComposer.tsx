import { useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

export function MessageComposer({
  onSend,
  onTyping,
  disabled,
  disabledReason,
  placeholder = "Message",
}: {
  onSend: (content: string) => Promise<void> | void;
  onTyping?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const v = value.trim();
    if (!v || disabled || sending) return;

    setSending(true);
    try {
      await onSend(v);
      setValue("");
    } catch {
      // The caller owns user-facing error messages; keep the draft intact.
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  if (disabled) {
    return (
      <div className="chat-composer shrink-0 border-t border-border bg-background px-4 pt-3">
        <div className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          {disabledReason ?? "You can't send messages here."}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-composer shrink-0 border-t border-border bg-background px-3 pt-3">
      <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-2 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onTyping?.();
          }}
          onKeyDown={onKey}
          rows={1}
          placeholder={placeholder}
          className="max-h-40 min-h-[1.75rem] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!value.trim() || sending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
