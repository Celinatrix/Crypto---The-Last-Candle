import { toTime } from "./format";
import type { VolumeSummary } from "@/shared/types";

/**
 * Premium volume rule (single source of truth for the page; the database function
 * public.evaluate_premium_cycles applies the same rule):
 * - Cycles follow the calendar, the same for everyone: day 1–14 and day 15–end of each
 *   month (UTC). A member who joins mid-cycle is counted from that cycle's first day.
 * - Each cycle needs 68,686$ of crypto-futures volume.
 * - With `warnDaysLeft` days or fewer left and still below target, the member is warned.
 * - Reaching the target ends the cycle early: the rest of it is rest time and its volume
 *   is ignored. The next cycle starts on its calendar date.
 * - A cycle that ends below target gets a 24h grace day (the first day of the next cycle).
 *   Missing it means removal (enforced by the backend via `member.status = "kicked"`).
 *
 * Days are UTC calendar days, matching the "YYYY-MM-DD" buckets of `daily`.
 */
export const PREMIUM_RULE = {
  requiredUsd: 68_686,
  /** Day of the month on which the second cycle starts. */
  secondHalfFrom: 15,
  warnDaysLeft: 5,
} as const;

const DAY_MS = 86_400_000;

export type CyclePhase = "active" | "warning" | "grace" | "rest" | "failed";

export interface CycleProgress {
  /** 1-based cycle number since the member joined */
  index: number;
  /** First and last trading day of the cycle, "YYYY-MM-DD" (inclusive) */
  startDay: string;
  endDay: string;
  /** Length of this cycle in days (14 for 1–14; 13–17 for 15–end of month) */
  cycleDays: number;
  /** End of the last day (ms) */
  deadline: number;
  /** End of the 24h grace day (ms) */
  graceDeadline: number;
  /** 1…cycleDays, or cycleDays + 1 on the grace day */
  dayOfCycle: number;
  /** Whole days left until `deadline`, at least 1 while the cycle runs */
  daysLeft: number;
  /** Counted volume: up to today, or up to the day the target was reached */
  volume: number;
  required: number;
  /** Floored; can exceed 100 */
  percent: number;
  /** USD still needed (0 once reached) */
  remaining: number;
  /** USD per remaining day to make the deadline */
  perDay: number;
  phase: CyclePhase;
  /** Day the target was reached ("YYYY-MM-DD") — rest phase only */
  metDay?: string;
  /** Last rest day ("YYYY-MM-DD") — rest phase only */
  restUntil?: string;
  /** When counting resumes (ms, start of the next cycle) — rest phase only */
  resumesAt?: number;
  /** First day of the next cycle ("YYYY-MM-DD") — rest phase only */
  nextStartDay?: string;
  /** Last counted day, for the highlighted band on the chart */
  bandEndDay: string;
}

const dayNumber = (ms: number) => Math.floor(ms / DAY_MS);
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const parseDay = (s: string) => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? dayNumber(t) : NaN;
};

/** The calendar cycle containing a day: [first, last] as day numbers. */
export function calendarCycle(day: number): { start: number; end: number } {
  const d = new Date(day * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const split = PREMIUM_RULE.secondHalfFrom;
  if (d.getUTCDate() < split) {
    return { start: dayNumber(Date.UTC(y, m, 1)), end: dayNumber(Date.UTC(y, m, split - 1)) };
  }
  return { start: dayNumber(Date.UTC(y, m, split)), end: dayNumber(Date.UTC(y, m + 1, 0)) };
}

/**
 * Walks the calendar cycles forward from an anchor (the backend's `cycleStart`, or the
 * cycle containing the registration day) and returns the one that applies today.
 */
export function getCycleProgress(
  joinedAt: string,
  volume: Pick<VolumeSummary, "daily" | "cycleStart" | "cycleIndex">,
  now: number,
): CycleProgress | null {
  const joined = toTime(joinedAt);
  const anchorDay = volume.cycleStart
    ? parseDay(volume.cycleStart)
    : Number.isFinite(joined)
      ? dayNumber(joined)
      : NaN;
  if (!Number.isFinite(anchorDay)) return null;

  const { requiredUsd, warnDaysLeft } = PREMIUM_RULE;
  const byDay = new Map<number, number>();
  for (const d of volume.daily) {
    const n = parseDay(d.day);
    if (Number.isFinite(n)) byDay.set(n, Math.max(0, d.volume));
  }
  const vol = (n: number) => byDay.get(n) ?? 0;
  const today = Math.max(anchorDay, dayNumber(now));

  let { start, end } = calendarCycle(anchorDay);
  let index = volume.cycleIndex ?? 1;

  // One iteration per cycle; bounded so bad data can never loop forever (~3 years).
  for (let guard = 0; guard < 80; guard++) {
    const cycleDays = end - start + 1;
    const graceDay = end + 1;
    let cum = 0;
    let metDay: number | null = null;
    for (let d = start; d <= Math.min(today, graceDay); d++) {
      cum += vol(d);
      if (cum >= requiredUsd) {
        metDay = d;
        break;
      }
    }

    const base = {
      index,
      startDay: dayString(start),
      endDay: dayString(end),
      cycleDays,
      deadline: (end + 1) * DAY_MS,
      graceDeadline: (graceDay + 1) * DAY_MS,
      required: requiredUsd,
      volume: cum,
      percent: Math.floor((cum / requiredUsd) * 100),
      remaining: Math.max(0, requiredUsd - cum),
    };

    if (metDay !== null) {
      // Reached by the last day: rest until the cycle ends. Reached on the grace day: that day
      // already belongs to the next cycle, so move straight on.
      if (metDay <= end && today <= end) {
        return {
          ...base,
          dayOfCycle: metDay - start + 1,
          daysLeft: 0,
          perDay: 0,
          phase: "rest",
          metDay: dayString(metDay),
          restUntil: dayString(end),
          resumesAt: (end + 1) * DAY_MS,
          nextStartDay: dayString(end + 1),
          bandEndDay: dayString(metDay),
        };
      }
      ({ start, end } = calendarCycle(end + 1));
      index++;
      continue;
    }

    if (today <= end) {
      const daysLeft = Math.max(1, Math.ceil((base.deadline - now) / DAY_MS));
      return {
        ...base,
        dayOfCycle: today - start + 1,
        daysLeft,
        perDay: base.remaining / daysLeft,
        phase: daysLeft <= warnDaysLeft ? "warning" : "active",
        bandEndDay: dayString(today),
      };
    }

    // Past the last day and still short: grace day, or failed after it.
    return {
      ...base,
      dayOfCycle: cycleDays + 1,
      daysLeft: 0,
      perDay: base.remaining,
      phase: today === graceDay ? "grace" : "failed",
      bandEndDay: dayString(graceDay),
    };
  }
  return null;
}
