/**
 * Trade signals posted by the admin: types, the price-replay engine that decides each outcome, and the
 * statistics shown to members. Pure code with no I/O, shared by the server, the admin page and the dev
 * mocks, so every place scores a signal the same way.
 *
 * Rules (agreed with the owner):
 * - A limit signal may have two entries (ET1 nearer the price, ET2 deeper towards the SL), each half of
 *   the position. 1R = |average planned entry − original SL|: a fully filled position stopped out loses
 *   1R, one filled at ET1 only loses less. Moving the SL later never changes 1R.
 * - Once TP1 is reached, an entry that has not filled is dropped.
 * - What has filled is split evenly across the 1–3 take-profits; each TP closes 1/n of it.
 * - The SL stays where it is after a TP, unless the admin moves it (a dated "sl_moved" event).
 * - Market orders are filled at the posted entry. Limit orders wait until a candle touches the entry; if a
 *   candle reaches the SL or TP1 first, the signal is cancelled and left out of the statistics.
 * - Replay starts at the first full 1-minute candle after the post. When one candle reaches both the SL
 *   and a TP, the SL counts (the cautious reading). On the candle that fills a limit order only the SL is
 *   checked; its TPs count from the next candle. The same holds for the candle that fills ET2.
 * - A signal is a win when its total R is above 0, a loss below 0, breakeven at 0.
 */

export type SignalSide = "long" | "short";
export type SignalOrderType = "market" | "limit";
export type SignalStatus = "pending" | "open" | "closed" | "cancelled";
export type SignalExit = "tp" | "sl" | "manual" | "cancel_sl" | "cancel_tp" | "cancel_admin";
export type SignalEventKind = "created" | "filled" | "tp" | "sl" | "sl_moved" | "manual_close" | "cancelled";

export interface SignalEvent {
  at: string;
  kind: SignalEventKind;
  price: number | null;
  /** R booked by this event (TP, SL or manual close), else null. */
  r: number | null;
}

export interface Signal {
  id: number;
  /** BingX perpetual symbol, e.g. "BTC-USDT". */
  symbol: string;
  side: SignalSide;
  orderType: SignalOrderType;
  /** ET1: the entry nearer the price at posting. */
  entry: number;
  /** ET2 (limit signals only): the deeper entry. With it, each entry is half the position. */
  entry2: number | null;
  /** How many entries have filled: 0 (waiting), 1 or 2. */
  entriesFilled: number;
  /** The original stop: defines 1R. */
  sl: number;
  /** The stop in force now (the latest move, or the original). */
  currentSl: number;
  /** 1–3 take-profits, nearest first. */
  tps: number[];
  note: string | null;
  status: SignalStatus;
  createdAt: string;
  filledAt: string | null;
  closedAt: string | null;
  tpHits: number;
  /** R booked so far: final once the signal is closed. */
  realizedR: number;
  exit: SignalExit | null;
  events: SignalEvent[];
}

export interface SignalsResponse {
  signals: Signal[];
  /** When the replay last caught up with BingX prices. */
  updatedAt: string;
}

export interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SignalCandlesResponse {
  signal: Signal;
  /** e.g. "15m" */
  interval: string;
  candles: CandlePoint[];
}

// ---------------------------------------------------------------------------------------------------
// Engine

export const MINUTE_MS = 60_000;
const EPS = 1e-9;

export interface EngineState {
  side: SignalSide;
  entry: number;
  entry2: number | null;
  entriesFilled: number;
  sl: number;
  tps: number[];
  status: SignalStatus;
  currentSl: number;
  tpHits: number;
  realizedR: number;
  exit: SignalExit | null;
  filledAt: number | null;
  closedAt: number | null;
}

export interface EngineEvent {
  at: number;
  kind: SignalEventKind;
  price: number;
  r: number | null;
}

export interface SlMove {
  at: number;
  price: number;
}

type Plan = Pick<EngineState, "side" | "entry" | "entry2" | "sl">;

