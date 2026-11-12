/**
 * GET /api/signals — every admin signal with its replayed outcome, for members who linked their UID.
 * Open signals are first brought up to the last closed BingX minute (at most once a minute).
 * 401 without a valid member session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { hasMemberSession } from "@/backend/memberAuth";
import { evaluateIfStale, listSignals } from "@/backend/signals";
import type { SignalsResponse } from "@/shared/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  try {
    if (!(await hasMemberSession(req))) {
      return NextResponse.json({ error: "Liên kết UID để xem thống kê tín hiệu." }, { status: 401, headers });
    }
    await evaluateIfStale();
    const signals = await listSignals();
    return NextResponse.json<SignalsResponse>({ signals, updatedAt: new Date().toISOString() }, { headers });
  } catch (err) {
    console.error("[/api/signals]", err);
    return NextResponse.json({ error: "Lỗi máy chủ. Vui lòng thử lại." }, { status: 500, headers });
  }
}
