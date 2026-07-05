"use client";

import { useEffect } from "react";

type NavigatorWithVirtualKeyboard = Navigator & {
  virtualKeyboard?: {
    overlaysContent: boolean;
  };
};

export function ChatViewportController() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard)
      .virtualKeyboard;
    const previousOverlayMode = virtualKeyboard?.overlaysContent;
    let frame = 0;

    if (virtualKeyboard) {
      virtualKeyboard.overlaysContent = false;
    }

    const syncViewport = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const keyboardInset = Math.max(
        0,
        window.innerHeight - height - offsetTop,
      );

      root.style.setProperty(
        "--chat-visual-height",
        `${Math.max(320, Math.round(height))}px`,
      );
      root.style.setProperty(
        "--chat-keyboard-inset",
        `${Math.round(keyboardInset)}px`,
      );
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncViewport);
      window.setTimeout(syncViewport, 80);
      window.setTimeout(syncViewport, 260);
    };

    root.classList.add("chat-scroll-lock");
    body.classList.add("chat-scroll-lock");
    syncViewport();

    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("focusin", scheduleSync);
    window.addEventListener("focusout", scheduleSync);
    document.addEventListener("fullscreenchange", scheduleSync);
    document.addEventListener("webkitfullscreenchange", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);

    return () => {
      cancelAnimationFrame(frame);
      root.classList.remove("chat-scroll-lock");
      body.classList.remove("chat-scroll-lock");
      root.style.removeProperty("--chat-visual-height");
      root.style.removeProperty("--chat-keyboard-inset");
      if (virtualKeyboard && previousOverlayMode !== undefined) {
        virtualKeyboard.overlaysContent = previousOverlayMode;
      }
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.removeEventListener("focusin", scheduleSync);
      window.removeEventListener("focusout", scheduleSync);
      document.removeEventListener("fullscreenchange", scheduleSync);
      document.removeEventListener("webkitfullscreenchange", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
    };
  }, []);

  return null;
}
