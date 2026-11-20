/**
 * Reads trading signals from screenshots (chat messages) with Claude, for the admin's
 * "paste a screenshot" shortcut. Nothing is posted here: the admin page shows each draft and
 * posts it through the normal create action, so every usual check still applies.
 */
import Anthropic from "@anthropic-ai/sdk";
import { fetchPrice } from "./signals";
import type { SignalOrderType, SignalSide } from "@/shared/signals";

const MODEL = "claude-opus-5-5";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export interface SignalImage {
  mediaType: ImageType;
  /** base64, no data: prefix */
  data: string;
}

/** Names in chat that are not BingX contract names. The admin is told when one is swapped. */
const ALIASES: Record<string, string> = { GOLD: "XAUT", XAU: "XAUT", XAUUSD: "XAUT", SILVER: "XAG", OIL: "WTI" };

export interface SignalDraft {
  /** Base coin as BingX names it, e.g. "BTC" (quote is always USDT) */
  base: string;
  side: SignalSide;
  orderType: SignalOrderType;
  entry: number | null;
  entry2: number | null;
  sl: number | null;
  tps: number[];
  note: string | null;
  /** BingX last price, null when the contract does not exist */
  livePrice: number | null;
  /** Fields still needed before it can be posted */
  missing: string[];
  warnings: string[];
}

export interface SlMoveDraft {
  base: string;
  price: number;
  warnings: string[];
}

export interface SignalImageResult {
  signals: SignalDraft[];
  slMoves: SlMoveDraft[];
  /** Anything in the image the model could not turn into a signal */
  unreadable: string | null;
}

const SYSTEM = `You read screenshots of crypto/commodity trading signals posted in a Vietnamese chat group and return them as data.

Rules:
- One entry in "signals" per instrument. A message like "Long #BTC #ETH" is two signals (BTC and ETH) with the same fields.
- "side": Long/Buy → "long"; Short/Sell → "short".
- "order_type": "limit" when the message says LIMIT; otherwise "market" (also when ET/Entry says "market").
- "coin": the base asset only, uppercase, without the quote: "#BTC | USDT" → "BTC", "#GOLD | USDT" → "GOLD". Ignore hashtags that are not instruments, such as #LIMIT.
- Prices: copy the numbers exactly as written, as plain decimal numbers in the JSON. Do not convert units. Vietnamese posts often use "." as a thousands separator ("60.888"); write what you see (60.888) and the server corrects the scale.
- "entry": the ET/Entry price; null if it is "market" or missing. "entry2": a second entry price (ET2) if given, else null.
- "sl": null when missing or written as "báo sau" / "later" / blank.
- "tps": every TP price given, in order (at most 3); [] when TP is blank or missing.
- "note": short extra info worth keeping, e.g. "vol x1 mỗi con", else null. Never put mentions like @All in it.
- A message that only changes the stop loss of an existing trade (e.g. "SL BTC: 60.888", "dời SL ETH về 1650") goes in "sl_moves" with the coin and the new price, not in "signals".
- "unreadable": a short Vietnamese sentence about anything trade-related you could not read, else null.
Return only what the screenshots say. Never invent a price.`;

const nullableNumber = { type: ["number", "null"] };
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          coin: { type: "string" },
          side: { type: "string", enum: ["long", "short"] },
          order_type: { type: "string", enum: ["market", "limit"] },
          entry: nullableNumber,
          entry2: nullableNumber,
          sl: nullableNumber,
          tps: { type: "array", items: { type: "number" } },
          note: { type: ["string", "null"] },
        },
        required: ["coin", "side", "order_type", "entry", "entry2", "sl", "tps", "note"],
        additionalProperties: false,
      },
    },
    sl_moves: {
      type: "array",
      items: {
        type: "object",
        properties: { coin: { type: "string" }, price: { type: "number" } },
        required: ["coin", "price"],
        additionalProperties: false,
      },
    },
    unreadable: { type: ["string", "null"] },
  },
  required: ["signals", "sl_moves", "unreadable"],
  additionalProperties: false,
};

interface RawOutput {
  signals: {
    coin: string;
    side: SignalSide;
    order_type: SignalOrderType;
    entry: number | null;
    entry2: number | null;
    sl: number | null;
    tps: number[];
    note: string | null;
  }[];
  sl_moves: { coin: string; price: number }[];
  unreadable: string | null;
}

