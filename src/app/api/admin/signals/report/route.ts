/**
 * GET /api/admin/signals/report?week=YYYY-MM-DD — the weekly signal report as a PDF download.
 * `week` is the Monday (Vietnam time) the week starts on; a signal belongs to the week it was posted in.
 * Signed-in admins only. Open signals are first brought up to the last closed BingX minute.
 */
import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/backend/admin";
import { evaluateIfStale, listSignals } from "@/backend/signals";
import { buildWeeklyReportPdf, loadReportFonts } from "@/backend/weeklyReportPdf";
import { isWeekKey, summarizeWeek, weekRange } from "@/shared/weeklyReport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function GET(req: NextRequest) {
  const week = req.nextUrl.searchParams.get("week") ?? "";
  if (!isWeekKey(week)) return fail("Tuần không hợp lệ (cần ngày thứ Hai dạng YYYY-MM-DD).", 400);
  try {
    if (!(await currentAdmin(req))) return fail("Chưa đăng nhập.", 401);
    await evaluateIfStale();
    const { start, end } = weekRange(week);
    const [signals, fonts] = await Promise.all([listSignals(1000, { from: start, to: end }), loadReportFonts()]);
    const pdf = await buildWeeklyReportPdf(summarizeWeek(signals, week), fonts);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="bao-cao-tin-hieu-tuan-${week}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[/api/admin/signals/report]", err);
    return fail("Không tạo được báo cáo. Vui lòng thử lại sau.", 500);
  }
}
