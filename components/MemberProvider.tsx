"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchMe, logout } from "@/lib/api";
import { clearLink, readLink, saveLink } from "@/lib/linkSession";
import type { MeResponse } from "@/lib/types";

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
  /** Call after a successful POST /api/register: remembers the link for 24h on this device. */
  markLinked: (uid: string, email: string) => void;
  /** Forget this device's link and clear the backend cookie. */
  signOut: () => Promise<void>;
  linkOpen: boolean;
  openLink: () => void;
  closeLink: () => void;
}

const MemberContext = createContext<MemberContextValue | null>(null);

/** Delay before the link popup appears, so the hero is seen first. */
const AUTO_OPEN_DELAY_MS = 700;
const NOT_LINKED: MeState = { kind: "ready", data: { member: null } };

export function MemberProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MeState>({ kind: "loading" });
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const autoShown = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const link = readLink();
    if (!link) {
      // No link saved on this device within the last 24h: ask for UID + Gmail again,
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

  // When the 24h window ends while the page is open, forget the link and ask again.
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

  // Ask for UID + Gmail once per page load while this device is not linked.
  // Closing it only dismisses it until the next visit.
  useEffect(() => {
    if (autoShown.current || state.kind !== "ready" || state.data.member) return;
    autoShown.current = true;
    const id = window.setTimeout(() => setLinkOpen(true), AUTO_OPEN_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [state]);

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
      openLink: () => setLinkOpen(true),
      closeLink: () => setLinkOpen(false),
    }),
    [state, expiresAt, reload, markLinked, signOut, linkOpen],
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
