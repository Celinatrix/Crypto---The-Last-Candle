/**
 * POST /api/admin/deposits/sync — refreshes deposits from BingX. Signed-in admins only. A sync from
 * the last minute is reused, so repeated clicks cannot turn into BingX API traffic.
 */
import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/backend/admin";
import { select } from "@/backend/db";
import { syncDeposits } from "@/backend/deposits";
import { sameOrigin } from "@/backend/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "Yêu cầu không hợp lệ." }, { status: 403 });
  try {
    if (!(await currentAdmin(req))) return NextResponse.json({ ok: false, error: "Chưa đăng nhập." }, { status: 401 });
    const [state] = await select<{ synced_at: string }>("deposit_sync_state", "select=synced_at&id=eq.1");
    if (state && Date.now() - Date.parse(state.synced_at) < 60_000) return NextResponse.json({ ok: true, skipped: true });
    return NextResponse.json({ ok: true, ...(await syncDeposits()) });
  } catch (err) {
    console.error("[/api/admin/deposits/sync]", err);
    return NextResponse.json({ ok: false, error: "Không lấy được dữ liệu từ BingX. Vui lòng thử lại." }, { status: 502 });
  }
}
