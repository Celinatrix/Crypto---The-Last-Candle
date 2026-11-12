/**
 * DEV-ONLY signals. Prices are a seeded random walk of 15-minute candles, and every outcome comes from
 * the real replay engine (shared/signals.ts), so the mock page also exercises the scoring rules.
 * Imported dynamically behind DEV_MOCKS, never shipped in production.
 */
import {
  advance,
  MINUTE_MS,
  type CandlePoint,
  type EngineState,
  type Signal,
  type SignalCandlesResponse,
  type SignalEvent,
  type SignalsResponse,
} from "@/shared/signals";

const STEP = 15 * MINUTE_MS;
const DAY = 86_400_000;
const SYMBOLS: [string, number][] = [
  ["BTC-USDT", 73_500],
  ["ETH-USDT", 2_045],
  ["SOL-USDT", 152],
  ["BNB-USDT", 615],
  ["XRP-USDT", 0.512],
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random-walk candles from `from`, `count` of them, volatility as a share of price per candle. */
function walk(rand: () => number, from: number, count: number, price: number, vol: number, drift: number): CandlePoint[] {
  const out: CandlePoint[] = [];
  let p = price;
  for (let i = 0; i < count; i++) {
    const open = p;
    const move = (rand() - 0.5 + drift) * 2 * vol * p;
    const close = Math.max(p * 0.5, open + move);
    const high = Math.max(open, close) + rand() * vol * p * 0.8;
    const low = Math.min(open, close) - rand() * vol * p * 0.8;
    out.push({ time: from + i * STEP, open, high, low, close });
    p = close;
  }
  return out;
}

const snap = (v: number, ref: number) => {
  const digits = ref >= 1000 ? 1 : ref >= 10 ? 2 : ref >= 1 ? 3 : 4;
  return Math.round(v * 10 ** digits) / 10 ** digits;
};

interface MockSet {
  signals: Signal[];
  candles: Map<number, CandlePoint[]>;
}

let cache: { day: number; set: MockSet } | null = null;

function build(): MockSet {
  const now = Date.now();
  const rand = mulberry32(20261112);
  const signals: Signal[] = [];
  const candles = new Map<number, CandlePoint[]>();
  const count = 64;

  for (let i = 0; i < count; i++) {
    const id = i + 1;
    const [symbol, ref] = SYMBOLS[Math.floor(rand() * SYMBOLS.length)]!;
    // Spread over the last 150 days; the newest few are still running or waiting for their entry.
    const recent = i >= count - 3;
    const createdAt = Math.floor(
      (recent ? now - (count - i) * 5 * 3_600_000 : now - (150 - i * 2.3) * DAY - rand() * 6 * 3_600_000) / MINUTE_MS,
    ) * MINUTE_MS;
    const side = rand() < 0.58 ? "long" : "short";
    const orderType = rand() < 0.28 ? "limit" : "market";
    const price = ref * (0.9 + rand() * 0.2);
    const vol = 0.0035;
    const risk = price * (0.008 + rand() * 0.012) * (recent ? 3 : 1);
    const dir = side === "long" ? 1 : -1;
    const entry = snap(orderType === "limit" ? price - dir * risk * (0.2 + rand() * 0.4) : price, ref);
    const sl = snap(entry - dir * risk, ref);
    // About half of the limit signals have a second, deeper entry between ET1 and the SL.
    const entry2 = orderType === "limit" && rand() < 0.5 ? snap(entry - dir * risk * (0.3 + rand() * 0.3), ref) : null;
    const nTp = 1 + Math.floor(rand() * 3);
    const tps = Array.from({ length: nTp }, (_, k) => snap(entry + dir * risk * (k + 1) * (0.9 + rand() * 0.5), ref));

    // A slight edge in the signal's favour so the mock statistics look like a real, decent strategy.
    const drift = dir * (rand() < 0.55 ? 0.06 : -0.03);
    // The walk before the post is rescaled so it ends exactly at the post price (no jump on the chart).
    const rawPre = walk(rand, Math.ceil(createdAt / STEP) * STEP - 40 * STEP, 40, price * (1 - dir * 0.01), vol, dir * 0.03);
    const k = price / rawPre[rawPre.length - 1]!.close;
    const pre = rawPre.map((c) => ({ time: c.time, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k }));
    const available = Math.max(0, Math.floor((now - createdAt) / STEP) - 1);
    const post = walk(rand, Math.ceil(createdAt / STEP) * STEP, Math.min(available, 700), price, vol, drift);
    const series = [...pre, ...post];

    const start: EngineState = {
      side,
      entry,
      entry2,
      entriesFilled: orderType === "market" ? 1 : 0,
      sl,
      tps,
      status: orderType === "market" ? "open" : "pending",
      currentSl: sl,
      tpHits: 0,
      realizedR: 0,
      exit: null,
      filledAt: orderType === "market" ? createdAt : null,
      closedAt: null,
    };
    let run = advance(start, post);
    // Some signals with two or more TPs had their SL moved to entry after TP1, as the admin may announce.
    const tp1 = run.events.find((e) => e.kind === "tp");
    const moves = tp1 && nTp > 1 && rand() < 0.35 ? [{ at: tp1.at + 1, price: entry }] : [];
    if (moves.length) run = advance(start, post, moves);

    const { state } = run;
    const events: SignalEvent[] = [
      { at: new Date(createdAt).toISOString(), kind: "created" as const, price: entry, r: null },
      ...(orderType === "market" ? [{ at: new Date(createdAt).toISOString(), kind: "filled" as const, price: entry, r: null }] : []),
      ...moves.map((m) => ({ at: new Date(m.at).toISOString(), kind: "sl_moved" as const, price: m.price, r: null })),
      ...run.events.map((e) => ({ at: new Date(e.at).toISOString(), kind: e.kind, price: e.price, r: e.r })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    signals.push({
      id,
      symbol,
      side,
      orderType,
      entry,
      entry2,
      entriesFilled: state.entriesFilled,
      sl,
      currentSl: moves.length ? entry : sl,
      tps,
      note: i % 9 === 0 ? "Theo cấu trúc khung H4, chờ phá vùng tích luỹ." : null,
      status: state.status,
      createdAt: new Date(createdAt).toISOString(),
      filledAt: state.filledAt === null ? null : new Date(state.filledAt).toISOString(),
      closedAt: state.closedAt === null ? null : new Date(state.closedAt).toISOString(),
      tpHits: state.tpHits,
      realizedR: state.realizedR,
      exit: state.exit,
      events,
    });
    candles.set(id, series);
  }
  return { signals: signals.reverse(), candles };
}

function mockSet(): MockSet {
  const day = Math.floor(Date.now() / DAY);
  if (!cache || cache.day !== day) cache = { day, set: build() };
  return cache.set;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scenario = () => new URLSearchParams(window.location.search).get("mock");

export async function mockSignals(): Promise<SignalsResponse> {
  await wait(600);
  if (scenario() === "error") throw new Error("Không tải được thống kê tín hiệu. Vui lòng thử lại.");
  return { signals: mockSet().signals, updatedAt: new Date().toISOString() };
}

export async function mockSignalCandles(id: number): Promise<SignalCandlesResponse> {
  await wait(400);
  const set = mockSet();
  const signal = set.signals.find((s) => s.id === id);
  const all = set.candles.get(id);
  if (!signal || !all) throw new Error("Không tìm thấy tín hiệu.");
  const end = signal.closedAt ? Date.parse(signal.closedAt) : Date.now();
  const lastIdx = all.findIndex((c) => c.time > end);
  const stop = lastIdx === -1 ? all.length : Math.min(all.length, lastIdx + 24);
  const startIdx = Math.max(0, 40 - 24);
  return { signal, interval: "15m", candles: all.slice(startIdx, stop).slice(-240) };
}
