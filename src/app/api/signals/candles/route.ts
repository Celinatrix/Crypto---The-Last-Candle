/**
 * GET /api/signals/candles?id=N — BingX candles around one signal, for its price chart.
 * Members with a valid session only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { hasMemberSession } from "@/backend/memberAuth";
import { chartCandles, getSignal } from "@/backend/signals";
import type { SignalCandlesResponse } from "@/shared/signals";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400, headers });
  try {
    if (!(await hasMemberSession(req))) return NextResponse.json({ error: "Chưa liên kết UID." }, { status: 401, headers });
    const signal = await getSignal(id);
    if (!signal) return NextResponse.json({ error: "Không tìm thấy tín hiệu." }, { status: 404, headers });
    const { interval, candles } = await chartCandles(signal);
    return NextResponse.json<SignalCandlesResponse>({ signal, interval, candles }, { headers });
  } catch (err) {
    console.error("[/api/signals/candles]", err);
    return NextResponse.json({ error: "Không tải được giá từ BingX." }, { status: 502, headers });
  }
}
