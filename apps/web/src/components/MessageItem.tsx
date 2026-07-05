import { useEffect, useState } from "react";
import type { Message } from "@/lib/types";
import { shortTime } from "@/lib/time";
import { MoreHorizontal, Flag, Trash2, Smile } from "lucide-react";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "👀", "💯"];

export function MessageItem({
  message,
  isMine,
  sameAuthor = false,
  onReport,
  onDelete,
  onReact,
}: {
  message: Message;
  isMine: boolean;
  sameAuthor?: boolean;
  onReport?: (m: Message) => void;
  onDelete?: (m: Message) => void;
  onReact?: (messageId: string, emoji: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactorOpen, setReactorOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  const react = (emoji: string) => {
    if (message.pending) return;
    setActionsOpen(false);
    setMenuOpen(false);
    setReactorOpen(false);
    onReact?.(message.id, emoji);
  };
  const report = () => {
    if (message.pending) return;
    setActionsOpen(false);
    setReactorOpen(false);
    setMenuOpen(false);
    onReport?.(message);
  };
  const remove = () => {
    if (message.pending) return;
    setActionsOpen(false);
    setReactorOpen(false);
    setMenuOpen(false);
    onDelete?.(message);
  };

  useEffect(() => {
    if (!actionsOpen || menuOpen || reactorOpen) return;
    const timer = window.setTimeout(() => setActionsOpen(false), 2200);
    return () => window.clearTimeout(timer);
  }, [actionsOpen, menuOpen, reactorOpen]);

  if (message.deleted) {
    return (
      <div className={`flex px-4 py-1 ${isMine ? "justify-end" : ""}`}>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] italic text-muted-foreground">
          <Trash2 className="h-3 w-3" /> message deleted
        </span>
      </div>
    );
  }


  const avatar = (
    <div
      className="mt-1 h-6 w-6 flex-shrink-0 rounded-full ring-1 ring-border"
      style={{ backgroundColor: message.displayColor }}
    />
  );
  const avatarSpacer = <div className="w-6 flex-shrink-0" />;
  const showActions = actionsOpen || menuOpen || reactorOpen;

  return (
    <div
      onPointerDown={(event) => {
        if (message.pending) return;
        const target = event.target as HTMLElement;
        if (target.closest("button,a,input,textarea")) return;
        setActionsOpen(true);
      }}
      className={
        "group relative flex gap-3 px-4 animate-msg-in " +
        (sameAuthor ? "py-0.5 " : "pt-3 pb-0.5 ") +
        (isMine ? "flex-row-reverse " : "") +
        (message.pending ? "opacity-70 " : "")
      }
    >
      {sameAuthor ? avatarSpacer : avatar}

      <div className={"min-w-0 max-w-[85%] flex-1 " + (isMine ? "flex flex-col items-end" : "")}>
        {!sameAuthor && (
          <div className={"mb-0.5 flex items-baseline gap-2 " + (isMine ? "flex-row-reverse" : "")}>
            <span
              className="truncate text-sm font-medium"
              style={{ color: message.displayColor }}
            >
              {message.displayName}
              {isMine && <span className="ml-1 text-[10px] font-normal text-muted-foreground">you</span>}
            </span>
            <span className="text-[10px] text-muted-foreground">{shortTime(message.createdAt)}</span>
          </div>
        )}
        <div
          className={
            "inline-block whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground " +
            (isMine
              ? "rounded-2xl rounded-tr-sm border border-primary/25 bg-primary/10 px-3 py-1.5"
              : "")
          }
          style={isMine ? { borderColor: `${message.displayColor}55` } : undefined}
        >
          {message.content}
        </div>
        {Object.keys(message.reactions).length > 0 && (
          <div className={"mt-1 flex flex-wrap gap-1 " + (isMine ? "justify-end" : "")}>
            {Object.entries(message.reactions).map(([emoji, count]) => {
              const mine = message.myReactions.includes(emoji);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => react(emoji)}
                  aria-label={`React with ${emoji}`}
                  className={
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition-colors " +
                    (mine
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent")
                  }
                >
                  <span>{emoji}</span>
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!message.pending && (
        <div
          className={
            "absolute top-1 flex items-center gap-0.5 rounded-md border border-border bg-popover px-0.5 py-0.5 shadow-sm transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:pointer-events-auto [@media(hover:hover)]:group-hover:opacity-100 " +
            (showActions ? "pointer-events-auto opacity-100 " : "pointer-events-none opacity-0 ") +
            (isMine ? "left-3" : "right-3")
          }
        >
          <button
            type="button"
            onClick={() => {
              setActionsOpen(true);
              setMenuOpen(false);
              setReactorOpen((v) => !v);
            }}
            className="inline-flex h-8 w-8 touch-manipulation items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="react"
            aria-expanded={reactorOpen}
          >
            <Smile className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setActionsOpen(true);
              setReactorOpen(false);
              setMenuOpen((v) => !v);
            }}
            className="inline-flex h-8 w-8 touch-manipulation items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="more"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {reactorOpen && (
        <div
          className={
            "absolute top-8 z-10 flex gap-0.5 rounded-md border border-border bg-popover p-1 shadow-md " +
            (isMine ? "left-3" : "right-3")
          }
        >
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => react(e)}
              className="inline-flex h-8 w-8 touch-manipulation items-center justify-center rounded text-base hover:bg-accent"
              aria-label={`React with ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {menuOpen && (
        <div
          className={
            "absolute top-8 z-10 w-40 rounded-md border border-border bg-popover py-1 shadow-md " +
            (isMine ? "left-3" : "right-3")
          }
        >
          {!isMine && (
            <button
              type="button"
              onClick={report}
              className="flex min-h-10 w-full touch-manipulation items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Flag className="h-3.5 w-3.5" /> Report
            </button>
          )}
          {isMine && (
            <button
              type="button"
              onClick={remove}
              className="flex min-h-10 w-full touch-manipulation items-center gap-2 px-2.5 py-1.5 text-left text-xs text-destructive hover:bg-accent"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
          {isMine && (
            <div className="px-2.5 py-1 text-[10px] text-muted-foreground/70">
              You can't report your own message
            </div>
          )}
        </div>
      )}
    </div>
  );
}