/** The planned entries with their share of the position: [ET1 1] or [ET1 ½, ET2 ½]. */
export function entriesOf(s: Pick<EngineState, "entry" | "entry2">): { price: number; w: number }[] {
  return s.entry2 === null ? [{ price: s.entry, w: 1 }] : [{ price: s.entry, w: 0.5 }, { price: s.entry2, w: 0.5 }];
}

/** Weighted average of the planned entries. */
export const avgEntry = (s: Pick<EngineState, "entry" | "entry2">) => entriesOf(s).reduce((sum, e) => sum + e.price * e.w, 0);

/** Size and average price of what has filled so far (share of the planned position). */
export function filledOf(s: Pick<EngineState, "entry" | "entry2" | "entriesFilled">): { qty: number; avg: number } {
  const filled = entriesOf(s).slice(0, s.entriesFilled);
  const qty = filled.reduce((sum, e) => sum + e.w, 0);
  return { qty, avg: qty > 0 ? filled.reduce((sum, e) => sum + e.price * e.w, 0) / qty : s.entry };
}

/** R of `qty` (a share of the planned position) bought at `from` and closed at `price`. */
function pnl(s: Plan, qty: number, from: number, price: number): number {
  const risk = Math.abs(avgEntry(s) - s.sl);
  if (!(risk > 0)) return 0;
  return (qty * (s.side === "long" ? price - from : from - price)) / risk;
}

/** R of the whole planned position, from its average entry, if it closed at `price`. */
export const rAt = (s: Plan, price: number) => pnl(s, 1, avgEntry(s), price);

/** Share of the planned position still open: what filled × (n − TPs hit) / n. */
export const remainingOf = (s: Pick<EngineState, "entry" | "entry2" | "entriesFilled" | "tps" | "tpHits">) =>
  (filledOf(s).qty * (s.tps.length - s.tpHits)) / s.tps.length;

/** Average R:R of the TPs (what the signal earns if both entries fill and every TP is hit). */
export function plannedRR(s: Plan & Pick<EngineState, "tps">): number {
  return s.tps.reduce((sum, tp) => sum + rAt(s, tp), 0) / s.tps.length;
}

/** Two entries in either order → [ET1 nearer the TPs, ET2 nearer the SL]. */
export function orderEntries(side: SignalSide, a: number, b: number | null): [number, number | null] {
  if (b === null) return [a, null];
  return side === "long" ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
}

const round = (v: number, digits = 6) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * Replays closed candles (oldest first, all opening after the post) over a pending or open signal.
 * `moves` are the admin's SL moves; each applies from the first candle opening at or after it.
 */
