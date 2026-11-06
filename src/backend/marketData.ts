/** Daily BTC and gold prices from BingX's public market data (no key needed). Server-only. */
const KLINES_URL = "https://open-api.bingx.com/openApi/swap/v3/quote/klines";

const ASSETS = [
  { name: "BTC", symbol: "BTC-USDT" },
  { name: "XAU", symbol: "NCCOGOLD2USD-USDT" },
] as const;

export interface Candle {
  high: number;
  low: number;
  close: number;
}

export interface AssetSnapshot {
  name: string;
  last: number;
  change7dPct: number;
  change30dPct: number;
  sma20: number;
  /** Average true range over 14 days: how far the price usually moves in a day. */
  atr14: number;
  low14: number;
  high14: number;
  /** Nearest of the 14-day low, 14-day high and SMA20 below the price. */
  support: number | null;
  /** Nearest of the 14-day low, 14-day high and SMA20 above the price. */
  resistance: number | null;
}

const pct = (a: number, b: number) => ((a - b) / b) * 100;

/** `candles` run oldest to newest; the last one is the day in progress. */
export function summarizeAsset(name: string, candles: Candle[]): AssetSnapshot {
  if (candles.length < 22) throw new Error(`${name}: chỉ có ${candles.length} nến`);
  const last = candles[candles.length - 1]!.close;
  const recent = candles.slice(-14);
  const sma20 = candles.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;
  const ranges = candles.slice(-15).flatMap((c, i, all) => {
    const prev = all[i - 1];
    return prev ? [Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))] : [];
  });
  const low14 = Math.min(...recent.map((c) => c.low));
  const high14 = Math.max(...recent.map((c) => c.high));
  const levels = [low14, high14, sma20];
  const below = levels.filter((l) => l < last);
  const above = levels.filter((l) => l > last);
  return {
    name,
    last,
    change7dPct: pct(last, candles[candles.length - 8]!.close),
    change30dPct: pct(last, candles[0]!.close),
    sma20,
    atr14: ranges.reduce((sum, r) => sum + r, 0) / ranges.length,
    low14,
    high14,
    support: below.length ? Math.max(...below) : null,
    resistance: above.length ? Math.min(...above) : null,
  };
}

async function fetchCandles(symbol: string): Promise<Candle[]> {
  const res = await fetch(`${KLINES_URL}?symbol=${symbol}&interval=1d&limit=31`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`BingX ${symbol}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    code: number;
    msg?: string;
    data?: { time: number; high: string; low: string; close: string }[];
  };
  if (body.code !== 0 || !body.data) throw new Error(`BingX ${symbol}: code ${body.code} ${body.msg ?? ""}`.trim());
  return [...body.data]
    .sort((a, b) => a.time - b.time)
    .map((k) => ({ high: Number(k.high), low: Number(k.low), close: Number(k.close) }));
}

export async function fetchAssetSnapshots(): Promise<AssetSnapshot[]> {
  return Promise.all(ASSETS.map(async (a) => summarizeAsset(a.name, await fetchCandles(a.symbol))));
}
