"use client";

import { useEffect } from "react";

/**
 * Keeps a --chat-visual-height CSS variable synced with the ACTUAL visible
 * viewport height (accounting for the on-screen keyboard).
 *
 * Standards-compliant browsers (Chrome, Safari) get window.visualViewport.
 * Instagram / Facebook in-app WebViews don't reliably fire visualViewport
 * resize events when the keyboard toggles, so we fall back to window.innerHeight
 * plus a heuristic that watches focus on editable elements.
 */
function isInAppWebView(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Instagram|FBAN|FBAV|FB_IAB|Line\/|Twitter|TikTok/i.test(ua);
}

export function ChatViewportController() {
  useEffect(() => {
    const root = document.documentElement;
    const inApp = isInAppWebView();

    // Baseline "full" viewport height, captured before the keyboard opens.
    let baselineHeight = window.innerHeight;

    const setHeight = (h: number) => {
      if (!h || !Number.isFinite(h)) return;
      root.style.setProperty("--chat-visual-height", `${Math.round(h)}px`);
    };

    const updateFromVisualViewport = () => {
      const vv = window.visualViewport;
      const h = vv?.height ?? window.innerHeight;
      // In a normal browser innerHeight tracks the layout viewport, which
      // stays stable when the keyboard opens; visualViewport.height shrinks.
      if (h > baselineHeight) baselineHeight = h;
      setHeight(h);
    };

    const updateFromInnerHeight = () => {
      // Instagram WebView: innerHeight itself changes when the keyboard opens
      // (unlike Chrome), so it's a decent signal on its own.
      const h = window.innerHeight;
      if (h > baselineHeight) baselineHeight = h;
      setHeight(h);
    };

    // Initial value
    updateFromVisualViewport();

    let focusFallbackTimer: number | undefined;

    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "TEXTAREA" || tag === "INPUT" || el.isContentEditable;
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      if (!inApp) return;
      // In IG WebView visualViewport rarely fires. Poll innerHeight briefly
      // right after focus so the composer stays above the keyboard.
      let ticks = 0;
      window.clearInterval(focusFallbackTimer);
      focusFallbackTimer = window.setInterval(() => {
        updateFromInnerHeight();
        ticks += 1;
        if (ticks > 12) window.clearInterval(focusFallbackTimer);
      }, 120) as unknown as number;
    };

    const onFocusOut = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      window.clearInterval(focusFallbackTimer);
      // Give the keyboard a beat to close, then restore the baseline height.
      window.setTimeout(() => {
        if (inApp) {
          const h = window.innerHeight;
          setHeight(Math.max(h, baselineHeight));
        } else {
          updateFromVisualViewport();
        }
      }, 120);
    };

    const vv = window.visualViewport;
    vv?.addEventListener("resize", updateFromVisualViewport);
    vv?.addEventListener("scroll", updateFromVisualViewport);
    window.addEventListener("resize", inApp ? updateFromInnerHeight : updateFromVisualViewport);
    window.addEventListener("orientationchange", updateFromVisualViewport);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      vv?.removeEventListener("resize", updateFromVisualViewport);
      vv?.removeEventListener("scroll", updateFromVisualViewport);
      window.removeEventListener("resize", inApp ? updateFromInnerHeight : updateFromVisualViewport);
      window.removeEventListener("orientationchange", updateFromVisualViewport);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.clearInterval(focusFallbackTimer);
      root.style.removeProperty("--chat-visual-height");
    };
  }, []);

  return null;
}