export function advance(start: EngineState, candles: CandlePoint[], moves: SlMove[] = []): { state: EngineState; events: EngineEvent[] } {
  const s: EngineState = { ...start, tps: [...start.tps] };
  const events: EngineEvent[] = [];
  const long = s.side === "long";
  const sorted = [...moves].sort((a, b) => a.at - b.at);
  let mi = 0;

  const book = (at: number, price: number, kind: "sl" | "tp", r: number) => {
    s.realizedR = s.realizedR + r;
    events.push({ at, kind, price, r: round(r) });
  };
  const entries = entriesOf(s);

  for (const c of candles) {
    if (s.status === "closed" || s.status === "cancelled") break;
    while (mi < sorted.length && sorted[mi]!.at <= c.time) s.currentSl = sorted[mi++]!.price;

    const hitsSl = long ? c.low <= s.currentSl : c.high >= s.currentSl;
    const reaches = (tp: number) => (long ? c.high >= tp : c.low <= tp);
    // ET1 fills when the candle trades through it; ET2 (deeper) when the price comes down (up) to it.
    // An entry at or beyond the stop in force (the SL was moved past ET2) can no longer fill.
    const fills = (i: number) => {
      const p = entries[i]!.price;
      if (long ? p <= s.currentSl : p >= s.currentSl) return false;
      return i === 0 ? c.low <= p && p <= c.high : long ? c.low <= p : c.high >= p;
    };

    // Entries fill until the first TP; on a filling candle only the stop is checked afterwards.
    let filledNow = false;
    while (s.tpHits === 0 && s.entriesFilled < entries.length && fills(s.entriesFilled)) {
      events.push({ at: c.time, kind: "filled", price: entries[s.entriesFilled]!.price, r: null });
      s.entriesFilled++;
      filledNow = true;
      if (s.status === "pending") {
        s.status = "open";
        s.filledAt = c.time;
      }
    }

    if (s.status === "pending") {
      if (hitsSl || reaches(s.tps[0]!)) {
        s.status = "cancelled";
        s.exit = hitsSl ? "cancel_sl" : "cancel_tp";
        s.closedAt = c.time;
        events.push({ at: c.time, kind: "cancelled", price: hitsSl ? s.currentSl : s.tps[0]!, r: null });
      }
      continue;
    }

    // Open position: the stop first, then every TP the candle reached.
    const filled = filledOf(s);
    if (hitsSl) {
      book(c.time, s.currentSl, "sl", pnl(s, remainingOf(s), filled.avg, s.currentSl));
      s.status = "closed";
      s.exit = "sl";
      s.closedAt = c.time;
      continue;
    }
    if (filledNow) continue;
    while (s.tpHits < s.tps.length && reaches(s.tps[s.tpHits]!)) {
      const tp = s.tps[s.tpHits]!;
      book(c.time, tp, "tp", pnl(s, filled.qty / s.tps.length, filled.avg, tp));
      s.tpHits++;
    }
    if (s.tpHits === s.tps.length) {
      s.status = "closed";
      s.exit = "tp";
      s.closedAt = c.time;
    }
  }
  return { state: s, events };
}

/** The admin closes what is left at `price` (an open signal) or cancels a pending one. */
export function closeByHand(start: EngineState, price: number | null, at: number): { state: EngineState; events: EngineEvent[] } {
  const s: EngineState = { ...start, tps: [...start.tps] };
  if (s.status === "pending") {
    s.status = "cancelled";
    s.exit = "cancel_admin";
    s.closedAt = at;
    return { state: s, events: [{ at, kind: "cancelled", price: price ?? s.entry, r: null }] };
  }
  if (s.status !== "open" || price === null) return { state: s, events: [] };
  const r = pnl(s, remainingOf(s), filledOf(s).avg, price);
  s.realizedR = s.realizedR + r;
  s.status = "closed";
  s.exit = "manual";
  s.closedAt = at;
  return { state: s, events: [{ at, kind: "manual_close", price, r: round(r) }] };
}

/**
 * Checks the price ladder: long SL < ET2 < ET1 < TP1 < TP2 < TP3, short the other way round.
 * `entry2` must already be ordered (orderEntries).
 */
