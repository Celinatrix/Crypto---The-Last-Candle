/**
 * Admin signals.
 *   GET  /api/admin/signals             every signal, replayed up to the last closed minute
 *   GET  /api/admin/signals?price=SYM   BingX last price for the form ({ price, symbol } or 404; symbol is the
 *                                       contract actually traded, e.g. LIT-USDT → LIGHTER-USDT)
 *   GET  /api/admin/signals?candles=ID  BingX candles around one signal, for its chart
 *   POST /api/admin/signals             { action: "create", symbol, side, orderType, entry, entry2?, sl, tps, note, caller?, postedAt? }
 *                                       (entry2: optional second entry, limit only; postedAt: ISO time of
 *                                       the chat message, up to 14 days back, null = now)
 *                                       (tps: 0–3; with none, add them later with set_tps)
 *                                       { action: "set_tps", id, tps }   (1–3, until a TP is hit)
 *                                       { action: "move_sl", id, price }
 *                                       { action: "close", id, price }   (a pending signal is cancelled)
 *                                       { action: "close_best", id }     (no TPs: close at the best price)
 * Signed-in admins only; POST also needs a same-origin request.
 */
import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/backend/admin";
import { sameOrigin } from "@/backend/guard";
import {
  chartCandles,
  closeSignal,
  closeSignalAtBest,
  createSignal,
  evaluateIfStale,
  contractFor,
  getSignal,
  listSignals,
  moveStop,
  setTargets,
  SignalInputError,
  SYMBOL_RE,
} from "@/backend/signals";
import type { SignalCandlesResponse, SignalsResponse } from "@/shared/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

const isPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e9;
const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export async function GET(req: NextRequest) {
  try {
    if (!(await currentAdmin(req))) return fail("Chưa đăng nhập.", 401);
    const symbol = req.nextUrl.searchParams.get("price");
    if (symbol !== null) {
      const s = symbol.trim().toUpperCase();
      if (!SYMBOL_RE.test(s)) return fail("Cặp coin phải có dạng BTC-USDT.", 400);
      const contract = await contractFor(s);
      return contract === null
        ? fail(`BingX không có hoặc đã ngừng giao dịch hợp đồng ${s}.`, 404)
        : NextResponse.json({ ok: true, price: contract.price, symbol: contract.symbol });
    }
    const candlesId = req.nextUrl.searchParams.get("candles");
    if (candlesId !== null) {
      const id = Number(candlesId);
      if (!isId(id)) return fail("Dữ liệu không hợp lệ.", 400);
      const signal = await getSignal(id);
      if (!signal) return fail("Không tìm thấy tín hiệu.", 404);
      return NextResponse.json<SignalCandlesResponse>({ signal, ...(await chartCandles(signal)) });
    }
    await evaluateIfStale();
    return NextResponse.json<SignalsResponse>({ signals: await listSignals(), updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/admin/signals GET]", err);
    return fail("Lỗi máy chủ. Vui lòng thử lại sau.", 500);
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Yêu cầu không hợp lệ.", 403);
  try {
    const admin = await currentAdmin(req);
    if (!admin) return fail("Chưa đăng nhập.", 401);
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) return fail("Dữ liệu không hợp lệ.", 400);

    switch (b.action) {
      case "create": {
        const tps = Array.isArray(b.tps) ? b.tps : [];
        if (
          typeof b.symbol !== "string" ||
          (b.side !== "long" && b.side !== "short") ||
          (b.orderType !== "market" && b.orderType !== "limit") ||
          !isPrice(b.entry) ||
          (b.entry2 !== undefined && b.entry2 !== null && !isPrice(b.entry2)) ||
          !isPrice(b.sl) ||
          tps.length > 3 ||
          !tps.every(isPrice) ||
          (b.note !== undefined && b.note !== null && typeof b.note !== "string") ||
          (b.caller !== undefined && b.caller !== null && typeof b.caller !== "string") ||
          (b.postedAt !== undefined && b.postedAt !== null && (typeof b.postedAt !== "string" || !Number.isFinite(Date.parse(b.postedAt))))
        ) {
          return fail("Dữ liệu không hợp lệ.", 400);
        }
        const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
        const id = await createSignal(
          {
            symbol: b.symbol,
            side: b.side,
            orderType: b.orderType,
            entry: b.entry,
            entry2: isPrice(b.entry2) ? b.entry2 : null,
            sl: b.sl,
            tps: tps as number[],
            note,
            caller: typeof b.caller === "string" ? b.caller : null,
            postedAt: typeof b.postedAt === "string" ? Date.parse(b.postedAt) : null,
          },
          admin,
        );
        return NextResponse.json({ ok: true, id });
      }
      case "set_tps": {
        const tps = Array.isArray(b.tps) ? b.tps : [];
        if (!isId(b.id) || tps.length < 1 || tps.length > 3 || !tps.every(isPrice)) return fail("Dữ liệu không hợp lệ.", 400);
        await setTargets(b.id, tps as number[], admin);
        return NextResponse.json({ ok: true });
      }
      case "move_sl":
        if (!isId(b.id) || !isPrice(b.price)) return fail("Dữ liệu không hợp lệ.", 400);
        await moveStop(b.id, b.price, admin);
        return NextResponse.json({ ok: true });
      case "close":
        if (!isId(b.id) || (b.price !== null && b.price !== undefined && !isPrice(b.price))) return fail("Dữ liệu không hợp lệ.", 400);
        await closeSignal(b.id, isPrice(b.price) ? b.price : null, admin);
        return NextResponse.json({ ok: true });
      case "close_best":
        if (!isId(b.id)) return fail("Dữ liệu không hợp lệ.", 400);
        await closeSignalAtBest(b.id, admin);
        return NextResponse.json({ ok: true });
      default:
        return fail("Dữ liệu không hợp lệ.", 400);
    }
  } catch (err) {
    if (err instanceof SignalInputError) return fail(err.message, 422);
    console.error("[/api/admin/signals POST]", err);
    return fail("Lỗi máy chủ. Vui lòng thử lại sau.", 500);
  }
}
