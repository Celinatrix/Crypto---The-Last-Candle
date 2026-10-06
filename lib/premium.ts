import { toTime } from "./format";
import type { DailyVolume } from "./types";

/**
 * Premium volume rule (single source of truth for the page):
 * - Cycles of 14 days start on the member's registration day and repeat.
 * - Each cycle requires at least 60,000$ of trading volume.
 * - From day 10 of a cycle, a member below the target sees a warning.
 * - A cycle that ends below target gets 24 more hours; after that the
 *   member is removed from the group (the backend enforces the removal).
 *
 * Days are UTC calendar days, matching the "YYYY-MM-DD" buckets of `daily`.
 */
export const PREMIUM_RULE = {
  cycleDays: 14,
  requiredUsd: 60_000,
  warnFromDay: 10,
  graceMs: 24 * 60 * 60 * 1000,
} as const;

const DAY_MS = 86_400_000;

export type CyclePhase = "active" | "warning" | "met" | "grace";

export interface CycleProgress {
  /** 1-based cycle number since registration */
  index: number;
  /** First and last day of the cycle, "YYYY-MM-DD" (inclusive) */
  startDay: string;
  endDay: string;
  /** ms timestamp when the cycle ends (start of the day after endDay, UTC) */
  deadline: number;
  /** 1…14 */
  dayOfCycle: number;
  /** Whole days left until the deadline, at least 1 while the cycle runs */
  daysLeft: number;
  volume: number;
  required: number;
  /** Floored; can exceed 100 once the target is passed */
  percent: number;
  /** USD still needed (0 when met) */
  remaining: number;
  /** USD per remaining day to make the deadline (0 when met) */
  perDay: number;
  phase: CyclePhase;
  /** Set when the previous cycle missed its target and is in its 24h grace window */
  grace: {
    index: number;
    startDay: string;
    endDay: string;
    deadline: number;
    volume: number;
    remaining: number;
  } | null;
}

const dayNumber = (ms: number) => Math.floor(ms / DAY_MS);
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

function sumDays(daily: DailyVolume[], fromDay: number, toDay: number): number {
  const from = dayString(fromDay);
  const to = dayString(toDay);
  return daily.reduce((acc, d) => (d.day >= from && d.day <= to ? acc + Math.max(0, d.volume) : acc), 0);
}

export function getCycleProgress(joinedAt: string, daily: DailyVolume[], now: number): CycleProgress | null {
  const joined = toTime(joinedAt);
  if (!Number.isFinite(joined)) return null;

  const { cycleDays, requiredUsd, warnFromDay, graceMs } = PREMIUM_RULE;
  const joinDay = dayNumber(joined);
  const today = Math.max(joinDay, dayNumber(now));
  const k = Math.floor((today - joinDay) / cycleDays);
  const start = joinDay + k * cycleDays;
  const end = start + cycleDays - 1;
  const deadline = (end + 1) * DAY_MS;

  const volume = sumDays(daily, start, today);
  const remaining = Math.max(0, requiredUsd - volume);
  const daysLeft = Math.max(1, Math.ceil((deadline - now) / DAY_MS));
  const dayOfCycle = today - start + 1;
  const met = remaining === 0;

  let grace: CycleProgress["grace"] = null;
  const cycleStartMs = start * DAY_MS;
  if (k >= 1 && now < cycleStartMs + graceMs) {
    // Volume traded during the grace day still counts toward the previous cycle.
    const prevVolume = sumDays(daily, start - cycleDays, start);
    if (prevVolume < requiredUsd) {
      grace = {
        index: k,
        startDay: dayString(start - cycleDays),
        endDay: dayString(start - 1),
        deadline: cycleStartMs + graceMs,
        volume: prevVolume,
        remaining: requiredUsd - prevVolume,
      };
    }
  }

  return {
    index: k + 1,
    startDay: dayString(start),
    endDay: dayString(end),
    deadline,
    dayOfCycle,
    daysLeft,
    volume,
    required: requiredUsd,
    percent: Math.floor((volume / requiredUsd) * 100),
    remaining,
    perDay: met ? 0 : remaining / daysLeft,
    phase: grace ? "grace" : met ? "met" : dayOfCycle >= warnFromDay ? "warning" : "active",
    grace,
  };
}
