import { toTime } from "./format";
import type { VolumeSummary } from "./types";

/**
 * Premium volume rule (single source of truth for the page):
 * - Each cycle gives the member 14 days to reach 60,000$ of trading volume.
 * - From day 10, a member still below target sees a warning.
 * - Reaching the target ends the cycle early: the rest of the 14 days does not
 *   count, plus 3 more rest days. Volume traded while resting is ignored.
 *   The next cycle starts the day after the rest.
 * - A cycle that ends below target gets a 24h grace day. Reaching the target
 *   then also earns the 3 rest days; missing it means removal (enforced by the
 *   backend via `member.status = "kicked"`).
 *
 * Days are UTC calendar days, matching the "YYYY-MM-DD" buckets of `daily`.
 */
export const PREMIUM_RULE = {
  cycleDays: 14,
  requiredUsd: 60_000,
  warnFromDay: 10,
  restDays: 3,
} as const;

const DAY_MS = 86_400_000;

export type CyclePhase = "active" | "warning" | "grace" | "rest" | "failed";

export interface CycleProgress {
  /** 1-based cycle number */
  index: number;
  /** First and last trading day of the cycle, "YYYY-MM-DD" (inclusive) */
  startDay: string;
  endDay: string;
  /** End of day 14 (ms) */
  deadline: number;
  /** End of the 24h grace day (ms) */
  graceDeadline: number;
  /** 1…14, or 15 on the grace day */
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

/**
 * Walks the cycles forward from an anchor (the backend's `cycleStart`, or the
 * registration day) and returns the one that applies today.
 */
export function getCycleProgress(
  joinedAt: string,
  volume: Pick<VolumeSummary, "daily" | "cycleStart" | "cycleIndex">,
  now: number,
): CycleProgress | null {
  const joined = toTime(joinedAt);
  const anchor = volume.cycleStart ? parseDay(volume.cycleStart) : Number.isFinite(joined) ? dayNumber(joined) : NaN;
  if (!Number.isFinite(anchor)) return null;

  const { cycleDays, requiredUsd, warnFromDay, restDays } = PREMIUM_RULE;
  const byDay = new Map<number, number>();
  for (const d of volume.daily) {
    const n = parseDay(d.day);
    if (Number.isFinite(n)) byDay.set(n, Math.max(0, d.volume));
  }
  const vol = (n: number) => byDay.get(n) ?? 0;
  const today = Math.max(anchor, dayNumber(now));

  let start = anchor;
  let index = volume.cycleIndex ?? 1;

  // One iteration per cycle; bounded so bad data can never loop forever (~3 years).
  for (let guard = 0; guard < 64; guard++) {
    const end = start + cycleDays - 1;
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
      deadline: (end + 1) * DAY_MS,
      graceDeadline: (graceDay + 1) * DAY_MS,
      required: requiredUsd,
      volume: cum,
      percent: Math.floor((cum / requiredUsd) * 100),
      remaining: Math.max(0, requiredUsd - cum),
    };

    if (metDay !== null) {
      // Reached by day 14: rest until day 14 + 3. Reached on the grace day: rest 3 days after it.
      const restEnd = (metDay <= end ? end : graceDay) + restDays;
      const nextStart = restEnd + 1;
      if (today <= restEnd) {
        return {
          ...base,
          dayOfCycle: Math.min(cycleDays + 1, metDay - start + 1),
          daysLeft: 0,
          perDay: 0,
          phase: "rest",
          metDay: dayString(metDay),
          restUntil: dayString(restEnd),
          resumesAt: nextStart * DAY_MS,
          nextStartDay: dayString(nextStart),
          bandEndDay: dayString(metDay),
        };
      }
      start = nextStart;
      index++;
      continue;
    }

    if (today <= end) {
      const dayOfCycle = today - start + 1;
      const daysLeft = Math.max(1, Math.ceil((base.deadline - now) / DAY_MS));
      return {
        ...base,
        dayOfCycle,
        daysLeft,
        perDay: base.remaining / daysLeft,
        phase: dayOfCycle >= warnFromDay ? "warning" : "active",
        bandEndDay: dayString(today),
      };
    }

    // Past day 14 and still short: grace day, or failed after it.
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
