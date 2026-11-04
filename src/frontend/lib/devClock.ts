import { DEV_MOCKS } from "./env";

/**
 * DEV-ONLY virtual clock for the mock scenarios (?mock=…). Cycles follow the calendar, so to
 * show e.g. the grace day the page must believe today is the 15th. Each scenario names the day
 * of the current month it needs (day 1–14 = first cycle, 15 = its grace day, 16 = failed).
 */
export const MOCK_MONTH_DAY = {
  fresh: 2,
  active: 6,
  soon: 12,
  met: 12,
  rest: 9,
  grace: 15,
  failed: 16,
  kicked: 3,
} as const;

/** Milliseconds to add to Date.now() in the current mock scenario (0 outside dev mocks). */
export function devClockOffset(): number {
  if (process.env.NODE_ENV !== "development" || !DEV_MOCKS || typeof window === "undefined") return 0;
  const s = new URLSearchParams(window.location.search).get("mock");
  const key = (s && s in MOCK_MONTH_DAY ? s : "active") as keyof typeof MOCK_MONTH_DAY;
  const now = Date.now();
  const d = new Date(now);
  const target = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    MOCK_MONTH_DAY[key],
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  );
  return target - now;
}
