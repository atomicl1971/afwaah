"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function FullscreenToggle({ className }: { className?: string }) {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const doc = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;
    setAvailable(Boolean(root.requestFullscreen || root.webkitRequestFullscreen));

    const sync = () => {
      setActive(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };

    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  if (!available) return null;

  const toggle = async () => {
    const doc = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement;

    try {
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
      } else if (root.requestFullscreen) {
        await root.requestFullscreen();
      } else {
        await root.webkitRequestFullscreen?.();
      }
    } catch {
      // Browsers can reject fullscreen when policy or platform UI blocks it.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={active ? "Exit fullscreen" : "Enter fullscreen"}
      title={active ? "Exit fullscreen" : "Enter fullscreen"}
      className={
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground " +
        (className ?? "")
      }
    >
      {active ? (
        <Minimize2 className="h-4 w-4" />
      ) : (
        <Maximize2 className="h-4 w-4" />
      )}
    </button>
  );
}
