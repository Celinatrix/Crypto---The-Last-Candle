import { NextResponse, type NextRequest } from "next/server";
import { DAY_MS, fetchDailyFuturesVolume, fetchInvitees, startOfUtcDay } from "@/backend/bingx";
import { cronAuthorized } from "@/backend/cronAuth";
import { insertOne, rpc, update, upsert } from "@/backend/db";
import { sendAdminDigest, sendCycleNotices } from "@/backend/notify";

/**
 * Daily BingX → Supabase sync (vercel.json: "0 2 * * *" = 02:00 UTC, after BingX publishes
 * the previous UTC day). Stores every invitee and their daily futures volume, then settles
 * Premium cycles, then emails members who are falling short and the admin (pending kicks).
 * The last 16 days are re-fetched each run so late corrections and a missed
 * run heal themselves. `?days=N` (1–365) backfills further, e.g. on the first run.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_DAYS = 16;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requested = Number(req.nextUrl.searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isInteger(requested) ? Math.min(365, Math.max(1, requested)) : DEFAULT_DAYS;
  const to = Date.now();
  const from = startOfUtcDay(to) - days * DAY_MS;

  let runId: number;
  try {
    ({ id: runId } = await insertOne<{ id: number }>("sync_runs", {
      job: "bingx_volume",
      window_start: day(from),
      window_end: day(to),
    }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  try {
    const invitees = await fetchInvitees();
    const seenAt = new Date().toISOString();
    await upsert(
      "bingx_invitees",
      invitees.map((i) => ({
        uid: i.uid,
        direct_invitation: i.directInvitation,
        registered_at: i.registeredAt,
        last_seen_at: seenAt,
      })),
      "uid",
    );

    const known = new Set(invitees.map((i) => i.uid));
    const volumes = await fetchDailyFuturesVolume(from, to);
    const rows = volumes
      .filter((v) => known.has(v.uid))
      .map((v) => ({
        bingx_uid: v.uid,
        day: v.day,
        perpetual_volume: v.perpetual,
        tradfi_volume: v.tradfi,
        fetched_at: seenAt,
      }));
    await upsert("daily_volumes", rows, "bingx_uid,day");

    const flagged = await rpc<number>("evaluate_premium_cycles");
    await rpc("purge_expired_auth_rows");

    const summary = {
      invitees: invitees.length,
      volume_rows: rows.length,
      skipped_rows: volumes.length - rows.length,
      flagged,
    };
    await update("sync_runs", `id=eq.${runId}`, { status: "succeeded", finished_at: new Date().toISOString(), ...summary });

    // Emails never fail the sync: the data is already stored.
    const siteUrl = process.env.SITE_URL || req.nextUrl.origin;
    const notices = await sendCycleNotices(siteUrl).catch((err: Error) => ({ error: err.message }));
    const pendingKicks = await sendAdminDigest().catch((err: Error) => ({ error: err.message }));

    return NextResponse.json({ window: [day(from), day(to)], ...summary, notices, pendingKicks });
  } catch (err) {
    const message = (err as Error).message;
    await update("sync_runs", `id=eq.${runId}`, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: message.slice(0, 2000),
    }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
