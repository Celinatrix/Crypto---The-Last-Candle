/**
 * Admin signals.
 *   GET  /api/admin/signals             every signal, replayed up to the last closed minute
 *   GET  /api/admin/signals?price=SYM   BingX last price for the form ({ price } or 404)
 *   GET  /api/admin/signals?candles=ID  BingX candles around one signal, for its chart
 *   POST /api/admin/signals             { action: "create", symbol, side, orderType, entry, sl, tps, note }
 *                                       { action: "move_sl", id, price }
 *                                       { action: "close", id, price }   (a pending signal is cancelled)
 * Signed-in admins only; POST also needs a same-origin request.
 */
import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/backend/admin";
import { sameOrigin } from "@/backend/guard";
import {
  chartCandles,
  closeSignal,
  createSignal,
  evaluateIfStale,
  fetchPrice,
  getSignal,
  listSignals,
  moveStop,
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
      const price = await fetchPrice(s);
      return price === null ? fail(`BingX không có hợp đồng ${s}.`, 404) : NextResponse.json({ ok: true, price });
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
          !isPrice(b.sl) ||
          tps.length < 1 ||
          tps.length > 3 ||
          !tps.every(isPrice) ||
          (b.note !== undefined && b.note !== null && typeof b.note !== "string")
        ) {
          return fail("Dữ liệu không hợp lệ.", 400);
        }
        const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
        const id = await createSignal(
          { symbol: b.symbol, side: b.side, orderType: b.orderType, entry: b.entry, sl: b.sl, tps: tps as number[], note },
          admin,
        );
        return NextResponse.json({ ok: true, id });
      }
      case "move_sl":
        if (!isId(b.id) || !isPrice(b.price)) return fail("Dữ liệu không hợp lệ.", 400);
        await moveStop(b.id, b.price, admin);
        return NextResponse.json({ ok: true });
      case "close":
        if (!isId(b.id) || (b.price !== null && b.price !== undefined && !isPrice(b.price))) return fail("Dữ liệu không hợp lệ.", 400);
        await closeSignal(b.id, isPrice(b.price) ? b.price : null, admin);
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
