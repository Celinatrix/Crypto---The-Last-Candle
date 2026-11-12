/**
 * Admin trade signals: storage, the replay against BingX 1-minute candles, and the admin actions.
 * Server-only. The scoring rules live in shared/signals.ts.
 *
 * BingX public market data (no key): /openApi/swap/v3/quote/klines returns candles newest first, and
 * when a range holds more than `limit` candles it returns the newest ones, so ranges are walked in
 * windows of at most 1,440 minutes. The newest candle is the one still forming and is never replayed.
 */
import { eq, insertOne, rpc, select } from "./db";
import {
  advance,
  closeByHand,
  ladderError,
  MINUTE_MS,
  orderEntries,
  type CandlePoint,
  type EngineEvent,
  type EngineState,
  type Signal,
  type SignalEvent,
  type SignalExit,
  type SignalOrderType,
  type SignalSide,
  type SignalStatus,
} from "@/shared/signals";

const BASE = "https://open-api.bingx.com";
const WINDOW = 1440;
export const SYMBOL_RE = /^[A-Z0-9]{1,20}-USDT$/;

// ---------------------------------------------------------------------------------------------------
// BingX

interface RawKline {
  open: string;
  close: string;
  high: string;
  low: string;
  time: number;
}

async function bingx<T>(path: string): Promise<{ code: number; msg?: string; data?: T }> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`BingX ${path.split("?")[0]}: HTTP ${res.status}`);
  return (await res.json()) as { code: number; msg?: string; data?: T };
}

/** Last traded price, or null when BingX has no such perpetual contract. */
export async function fetchPrice(symbol: string): Promise<number | null> {
  const body = await bingx<{ price: string }>(`/openApi/swap/v2/quote/price?symbol=${encodeURIComponent(symbol)}`);
  if (body.code === 109425) return null;
  const price = Number(body.data?.price);
  if (body.code !== 0 || !(price > 0)) throw new Error(`BingX price ${symbol}: code ${body.code} ${body.msg ?? ""}`.trim());
  return price;
}

const toCandle = (k: RawKline): CandlePoint => ({
  time: k.time,
  open: Number(k.open),
  high: Number(k.high),
  low: Number(k.low),
  close: Number(k.close),
});

/** Candles of one interval between two times (both ms), oldest first. One request: at most 1,440. */
export async function fetchKlines(symbol: string, interval: string, from: number, to: number): Promise<CandlePoint[]> {
  const qs = `symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${from}&endTime=${to}&limit=${WINDOW}`;
  const body = await bingx<RawKline[]>(`/openApi/swap/v3/quote/klines?${qs}`);
  if (body.code !== 0 || !Array.isArray(body.data)) throw new Error(`BingX klines ${symbol}: code ${body.code} ${body.msg ?? ""}`.trim());
  return body.data.map(toCandle).sort((a, b) => a.time - b.time);
}

