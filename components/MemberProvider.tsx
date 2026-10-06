"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fetchMe } from "@/lib/api";
import type { MeResponse } from "@/lib/types";

export type MeState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: MeResponse };

interface MemberContextValue {
  state: MeState;
  /** Re-fetch /api/me, showing the skeleton while it loads. */
  reload: () => void;
  linkOpen: boolean;
  openLink: () => void;
  closeLink: () => void;
}

const MemberContext = createContext<MemberContextValue | null>(null);

/** Delay before the link popup appears, so the hero is seen first. */
const AUTO_OPEN_DELAY_MS = 700;

export function MemberProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MeState>({ kind: "loading" });
  const [linkOpen, setLinkOpen] = useState(false);
  const autoShown = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchMe(signal);
      if (!signal?.aborted) setState({ kind: "ready", data });
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

  // Ask for UID + Gmail once per page load while this browser has no linked member.
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

  const value = useMemo<MemberContextValue>(
    () => ({
      state,
      reload,
      linkOpen,
      openLink: () => setLinkOpen(true),
      closeLink: () => setLinkOpen(false),
    }),
    [state, reload, linkOpen],
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