const client = () => new Anthropic({ timeout: 50_000, maxRetries: 0 });

async function readImages(images: SignalImage[]): Promise<RawOutput> {
  const response = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          ...images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
          })),
          { type: "text" as const, text: "Đọc các tín hiệu trong ảnh." },
        ],
      },
    ],
  });
  if (response.stop_reason !== "end_turn") throw new Error(`Claude dừng với lý do ${response.stop_reason}`);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Claude không trả về nội dung");
  return JSON.parse(block.text) as RawOutput;
}

const cleanBase = (coin: string) => {
  const c = coin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length > 4 && c.endsWith("USDT") ? c.slice(0, -4) : c;
};

/** Resolves the BingX contract, trying a known alias when the written name does not exist. */
async function resolveBase(coin: string, warnings: string[]): Promise<{ base: string; price: number | null }> {
  const written = cleanBase(coin);
  const price = written ? await fetchPrice(`${written}-USDT`) : null;
  if (price !== null) return { base: written, price };
  const alias = ALIASES[written];
  if (alias) {
    const aliasPrice = await fetchPrice(`${alias}-USDT`);
    if (aliasPrice !== null) {
      warnings.push(`BingX không có ${written}-USDT, đã đổi sang ${alias}-USDT. Kiểm tra lại cặp.`);
      return { base: alias, price: aliasPrice };
    }
  }
  warnings.push(`BingX không có hợp đồng ${written || coin}-USDT. Sửa tên coin trước khi đăng.`);
  return { base: written, price: null };
}

/**
 * "60.888" written for BTC near 60,000 means 60,888: scales a number by 1000 (up to twice) when
 * that lands it near the live price and the number as read is far from it.
 */
function fixScale(v: number | null, live: number | null, label: string, warnings: string[]): number | null {
  if (v === null || live === null || !(v > 0)) return v;
  const off = (x: number) => Math.abs(x - live) / live;
  if (off(v) < 0.5) return v;
  for (const k of [1_000, 1_000_000]) {
    const scaled = Math.round(v * k * 1e8) / 1e8;
    if (off(scaled) < 0.5) {
      warnings.push(`${label} đọc được ${v}, hiểu là ${scaled} (dấu chấm phân cách hàng nghìn).`);
      return scaled;
    }
  }
  warnings.push(`${label} ${v} lệch xa giá hiện tại (${live}). Kiểm tra lại.`);
  return v;
}

export async function readSignalImages(images: SignalImage[]): Promise<SignalImageResult> {
  const raw = await readImages(images);

  const signals = await Promise.all(
    raw.signals.slice(0, 10).map(async (s): Promise<SignalDraft> => {
      const warnings: string[] = [];
      const { base, price } = await resolveBase(s.coin, warnings);
      const limit = s.order_type === "limit";
      const entry = fixScale(s.entry, price, "Entry", warnings);
      const entry2 = limit ? fixScale(s.entry2, price, "ET2", warnings) : null;
      const sl = fixScale(s.sl, price, "SL", warnings);
      const tps = s.tps.slice(0, 3).map((tp, i) => fixScale(tp, price, `TP${i + 1}`, warnings) ?? tp);
      if (s.tps.length > 3) warnings.push("Ảnh có hơn 3 TP, chỉ giữ 3 TP đầu.");
      const missing: string[] = [];
      if (price === null) missing.push("cặp coin");
      // A market order without a written price takes the live price when it is posted.
      if (entry === null && limit) missing.push("Entry");
      if (sl === null) missing.push("SL");
      if (tps.length === 0) missing.push("TP");
      return {
        base,
        side: s.side,
        orderType: s.order_type,
        entry,
        entry2,
        sl,
        tps,
        note: s.note?.trim() ? s.note.trim().slice(0, 500) : null,
        livePrice: price,
        missing,
        warnings,
      };
    }),
  );

  const slMoves = await Promise.all(
    raw.sl_moves.slice(0, 10).map(async (m): Promise<SlMoveDraft> => {
      const warnings: string[] = [];
      const { base, price } = await resolveBase(m.coin, warnings);
      return { base, price: fixScale(m.price, price, "SL", warnings) ?? m.price, warnings };
    }),
  );

  return { signals, slMoves, unreadable: raw.unreadable?.trim() || null };
}
