/**
 * DEV-ONLY mock backend. Imported dynamically behind `DEV_MOCKS`, so it never ships
 * in a production bundle. Pick a scenario with `?mock=…` in the URL.
 */
import { devClockOffset, MOCK_MONTH_DAY } from "./devClock";
import { readLink } from "./linkSession";
import type { MeResponse, RegisterResult } from "@/shared/types";

export type MockScenario =
  | "new"
  | "fresh"
  | "active"
  | "soon"
  | "met"
  | "rest"
  | "grace"
  | "failed"
  | "kicked"
  | "error";

const SCENARIOS: readonly MockScenario[] = ["new", "fresh", "active", "soon", "met", "rest", "grace", "failed", "kicked", "error"];

export function parseScenario(value: string | null | undefined): MockScenario {
  return SCENARIOS.find((s) => s === value) ?? "new";
}

const DAY = 86_400_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scenario = () => parseScenario(new URLSearchParams(window.location.search).get("mock"));

/**
 * Each plan is set in the first calendar cycle (day 1–14) of the current month: the virtual
 * clock (devClock.ts) puts "today" on day `MOCK_MONTH_DAY[scenario]`, and volume is spread over
 * day ranges of that cycle (target 68,686$). Days not listed get small "rest" volume.
 */
interface Plan {
  cycle: number;
  segments: Array<[from: number, to: number, total: number]>;
}

const PLANS: Record<Exclude<MockScenario, "new" | "error">, Plan> = {
  fresh: { cycle: 1, segments: [[1, 2, 3_480]] },
  active: { cycle: 3, segments: [[1, 6, 31_960]] },
  // Day 11: 4 days left and short → warning.
  soon: { cycle: 2, segments: [[1, 11, 41_830]] },
  // Reached on day 10 (58,000 + 11,200), resting on day 12.
  met: { cycle: 2, segments: [[1, 9, 58_000], [10, 10, 11_200]] },
  // Reached on day 5, resting on day 9 until the cycle ends on the 14th.
  rest: { cycle: 2, segments: [[1, 4, 60_000], [5, 5, 9_500]] },
  // Day 15 = grace day of the 1–14 cycle.
  grace: { cycle: 3, segments: [[1, 14, 60_310], [15, 15, 0]] },
  // Day 16: the grace day passed short.
  failed: { cycle: 2, segments: [[1, 15, 55_000], [16, 16, 0]] },
  kicked: { cycle: 4, segments: [[1, 3, 2_150]] },
};

const isoDay = (dayNumber: number) => new Date(dayNumber * DAY).toISOString().slice(0, 10);
const rand = (i: number, seed: number) => Math.abs(Math.sin(seed * 31.7 + i * 12.9898)) % 1;
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** Spread `total` over `days` with uneven, partly-zero weights. */
function spread(total: number, days: number[], seed: number): Array<[number, number]> {
  const weights = days.map((d) => (days.length > 2 && rand(d, seed) < 0.15 ? 0 : rand(d, seed + 1) + 0.2));
  const sum = weights.reduce((a, w) => a + w, 0) || 1;
  return days.map((d, i) => [d, Math.round(((total * (weights[i] ?? 0)) / sum) * 100) / 100]);
}

export async function mockMe(): Promise<MeResponse> {
  await wait(700);
  // Stand-in for the backend member cookie: the device's saved link.
  const link = readLink();
  if (!link) return { member: null };
  const s = scenario();
  return meFor(s === "new" || s === "error" ? "active" : s, link);
}

function meFor(s: keyof typeof PLANS, link: { uid: string; email: string }): MeResponse {
  const now = Date.now() + devClockOffset();
  const plan = PLANS[s];
  const today = Math.floor(now / DAY);
  // The 1st of the (virtual) month: start of the 1–14 cycle.
  const cycleStart = today - (MOCK_MONTH_DAY[s] - 1);
  const joinDay = plan.cycle === 1 ? cycleStart : cycleStart - (plan.cycle - 1) * 17;

  const planned = new Map<number, number>(
    plan.segments.flatMap(([from, to, total], k) => spread(total, range(cycleStart + from - 1, cycleStart + to - 1), k + 3)),
  );
  const daily = range(today - 29, today).map((d) => ({
    day: isoDay(d),
    volume:
      d < joinDay ? 0 : (planned.get(d) ?? Math.round((rand(d, 11) * 5_000 + 1_500) * 100) / 100),
  }));
  const total = (n: number) => Math.round(daily.slice(-n).reduce((a, d) => a + d.volume, 0) * 100) / 100;

  return {
    member: {
      uid: link.uid,
      email: link.email,
      status: s === "kicked" ? "kicked" : "active",
      joinedAt: new Date(joinDay * DAY + 3 * 3_600_000).toISOString(),
      warnedAt: null,
    },
    volume: {
      total30: total(30),
      total14: total(14),
      daily,
      updatedAt: new Date(now - 12 * 60_000).toISOString(),
      // The backend's own record of where the current cycle began.
      cycleStart: isoDay(cycleStart),
      cycleIndex: plan.cycle,
    },
  };
}

export async function mockRegister(): Promise<RegisterResult> {
  await wait(1200);
  if (scenario() === "error") {
    return { ok: false, error: "UID này không đăng ký BingX qua link đối tác của cộng đồng." };
  }
  return { ok: true };
}
