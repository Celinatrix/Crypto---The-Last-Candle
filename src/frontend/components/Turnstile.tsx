"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * Cloudflare Turnstile bot check (usually invisible for real people). Renders nothing when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set, e.g. in local development.
 * A token is single-use: call `reset()` after every request that consumed it.
 */

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const turnstileEnabled = SITE_KEY.length > 0;

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  reset(): void;
}

interface Props {
  /** A fresh token, or null when it expired / failed / was reset. */
  onToken: (token: string | null) => void;
  /** Called once if the widget could not load at all (blocked script, offline). */
  onLoadError?: () => void;
}

const Turnstile = forwardRef<TurnstileHandle, Props>(function Turnstile({ onToken, onLoadError }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const handlers = useRef({ onToken, onLoadError });

  useEffect(() => {
    handlers.current = { onToken, onLoadError };
  }, [onToken, onLoadError]);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        handlers.current.onToken(null);
        if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      },
    }),
    [],
  );

  useEffect(() => {
    if (!turnstileEnabled) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !el.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(el.current, {
          sitekey: SITE_KEY,
          theme: "dark",
          size: "flexible",
          language: "vi",
          callback: (token: string) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onToken(null),
          "error-callback": () => handlers.current.onToken(null),
        });
      })
      .catch(() => {
        if (!cancelled) handlers.current.onLoadError?.();
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  if (!turnstileEnabled) return null;
  return <div ref={el} className="turnstile" />;
});

export default Turnstile;