/** Closed 1-minute candles opening in [from, until), oldest first. */
async function fetchClosedMinutes(symbol: string, from: number, until: number): Promise<CandlePoint[]> {
  const lastClosedOpen = Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
  const end = Math.min(until, lastClosedOpen + MINUTE_MS);
  const out: CandlePoint[] = [];
  for (let start = from; start < end; start += WINDOW * MINUTE_MS) {
    const stop = Math.min(end, start + WINDOW * MINUTE_MS) - 1;
    out.push(...(await fetchKlines(symbol, "1m", start, stop)).filter((c) => c.time >= start && c.time <= stop));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Storage

interface SignalRow {
  id: number;
  symbol: string;
  side: SignalSide;
  order_type: SignalOrderType;
  entry: number;
  entry2: number | null;
  entries_filled: number;
  sl: number;
  current_sl: number;
  tps: number[];
  note: string | null;
  status: SignalStatus;
  tp_hits: number;
  realized_r: number;
  exit_reason: SignalExit | null;
  created_at: string;
  filled_at: string | null;
  closed_at: string | null;
  checked_until: string;
}

interface EventRow {
  signal_id: number;
  at: string;
  kind: SignalEvent["kind"];
  price: number | null;
  r: number | null;
}

const COLUMNS =
  "id,symbol,side,order_type,entry,entry2,entries_filled,sl,current_sl,tps,note,status,tp_hits,realized_r,exit_reason,created_at,filled_at,closed_at,checked_until";

const num = (v: unknown) => Number(v);

function toState(row: SignalRow): EngineState {
  return {
    side: row.side,
    entry: num(row.entry),
    entry2: row.entry2 === null ? null : num(row.entry2),
    entriesFilled: row.entries_filled,
    sl: num(row.sl),
    tps: row.tps.map(num),
    status: row.status,
    currentSl: num(row.current_sl),
    tpHits: row.tp_hits,
    realizedR: num(row.realized_r),
    exit: row.exit_reason,
    filledAt: row.filled_at ? Date.parse(row.filled_at) : null,
    closedAt: row.closed_at ? Date.parse(row.closed_at) : null,
  };
}

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** Saves a replay step; false when another run got there first. */
async function apply(row: SignalRow, state: EngineState, checkedUntil: number, events: (EngineEvent & { by?: string })[]): Promise<boolean> {
  return rpc<boolean>("signal_apply", {
    p_id: row.id,
    p_expected: row.checked_until,
    p_patch: {
      status: state.status,
      current_sl: state.currentSl,
      tp_hits: state.tpHits,
      entries_filled: state.entriesFilled,
      realized_r: state.realizedR,
      exit_reason: state.exit,
      filled_at: iso(state.filledAt),
      closed_at: iso(state.closedAt),
      checked_until: new Date(checkedUntil).toISOString(),
    },
    p_events: events.map((e) => ({ at: new Date(e.at).toISOString(), kind: e.kind, price: e.price, r: e.r, by: e.by ?? null })),
  });
}

async function slMovesOf(ids: number[]): Promise<Map<number, { at: number; price: number }[]>> {
  const map = new Map<number, { at: number; price: number }[]>();
  if (!ids.length) return map;
  const rows = await select<EventRow>(
    "signal_events",
    `select=signal_id,at,price&kind=eq.sl_moved&signal_id=in.(${ids.join(",")})&order=at.asc`,
  );
  for (const r of rows) map.set(r.signal_id, [...(map.get(r.signal_id) ?? []), { at: Date.parse(r.at), price: num(r.price) }]);
  return map;
}

/** All signals, newest first, with their events. */
export async function listSignals(limit = 500): Promise<Signal[]> {
  const rows = await select<SignalRow>("signals", `select=${COLUMNS}&order=created_at.desc&limit=${limit}`);
  if (!rows.length) return [];
  const events = await select<EventRow>(
    "signal_events",
    `select=signal_id,at,kind,price,r&signal_id=in.(${rows.map((r) => r.id).join(",")})&order=at.asc,id.asc`,
  );
  const byId = new Map<number, SignalEvent[]>();
  for (const e of events) {
    byId.set(e.signal_id, [
      ...(byId.get(e.signal_id) ?? []),
      { at: e.at, kind: e.kind, price: e.price === null ? null : num(e.price), r: e.r === null ? null : num(e.r) },
    ]);
  }
  return rows.map((row) => {
    const ev = byId.get(row.id) ?? [];
    const lastMove = [...ev].reverse().find((e) => e.kind === "sl_moved");
    return {
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      orderType: row.order_type,
      entry: num(row.entry),
      entry2: row.entry2 === null ? null : num(row.entry2),
      entriesFilled: row.entries_filled,
      sl: num(row.sl),
      currentSl: lastMove?.price ?? num(row.current_sl),
      tps: row.tps.map(num),
      note: row.note,
      status: row.status,
      createdAt: row.created_at,
      filledAt: row.filled_at,
      closedAt: row.closed_at,
      tpHits: row.tp_hits,
      realizedR: num(row.realized_r),
      exit: row.exit_reason,
      events: ev,
    };
  });
}

export async function getSignal(id: number): Promise<Signal | null> {
  return (await listSignals(1000)).find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Replay

/**
 * Brings every pending/open signal up to the last closed minute, at most `maxMinutes` per symbol per
 * run (later runs continue from checked_until). Returns how many signals changed.
 */
export async function evaluateActive(maxMinutes = 3 * WINDOW): Promise<number> {
  const rows = await select<SignalRow>("signals", `select=${COLUMNS}&status=in.(pending,open)&order=id.asc`);
  if (!rows.length) return 0;
  const moves = await slMovesOf(rows.map((r) => r.id));
  const bySymbol = new Map<string, SignalRow[]>();
  for (const r of rows) bySymbol.set(r.symbol, [...(bySymbol.get(r.symbol) ?? []), r]);

  let changed = 0;
  for (const [symbol, list] of bySymbol) {
    try {
      const from = Math.min(...list.map((r) => Date.parse(r.checked_until)));
      const candles = await fetchClosedMinutes(symbol, from, from + maxMinutes * MINUTE_MS);
      if (!candles.length) continue;
      for (const row of list) {
        const since = Date.parse(row.checked_until);
        const mine = candles.filter((c) => c.time >= since);
        if (!mine.length) continue;
        const start = toState(row);
        const { state, events } = advance(start, mine, (moves.get(row.id) ?? []).filter((m) => m.at >= since));
        const last = mine[mine.length - 1]!.time + MINUTE_MS;
        if (await apply(row, state, last, events)) changed += events.length ? 1 : 0;
      }
    } catch (err) {
      // One symbol failing (delisted, BingX hiccup) must not stop the others.
      console.error(`[signals] replay ${symbol}`, err);
    }
  }
  return changed;
}

let lastRun = 0;
let running: Promise<unknown> | null = null;

/** Replays at most once a minute per server instance; page loads share one run. */
export async function evaluateIfStale(): Promise<void> {
  if (running) {
    await running;
    return;
  }
  if (Date.now() - lastRun < MINUTE_MS) return;
  lastRun = Date.now();
  running = evaluateActive().catch((err) => console.error("[signals] replay", err));
  try {
    await running;
  } finally {
    running = null;
  }
}

// ---------------------------------------------------------------------------------------------------
// Admin actions

export interface NewSignal {
  symbol: string;
  side: SignalSide;
  orderType: SignalOrderType;
  entry: number;
  /** Optional second entry, limit signals only; either order is accepted. */
  entry2: number | null;
  sl: number;
  tps: number[];
  note: string | null;
}

export class SignalInputError extends Error {}

/** Market entries must sit within this distance of the live price (catches typos). */
const MARKET_TOLERANCE = 0.03;

export async function createSignal(input: NewSignal, by: string): Promise<number> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new SignalInputError("Cặp coin phải có dạng BTC-USDT.");
  if (input.entry2 !== null && input.orderType !== "limit") throw new SignalInputError("Chỉ lệnh Limit mới có 2 ET.");
  const [entry, entry2] = orderEntries(input.side, input.entry, input.entry2);
  const ladder = ladderError(input.side, entry, input.sl, input.tps, entry2);
  if (ladder) throw new SignalInputError(ladder);

  const price = await fetchPrice(symbol);
  if (price === null) throw new SignalInputError(`BingX không có hợp đồng ${symbol}.`);
  const long = input.side === "long";
  const tp1 = input.tps[0]!;
  // Already past the SL or TP1: the replay would close or cancel it on the first candle.
  if (long ? price <= input.sl || price >= tp1 : price >= input.sl || price <= tp1) {
    throw new SignalInputError(`Giá hiện tại (${price}) đã vượt SL hoặc TP1.`);
  }
  if (input.orderType === "market" && Math.abs(entry - price) / price > MARKET_TOLERANCE) {
    const off = ((Math.abs(entry - price) / price) * 100).toFixed(1);
    throw new SignalInputError(`Entry lệnh Market lệch ${off}% so với giá hiện tại (${price}). Kiểm tra lại giá.`);
  }

  const now = Date.now();
  const firstMinute = Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const market = input.orderType === "market";
  const row = await insertOne<{ id: number }>("signals", {
    symbol,
    side: input.side,
    order_type: input.orderType,
    entry,
    entry2,
    entries_filled: market ? 1 : 0,
    sl: input.sl,
    current_sl: input.sl,
    tps: input.tps,
    note: input.note,
    status: market ? "open" : "pending",
    filled_at: market ? new Date(now).toISOString() : null,
    checked_until: new Date(firstMinute).toISOString(),
    created_by: by,
  });
  await insertOne("signal_events", { signal_id: row.id, at: new Date(now).toISOString(), kind: "created", price: entry, by });
  if (market) {
    await insertOne("signal_events", { signal_id: row.id, at: new Date(now).toISOString(), kind: "filled", price: entry, by });
  }
  return row.id;
}

async function loadRow(id: number): Promise<SignalRow | null> {
  return (await select<SignalRow>("signals", `select=${COLUMNS}&id=${eq(id)}`))[0] ?? null;
}

/** Replays one signal up to now, so an admin action applies to its current state. */
async function catchUp(id: number): Promise<SignalRow | null> {
  const row = await loadRow(id);
  if (!row || (row.status !== "pending" && row.status !== "open")) return row;
  const since = Date.parse(row.checked_until);
  const candles = await fetchClosedMinutes(row.symbol, since, Date.now());
  if (candles.length) {
    const moves = (await slMovesOf([id])).get(id) ?? [];
    const { state, events } = advance(toState(row), candles, moves.filter((m) => m.at >= since));
    await apply(row, state, candles[candles.length - 1]!.time + MINUTE_MS, events);
  }
  return loadRow(id);
}

const STILL_RUNNING = "Tín hiệu này đã kết thúc. Hãy tải lại danh sách.";

export async function moveStop(id: number, price: number, by: string): Promise<void> {
  const row = await catchUp(id);
  if (!row) throw new SignalInputError("Không tìm thấy tín hiệu.");
  if (row.status !== "pending" && row.status !== "open") throw new SignalInputError(STILL_RUNNING);
  const s = toState(row);
  const long = s.side === "long";
  const nextTp = s.tps[s.tpHits]!;
  if (!(price > 0) || (long ? price >= nextTp : price <= nextTp)) {
    throw new SignalInputError(long ? "SL mới phải thấp hơn TP kế tiếp." : "SL mới phải cao hơn TP kế tiếp.");
  }
  const live = await fetchPrice(row.symbol);
  if (live !== null && (long ? price >= live : price <= live)) {
    throw new SignalInputError(`SL mới đã vượt giá hiện tại (${live}).`);
  }
  // The stop moves from the next full minute: the event is replayed like any other.
  const ok = await apply(row, s, Date.parse(row.checked_until), [{ at: Date.now(), kind: "sl_moved", price, r: null, by }]);
  if (!ok) throw new SignalInputError("Tín hiệu vừa được cập nhật. Hãy thử lại.");
}

/** Closes an open signal at `price`, or cancels a pending one (price ignored). */
export async function closeSignal(id: number, price: number | null, by: string): Promise<void> {
  const row = await catchUp(id);
  if (!row) throw new SignalInputError("Không tìm thấy tín hiệu.");
  if (row.status !== "pending" && row.status !== "open") throw new SignalInputError(STILL_RUNNING);
  if (row.status === "open" && !(price !== null && price > 0)) throw new SignalInputError("Nhập giá đóng lệnh.");
  const { state, events } = closeByHand(toState(row), row.status === "open" ? price : null, Date.now());
  const ok = await apply(row, state, Date.parse(row.checked_until), events.map((e) => ({ ...e, by })));
  if (!ok) throw new SignalInputError("Tín hiệu vừa được cập nhật. Hãy thử lại.");
}

// ---------------------------------------------------------------------------------------------------
// Chart

const INTERVALS: [string, number][] = [
  ["1m", 1], ["3m", 3], ["5m", 5], ["15m", 15], ["30m", 30], ["1h", 60],
  ["2h", 120], ["4h", 240], ["6h", 360], ["12h", 720], ["1d", 1440],
].map(([k, m]) => [k as string, (m as number) * MINUTE_MS]);

const chartCache = new Map<string, { at: number; data: { interval: string; candles: CandlePoint[] } }>();

/** About 60–240 candles around a signal, from a little before the post to a little after it closed. */
export async function chartCandles(signal: Signal): Promise<{ interval: string; candles: CandlePoint[] }> {
  const start = Date.parse(signal.createdAt);
  const end = signal.closedAt ? Date.parse(signal.closedAt) : Date.now();
  const span = Math.max(end - start, 30 * MINUTE_MS);
  const [interval, step] = INTERVALS.find(([, ms]) => span / ms <= 160) ?? INTERVALS[INTERVALS.length - 1]!;
  const pad = Math.max(span * 0.25, 20 * step);
  const from = start - pad;
  const to = Math.min(Date.now(), end + pad);

  const key = `${signal.id}:${signal.status}:${interval}`;
  const cached = chartCache.get(key);
  const ttl = signal.status === "closed" || signal.status === "cancelled" ? 60 * MINUTE_MS : MINUTE_MS;
  if (cached && Date.now() - cached.at < ttl) return cached.data;

  const data = { interval, candles: await fetchKlines(signal.symbol, interval, Math.floor(from), Math.floor(to)) };
  if (chartCache.size > 200) chartCache.clear();
  chartCache.set(key, { at: Date.now(), data });
  return data;
}
