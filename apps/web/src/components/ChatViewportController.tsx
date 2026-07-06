"use client";

import { useEffect } from "react";

type NavigatorWithVirtualKeyboard = Navigator & {
  virtualKeyboard?: {
    overlaysContent: boolean;
  };
};

const IN_APP_BROWSER_RE = /Instagram|FBAN|FBAV|FB_IAB|FB4A/i;

export function ChatViewportController() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard)
      .virtualKeyboard;
    const previousOverlayMode = virtualKeyboard?.overlaysContent;
    let frame = 0;
    let keyboardLikelyOpen = false;
    const isInApp = IN_APP_BROWSER_RE.test(navigator.userAgent);

    // Capture the real full-screen height BEFORE any keyboard opens.
    // This is the only reliable baseline we have in broken in-app browsers.
    let fullHeight = window.innerHeight;

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

      // Update fullHeight when keyboard is NOT open — this tracks
      // orientation changes and toolbar show/hide correctly.
      if (!keyboardLikelyOpen) {
        fullHeight = window.innerHeight;
      }

      // Instagram's in-app browser doesn't shrink visualViewport when
      // the keyboard opens — keyboardInset stays ~0. We detect this and
      // estimate the keyboard height dynamically based on screen density
      // and dimensions instead of using a fixed percentage.
      let effectiveHeight = height;

      if (keyboardLikelyOpen && isInApp && keyboardInset < 24) {
        // Estimate keyboard height based on actual screen metrics.
        // Phones typically show keyboards between 240-360px in CSS pixels.
        // Scale with screen width: wider screens (tablets) get taller
        // keyboards; narrow phones get shorter ones.
        const screenW = window.screen.width;
        const dpr = window.devicePixelRatio || 1;
        const cssScreenW = screenW / (dpr > 1 ? 1 : dpr);

        // Keyboard height heuristic:
        // - Small phones (<=360px wide): ~240px
        // - Normal phones (360-414px): ~280px
        // - Large phones (414px+): ~310px
        // - Tablets (768px+): ~340px
        let estimatedKeyboard: number;
        if (cssScreenW >= 768) {
          estimatedKeyboard = 340;
        } else if (cssScreenW >= 414) {
          estimatedKeyboard = 310;
        } else if (cssScreenW >= 360) {
          estimatedKeyboard = 280;
        } else {
          estimatedKeyboard = 240;
        }

        // Never let the keyboard estimate exceed 45% of fullHeight —
        // safety cap so the chat area is always usable.
        estimatedKeyboard = Math.min(estimatedKeyboard, fullHeight * 0.45);

        effectiveHeight = fullHeight - estimatedKeyboard;
      }

      root.style.setProperty(
        "--chat-visual-height",
        `${Math.max(320, Math.round(effectiveHeight))}px`,
      );
      root.style.setProperty(
        "--chat-keyboard-inset",
        `${Math.round(keyboardInset < 24 && keyboardLikelyOpen && isInApp ? fullHeight - effectiveHeight : keyboardInset)}px`,
      );
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncViewport);
      window.setTimeout(syncViewport, 80);
      window.setTimeout(syncViewport, 260);
    };

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase();
        if (
          tag === "textarea" ||
          tag === "input" ||
          target.isContentEditable
        ) {
          keyboardLikelyOpen = true;
          scheduleSync();
          return;
        }
      }
      scheduleSync();
    };

    const onFocusOut = () => {
      keyboardLikelyOpen = false;
      window.setTimeout(scheduleSync, 120);
    };

    root.classList.add("chat-scroll-lock");
    body.classList.add("chat-scroll-lock");
    syncViewport();

    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
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
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("fullscreenchange", scheduleSync);
      document.removeEventListener("webkitfullscreenchange", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
    };
  }, []);

  return null;
}