export function ladderError(side: SignalSide, entry: number, sl: number, tps: number[], entry2: number | null = null): string | null {
  const nums = [entry, sl, ...tps, ...(entry2 === null ? [] : [entry2])];
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return "Giá phải là số dương.";
  if (tps.length < 1 || tps.length > 3) return "Cần từ 1 đến 3 TP.";
  if (entry2 !== null && entry2 === entry) return "Hai ET phải khác nhau.";
  const up = side === "long";
  const ladder = [sl, ...(entry2 === null ? [] : [entry2]), entry, ...tps];
  for (let i = 1; i < ladder.length; i++) {
    if (up ? !(ladder[i]! > ladder[i - 1]!) : !(ladder[i]! < ladder[i - 1]!)) {
      const et = entry2 === null ? "Entry" : up ? "ET2 < ET1" : "ET2 > ET1";
      return up ? `Lệnh Long cần SL < ${et} < TP1 < TP2 < TP3.` : `Lệnh Short cần SL > ${et} > TP1 > TP2 > TP3.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Statistics

export type Outcome = "win" | "loss" | "breakeven";

export const outcomeOf = (r: number): Outcome => (r > EPS ? "win" : r < -EPS ? "loss" : "breakeven");

/** Vietnamese status label of a signal, and the tone it is shown in. Shared by the page and the PDF. */
export function statusOf(s: Signal): { label: string; tone: "ok" | "danger" | "warn" | "muted" | "info" } {
  if (s.status === "pending") return { label: "Chờ khớp", tone: "warn" };
  if (s.status === "open") {
    const parts = [
      ...(s.entry2 !== null && s.tpHits === 0 ? [`khớp ${s.entriesFilled}/2 ET`] : []),
      ...(s.tpHits ? [`${s.tpHits}/${s.tps.length} TP`] : []),
    ];
    return { label: ["Đang chạy", ...parts].join(" · "), tone: "info" };
  }
  if (s.status === "cancelled") {
    return { label: s.exit === "cancel_admin" ? "Đã huỷ" : s.exit === "cancel_sl" ? "Huỷ (chạm SL trước)" : "Huỷ (chạm TP1 trước)", tone: "muted" };
  }
  const o = outcomeOf(s.realizedR);
  const how = s.exit === "tp" ? "hết TP" : s.exit === "sl" ? (s.tpHits ? `${s.tpHits} TP rồi SL` : "SL") : "đóng tay";
  return { label: `${o === "win" ? "Thắng" : o === "loss" ? "Thua" : "Hoà"} · ${how}`, tone: o === "win" ? "ok" : o === "loss" ? "danger" : "muted" };
}

export interface GroupStats {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winrate: number | null;
  totalR: number;
}

export interface SignalStats {
  closed: number;
  wins: number;
  losses: number;
  breakeven: number;
  open: number;
  pending: number;
  cancelled: number;
  /** wins ÷ (wins + losses); breakevens are left out. */
  winrate: number | null;
  totalR: number;
  /** Average R per closed signal (the expectancy). */
  avgR: number | null;
  avgWinR: number | null;
  /** Size of the average loss, as a positive number. */
  avgLossR: number | null;
  /** Average win ÷ average loss. */
  realizedRR: number | null;
  /** Average planned R:R of filled signals (open and closed). */
  plannedRR: number | null;
  /** Sum of winning R ÷ size of the sum of losing R. */
  profitFactor: number | null;
  /** Deepest fall of cumulative R from a previous peak (≤ 0). */
  maxDrawdownR: number;
  longestWinStreak: number;
  longestLossStreak: number;
  equity: { id: number; symbol: string; at: string; r: number; cum: number }[];
  /** One row per week (Monday, Vietnam time), first closed signal to last, empty weeks included. */
  weekly: { week: string; wins: number; losses: number; breakeven: number; r: number }[];
  /** Closed signals by R, in 0.5R bins. */
  histogram: { from: number; to: number; count: number }[];
  bySymbol: GroupStats[];
  bySide: GroupStats[];
}

const VN_OFFSET = 7 * 3_600_000;
const DAY = 86_400_000;

/** Monday of the Vietnam-time week containing `ms`, as YYYY-MM-DD. */
export function vnWeekKey(ms: number): string {
  const day = Math.floor((ms + VN_OFFSET) / DAY);
  const monday = day - ((day + 3) % 7); // 1970-01-01 was a Thursday
  return new Date(monday * DAY).toISOString().slice(0, 10);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const closedTime = (s: Signal) => Date.parse(s.closedAt ?? s.createdAt);

function groupBy(closed: Signal[], keyOf: (s: Signal) => string): GroupStats[] {
  const map = new Map<string, Signal[]>();
  for (const s of closed) map.set(keyOf(s), [...(map.get(keyOf(s)) ?? []), s]);
  return [...map.entries()]
    .map(([key, list]) => {
      const wins = list.filter((s) => outcomeOf(s.realizedR) === "win").length;
      const losses = list.filter((s) => outcomeOf(s.realizedR) === "loss").length;
      return {
        key,
        trades: list.length,
        wins,
        losses,
        winrate: wins + losses ? wins / (wins + losses) : null,
        totalR: round(sum(list.map((s) => s.realizedR)), 2),
      };
    })
    .sort((a, b) => b.trades - a.trades || a.key.localeCompare(b.key));
}

export function computeStats(signals: Signal[]): SignalStats {
  const closed = signals.filter((s) => s.status === "closed").sort((a, b) => closedTime(a) - closedTime(b) || a.id - b.id);
  const rs = closed.map((s) => s.realizedR);
  const winsR = rs.filter((r) => outcomeOf(r) === "win");
  const lossR = rs.filter((r) => outcomeOf(r) === "loss");
  const filled = signals.filter((s) => s.status === "open" || s.status === "closed");

  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let winRun = 0;
  let lossRun = 0;
  let bestWin = 0;
  let bestLoss = 0;
  const equity = closed.map((s) => {
    cum = round(cum + s.realizedR);
    peak = Math.max(peak, cum);
    maxDd = Math.min(maxDd, cum - peak);
    const o = outcomeOf(s.realizedR);
    winRun = o === "win" ? winRun + 1 : 0;
    lossRun = o === "loss" ? lossRun + 1 : 0;
    bestWin = Math.max(bestWin, winRun);
    bestLoss = Math.max(bestLoss, lossRun);
    return { id: s.id, symbol: s.symbol, at: s.closedAt ?? s.createdAt, r: s.realizedR, cum };
  });

  const weekly: SignalStats["weekly"] = [];
  if (closed.length) {
    const byWeek = new Map<string, Signal[]>();
    for (const s of closed) {
      const k = vnWeekKey(closedTime(s));
      byWeek.set(k, [...(byWeek.get(k) ?? []), s]);
    }
    const first = Date.parse(vnWeekKey(closedTime(closed[0]!)));
    const last = Date.parse(vnWeekKey(closedTime(closed[closed.length - 1]!)));
    for (let t = first; t <= last; t += 7 * DAY) {
      const k = new Date(t).toISOString().slice(0, 10);
      const list = byWeek.get(k) ?? [];
      weekly.push({
        week: k,
        wins: list.filter((s) => outcomeOf(s.realizedR) === "win").length,
        losses: list.filter((s) => outcomeOf(s.realizedR) === "loss").length,
        breakeven: list.filter((s) => outcomeOf(s.realizedR) === "breakeven").length,
        r: round(sum(list.map((s) => s.realizedR)), 2),
      });
    }
  }

  const histogram: SignalStats["histogram"] = [];
  if (rs.length) {
    const lo = Math.floor(Math.min(...rs) * 2) / 2;
    const hi = Math.max(lo + 0.5, Math.ceil(Math.max(...rs) * 2) / 2);
    for (let from = lo; from < hi - EPS; from += 0.5) {
      const to = from + 0.5;
      const isLast = to >= hi - EPS;
      histogram.push({ from, to, count: rs.filter((r) => r >= from - EPS && (isLast ? r <= to + EPS : r < to - EPS)).length });
    }
  }

  const avgWin = avg(winsR);
  const avgLoss = avg(lossR.map((r) => -r));
  return {
    closed: closed.length,
    wins: winsR.length,
    losses: lossR.length,
    breakeven: closed.length - winsR.length - lossR.length,
    open: signals.filter((s) => s.status === "open").length,
    pending: signals.filter((s) => s.status === "pending").length,
    cancelled: signals.filter((s) => s.status === "cancelled").length,
    winrate: winsR.length + lossR.length ? winsR.length / (winsR.length + lossR.length) : null,
    totalR: round(sum(rs), 2),
    avgR: avg(rs),
    avgWinR: avgWin,
    avgLossR: avgLoss,
    realizedRR: avgWin !== null && avgLoss ? avgWin / avgLoss : null,
    plannedRR: avg(filled.map(plannedRR)),
    profitFactor: lossR.length ? sum(winsR) / -sum(lossR) : null,
    maxDrawdownR: round(maxDd, 2),
    longestWinStreak: bestWin,
    longestLossStreak: bestLoss,
    equity,
    weekly,
    histogram,
    bySymbol: groupBy(closed, (s) => s.symbol),
    bySide: groupBy(closed, (s) => s.side),
  };
}
