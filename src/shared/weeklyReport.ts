/**
 * Weekly signal report: which signals belong to a week and the counts the PDF shows. Pure code.
 * A week runs Monday 00:00 to Sunday 24:00, Vietnam time, and a signal belongs to the week it was posted
 * in (whatever has happened to it since).
 */
import { computeStats, vnWeekKey, type Signal, type SignalStats } from "./signals";

const VN_OFFSET = 7 * 3_600_000;
const WEEK_MS = 7 * 86_400_000;
export const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Start and end (UTC ms) of the Vietnam-time week starting on Monday `weekKey` (YYYY-MM-DD). */
export function weekRange(weekKey: string): { start: number; end: number } {
  const start = Date.parse(`${weekKey}T00:00:00Z`) - VN_OFFSET;
  return { start, end: start + WEEK_MS };
}

/** True when `weekKey` is a real Monday (as vnWeekKey would produce it). */
export const isWeekKey = (weekKey: string) =>
  WEEK_RE.test(weekKey) && Number.isFinite(weekRange(weekKey).start) && vnWeekKey(weekRange(weekKey).start) === weekKey;

/** Weeks to offer in the picker: the current week, then every week with a signal, newest first. */
export function weekOptions(signals: Signal[], now = Date.now()): { week: string; count: number }[] {
  const counts = new Map<string, number>([[vnWeekKey(now), 0]]);
  for (const s of signals) {
    const k = vnWeekKey(Date.parse(s.createdAt));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([week, count]) => ({ week, count })).sort((a, b) => b.week.localeCompare(a.week));
}

export interface WeekSummary {
  week: string;
  start: number;
  end: number;
  /** The week was still running when the report was made. */
  inProgress: boolean;
  /** The week's signals, oldest first. */
  signals: Signal[];
  total: number;
  long: number;
  short: number;
  /** Filled (at least one entry): still open or closed. */
  filled: number;
  open: number;
  closed: number;
  /** Limit signals still waiting for their entry. */
  pending: number;
  cancelled: number;
  cancelledBy: { sl: number; tp: number; admin: number };
  /** Filled signals that reached at least TP1. */
  anyTp: number;
  /** Closed with every TP hit. */
  allTp: number;
  /** Closed by the stop. */
  sl: number;
  /** Closed by the stop after reaching at least TP1. */
  slAfterTp: number;
  /** Closed by hand. */
  manual: number;
  stats: SignalStats;
}

export function summarizeWeek(all: Signal[], week: string, now = Date.now()): WeekSummary {
  const { start, end } = weekRange(week);
  const signals = all
    .filter((s) => {
      const t = Date.parse(s.createdAt);
      return t >= start && t < end;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id);
  const count = (p: (s: Signal) => boolean) => signals.filter(p).length;
  const filled = (s: Signal) => s.status === "open" || s.status === "closed";

  return {
    week,
    start,
    end,
    inProgress: now < end,
    signals,
    total: signals.length,
    long: count((s) => s.side === "long"),
    short: count((s) => s.side === "short"),
    filled: count(filled),
    open: count((s) => s.status === "open"),
    closed: count((s) => s.status === "closed"),
    pending: count((s) => s.status === "pending"),
    cancelled: count((s) => s.status === "cancelled"),
    cancelledBy: {
      sl: count((s) => s.exit === "cancel_sl"),
      tp: count((s) => s.exit === "cancel_tp"),
      admin: count((s) => s.exit === "cancel_admin"),
    },
    anyTp: count((s) => filled(s) && s.tpHits > 0),
    allTp: count((s) => s.status === "closed" && s.exit === "tp"),
    sl: count((s) => s.status === "closed" && s.exit === "sl"),
    slAfterTp: count((s) => s.status === "closed" && s.exit === "sl" && s.tpHits > 0),
    manual: count((s) => s.status === "closed" && s.exit === "manual"),
    stats: computeStats(signals),
  };
}
