/**
 * GET /api/cron/signals — daily catch-up of every pending/open signal against BingX 1-minute candles
 * (up to 14 days per symbol per run), so outcomes stay current even on days nobody opens the page.
 * Vercel Cron only (Authorization: Bearer $CRON_SECRET).
 */
import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/backend/cronAuth";
import { evaluateActive } from "@/backend/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const changed = await evaluateActive(14 * 1440);
    return NextResponse.json({ ok: true, changed });
  } catch (err) {
    console.error("[/api/cron/signals]", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
