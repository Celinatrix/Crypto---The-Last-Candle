/**
 * Reads trading signals from screenshots (chat messages) with Claude, for the admin's
 * "paste a screenshot" shortcut. Nothing is posted here: the admin page shows each draft and
 * posts it through the normal create action, so every usual check still applies.
 */
import Anthropic from "@anthropic-ai/sdk";
import { contractFor, priceAt } from "./signals";
import { KNOWN_CALLERS, MAX_BACKDATE_MS, MINUTE_MS, type SignalOrderType, type SignalSide } from "@/shared/signals";

const MODEL = "claude-opus-5-5";
const VN_OFFSET_MS = 7 * 3_600_000;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export interface SignalImage {
  mediaType: ImageType;
  /** base64, no data: prefix */
  data: string;
}


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
  /** Who called it, as read from the screenshot */
  caller: string | null;
  /** ISO time of the chat message, when the screenshot shows one within the allowed range */
  postedAt: string | null;
  /** BingX price when it was called (the message minute, else now); null when the contract does not exist */
  refPrice: number | null;
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

Who calls signals: usually ${KNOWN_CALLERS.map((n) => `"${n}"`).join(" or ")}.
- "caller": the sender's display name shown above the message (e.g. "Phương Thắng"). Messages aligned to the right with no name are sent by the group admin, "Thanh Kiệt". Write a known caller's name exactly as listed above; another sender's name as shown; null if you cannot tell.
- "posted_at": the date and time of the message as shown in the chat, Vietnam time, formatted "YYYY-MM-DDTHH:MM". Take the date from the nearest date header above the message ("T2 16/11/2026" means 2026-11-16; "Hôm nay" means today's date given below; "Hôm qua" the day before) and the time printed on the message. Ignore the clock in the status bar of a phone screenshot. null if no message time is visible.

Rules:
- One entry in "signals" per instrument. A message like "Long #BTC #ETH" is two signals (BTC and ETH) with the same fields.
- "side": Long/Buy → "long"; Short/Sell → "short".
- "order_type": "limit" when the message says LIMIT; otherwise "market" (also when ET/Entry says "market", or when no entry is given).
- "coin": the base asset only, uppercase, without the quote: "#BTC | USDT" → "BTC", "CCUSDT" → "CC". Use the pair in an attached chart screenshot when the text does not name one. Ignore hashtags that are not instruments, such as #LIMIT.
- Prices: copy the numbers exactly as written in the message text, as plain decimal numbers. Do not convert units or add digits: "sl 86" is 86, "60.888" is 60.888. The server rescales shorthand against the market price.
- "entry": the ET/Entry price written in the text; null if it is "market" or not written (do not read it from a chart). "entry2": a second entry price (ET2) if given, else null.
- "sl": null when missing or written as "báo sau" / "later" / blank.
- "tps": every TP price written, in order (at most 3); [] when TP is blank or missing.
- "note": short extra info worth keeping from the text, e.g. "vol 0.5", "vol x1 mỗi con", else null. Never put mentions like @All, the caller's name or prices already captured in it.
- A message that only changes the stop loss of an existing trade (e.g. "SL BTC: 60.888", "dời SL ETH về 1650") goes in "sl_moves" with the coin and the new price, not in "signals".
- "unreadable": a short Vietnamese sentence about anything trade-related you could not read, else null.
Return only what the screenshots say. Never invent a price.`;

const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };
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
          note: nullableString,
          caller: nullableString,
          posted_at: nullableString,
        },
        required: ["coin", "side", "order_type", "entry", "entry2", "sl", "tps", "note", "caller", "posted_at"],
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
    unreadable: nullableString,
  },
  required: ["signals", "sl_moves", "unreadable"],
  additionalProperties: false,
};

interface RawSignal {
  coin: string;
  side: SignalSide;
  order_type: SignalOrderType;
  entry: number | null;
  entry2: number | null;
  sl: number | null;
  tps: number[];
  note: string | null;
  caller: string | null;
  posted_at: string | null;
}
interface RawOutput {
  signals: RawSignal[];
  sl_moves: { coin: string; price: number }[];
  unreadable: string | null;
}

const client = () => new Anthropic({ timeout: 50_000, maxRetries: 0 });

async function readImages(images: SignalImage[], now: number): Promise<RawOutput> {
  const todayVN = new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10);
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
          { type: "text" as const, text: `Hôm nay là ${todayVN} (giờ Việt Nam). Đọc các tín hiệu trong ảnh.` },
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

/** Resolves the contract BingX trades for a written coin (GOLD → its gold perpetual, LIT → LIGHTER-USDT). */
async function resolveBase(coin: string, warnings: string[]): Promise<{ base: string; price: number | null }> {
  const written = cleanBase(coin);
  const found = written ? await contractFor(`${written}-USDT`) : null;
  if (found === null) {
    warnings.push(`BingX không có hoặc đã ngừng giao dịch hợp đồng ${written || coin}-USDT. Sửa tên coin trước khi đăng.`);
    return { base: written, price: null };
  }
  const base = found.symbol.replace(/-USDT$/, "");
  if (base !== written) warnings.push(`${written}-USDT trên BingX là hợp đồng ${found.symbol}: đã dùng mã này.`);
  return { base, price: found.price };
}

/**
 * Chat shorthand: "60.888" for BTC near 60,000 means 60,888; "sl 86" for a coin at 0.0845 means
 * 0.086. When the number as read is far from the reference price, it is scaled by the power of ten
 * that lands it nearest (within 50%), and the admin is told.
 */
function fixScale(v: number | null, ref: number | null, label: string, warnings: string[]): number | null {
  if (v === null || ref === null || !(v > 0)) return v;
  const off = (x: number) => Math.abs(x - ref) / ref;
  if (off(v) < 0.5) return v;
  let best: number | null = null;
  for (let k = -10; k <= 6; k++) {
    if (k === 0) continue;
    const scaled = Number((v * 10 ** k).toPrecision(12));
    if (off(scaled) < 0.5 && (best === null || off(scaled) < off(best))) best = scaled;
  }
  if (best !== null) {
    warnings.push(`${label} ghi ${v}, hiểu là ${best}.`);
    return best;
  }
  warnings.push(`${label} ${v} lệch xa giá lúc gọi lệnh (${ref}). Kiểm tra lại.`);
  return v;
}

/** "2026-11-16T08:09" (Vietnam time) → ms, or null when it is not a valid time. */
function vnTime(s: string | null): number | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const ms = Date.UTC(y, mo - 1, d, h, mi) - VN_OFFSET_MS;
  return Number.isFinite(ms) ? ms : null;
}

/** Keeps a known caller's exact spelling when the model wrote it differently (case, spacing). */
function normalizeCaller(name: string | null): string | null {
  const n = name?.trim().replace(/\s+/g, " ");
  if (!n) return null;
  const key = (x: string) => x.normalize("NFC").toLowerCase();
  return KNOWN_CALLERS.find((k) => key(k) === key(n)) ?? n.slice(0, 60);
}

async function draftOf(s: RawSignal, now: number): Promise<SignalDraft> {
  const warnings: string[] = [];
  const { base, price: live } = await resolveBase(s.coin, warnings);

  let postedAt: number | null = null;
  const t = vnTime(s.posted_at);
  if (t !== null) {
    const minute = Math.floor(t / MINUTE_MS) * MINUTE_MS;
    if (minute > now) warnings.push("Giờ trên tin nhắn ở tương lai, tính từ lúc đăng.");
    else if (now - minute > MAX_BACKDATE_MS) warnings.push("Tin nhắn cũ hơn 14 ngày, tính từ lúc đăng.");
    else if (now - minute >= 2 * MINUTE_MS) postedAt = minute;
  }
  let refPrice = live;
  if (live !== null && postedAt !== null) {
    refPrice = await priceAt(`${base}-USDT`, postedAt).catch(() => null);
    if (refPrice === null) {
      warnings.push("BingX không có giá lúc gọi lệnh, tính từ lúc đăng.");
      postedAt = null;
      refPrice = live;
    }
  }

  const limit = s.order_type === "limit";
  const entry = fixScale(s.entry, refPrice, "Entry", warnings);
  // SL and TPs are scaled against the entry when one is written, else the price when called.
  const ref = entry ?? refPrice;
  const entry2 = limit ? fixScale(s.entry2, ref, "ET2", warnings) : null;
  const sl = fixScale(s.sl, ref, "SL", warnings);
  const tps = s.tps.slice(0, 3).map((tp, i) => fixScale(tp, ref, `TP${i + 1}`, warnings) ?? tp);
  if (s.tps.length > 3) warnings.push("Ảnh có hơn 3 TP, chỉ giữ 3 TP đầu.");

  const missing: string[] = [];
  if (live === null) missing.push("cặp coin");
  // A market order without a written price takes the price when it was called.
  if (entry === null && limit) missing.push("Entry");
  if (sl === null) warnings.push("Chưa có SL: vẫn đăng được, kết quả tính theo % cho tới khi thêm SL.");
  if (tps.length === 0) warnings.push("Chưa có TP: vẫn đăng được, bổ sung TP sau ở mục Đang chạy.");
  return {
    base,
    side: s.side,
    orderType: s.order_type,
    entry,
    entry2,
    sl,
    tps,
    note: s.note?.trim() ? s.note.trim().slice(0, 500) : null,
    caller: normalizeCaller(s.caller),
    postedAt: postedAt === null ? null : new Date(postedAt).toISOString(),
    refPrice,
    missing,
    warnings,
  };
}

export async function readSignalImages(images: SignalImage[]): Promise<SignalImageResult> {
  const now = Date.now();
  const raw = await readImages(images, now);
  const signals = await Promise.all(raw.signals.slice(0, 10).map((s) => draftOf(s, now)));
  const slMoves = await Promise.all(
    raw.sl_moves.slice(0, 10).map(async (m): Promise<SlMoveDraft> => {
      const warnings: string[] = [];
      const { base, price } = await resolveBase(m.coin, warnings);
      return { base, price: fixScale(m.price, price, "SL", warnings) ?? m.price, warnings };
    }),
  );
  return { signals, slMoves, unreadable: raw.unreadable?.trim() || null };
}
