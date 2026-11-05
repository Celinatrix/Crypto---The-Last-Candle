"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchMe, logout } from "@/frontend/lib/api";
import { clearLink, readLink, saveLink } from "@/frontend/lib/linkSession";
import type { MeResponse } from "@/shared/types";

export type MeState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: MeResponse };

interface MemberContextValue {
  state: MeState;
  /** When this device's saved link expires (ms), or null when not linked. */
  expiresAt: number | null;
  /** Re-fetch /api/me, showing the skeleton while it loads. */
  reload: () => void;
  /** Call after a successful OTP check: remembers the link for 7 days on this device. */
  markLinked: (uid: string, email: string) => void;
  /** Forget this device's link and clear the backend cookie. */
  signOut: () => Promise<void>;
  linkOpen: boolean;
  openLink: () => void;
  closeLink: () => void;
}

const MemberContext = createContext<MemberContextValue | null>(null);

const NOT_LINKED: MeState = { kind: "ready", data: { member: null } };

export function MemberProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MeState>({ kind: "loading" });
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const link = readLink();
    if (!link) {
      // No link saved on this device within the last 7 days: ask for UID + Gmail again,
      // and drop any older backend cookie so the two never disagree.
      setExpiresAt(null);
      setState(NOT_LINKED);
      void logout().catch(() => undefined);
      return;
    }
    setExpiresAt(link.expiresAt);
    try {
      const data = await fetchMe(signal);
      if (signal?.aborted) return;
      if (!data.member) {
        clearLink();
        setExpiresAt(null);
      }
      setState({ kind: "ready", data });
    } catch (err) {
      if (signal?.aborted) return;
      setState({ kind: "error", message: err instanceof Error ? err.message : "Đã có lỗi xảy ra." });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  // When the 7-day window ends while the page is open, forget the link and ask again.
  useEffect(() => {
    if (expiresAt === null) return;
    const id = window.setTimeout(() => {
      clearLink();
      setExpiresAt(null);
      setState(NOT_LINKED);
      void logout().catch(() => undefined);
      setLinkOpen(true);
    }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [expiresAt]);

  const openLink = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLinkOpen(true);
  }, []);

  const closeLink = useCallback(() => {
    setLinkOpen(false);
    opener.current?.focus({ preventScroll: true });
    opener.current = null;
  }, []);

  const reload = useCallback(() => {
    setState({ kind: "loading" });
    void load();
  }, [load]);

  const markLinked = useCallback(
    (uid: string, email: string) => {
      saveLink(uid, email);
      reload();
    },
    [reload],
  );

  const signOut = useCallback(async () => {
    clearLink();
    await logout().catch(() => undefined);
  }, []);

  const value = useMemo<MemberContextValue>(
    () => ({
      state,
      expiresAt,
      reload,
      markLinked,
      signOut,
      linkOpen,
      openLink,
      closeLink,
    }),
    [state, expiresAt, reload, markLinked, signOut, linkOpen, openLink, closeLink],
  );

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}

export function useMember(): MemberContextValue {
  const ctx = useContext(MemberContext);
  if (!ctx) throw new Error("useMember must be used inside <MemberProvider>");
  return ctx;
}

/** The linked member, or null while loading / not linked. */
export function useLinkedMember() {
  const { state } = useMember();
  return state.kind === "ready" ? state.data.member : null;
}
