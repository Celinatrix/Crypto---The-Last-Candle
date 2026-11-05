/**
 * GET /api/admin/stats?depositDay=YYYY-MM-DD&volumeDay=YYYY-MM-DD — numbers behind the admin charts:
 * 30 days of volume and deposits, plus the per-UID detail of the two chosen days.
 * Volume days are BingX's UTC days and end yesterday, because today's figure only arrives tomorrow.
 * Deposit days are Vietnam calendar days and include today. Signed-in admins only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/backend/admin";
import { eq, rpc, select } from "@/backend/db";
import { vnDayKey, VN_OFFSET_MS } from "@/shared/vnTime";
import type { AdminStats } from "@/shared/types";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const DAYS = 30;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day in the query string, or the fallback. */
function dayParam(value: string | null, fallback: string): string {
  if (!value || !DAY_RE.test(value)) return fallback;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && iso(t) === value ? value : fallback;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await currentAdmin(req))) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

    const now = Date.now();
    const lastVolumeDay = iso(now - DAY_MS);
    const firstVolumeDay = iso(now - DAYS * DAY_MS);
    const today = vnDayKey(now);
    const firstDepositDay = vnDayKey(now - (DAYS - 1) * DAY_MS);

    const params = req.nextUrl.searchParams;
    const depositDay = dayParam(params.get("depositDay"), today);
    const volumeDay = dayParam(params.get("volumeDay"), lastVolumeDay);
    const depositFrom = Date.parse(`${depositDay}T00:00:00Z`) - VN_OFFSET_MS;

    const [volumeDaily, depositDaily, states, depositRows, volumeRows, members] = await Promise.all([
      rpc<{ day: string; linked_volume: string | number; other_volume: string | number; linked_traders: number; other_traders: number }[]>(
        "admin_volume_daily",
        { p_from: firstVolumeDay, p_to: lastVolumeDay },
      ),
      rpc<{ day: string; onchain: string | number; p2p: string | number; transfer: string | number; events: number; uids: number; other_currency: number }[]>(
        "admin_deposit_daily",
        { p_from: firstDepositDay, p_to: today },
      ),
      select<{ synced_at: string; failed_uids: number }>("deposit_sync_state", "select=synced_at,failed_uids&id=eq.1"),
      select<{ uid: number; biz_time: string; asset_type: number; asset_type_name: string; currency: string; amount: string | number }>(
        "deposits",
        `select=uid,biz_time,asset_type,asset_type_name,currency,amount&biz_time=gte.${new Date(depositFrom).toISOString()}&biz_time=lt.${new Date(depositFrom + DAY_MS).toISOString()}&order=biz_time.desc&limit=1000`,
      ),
      select<{ bingx_uid: number; crypto_futures_volume: string | number }>(
        "daily_volumes",
        `select=bingx_uid,crypto_futures_volume&day=${eq(volumeDay)}&crypto_futures_volume=gt.0&order=crypto_futures_volume.desc&limit=1000`,
      ),
      select<{ bingx_uid: number; email: string }>("member_overview", "select=bingx_uid,email&limit=1000"),
    ]);

    const emails = new Map(members.map((m) => [m.bingx_uid, m.email]));
    const body: AdminStats = {
      today,
      lastVolumeDay,
      depositDay,
      volumeDay,
      syncedAt: states[0]?.synced_at ?? null,
      failedUids: states[0]?.failed_uids ?? 0,
      volumeDaily: volumeDaily.map((d) => ({
        day: d.day,
        linked: Number(d.linked_volume) || 0,
        other: Number(d.other_volume) || 0,
        traders: d.linked_traders + d.other_traders,
      })),
      depositDaily: depositDaily.map((d) => ({
        day: d.day,
        onchain: Number(d.onchain) || 0,
        p2p: Number(d.p2p) || 0,
        transfer: Number(d.transfer) || 0,
        events: d.events,
        uids: d.uids,
        otherCurrency: d.other_currency,
      })),
      deposits: depositRows.map((d) => ({
        uid: String(d.uid),
        email: emails.get(d.uid) ?? null,
        time: d.biz_time,
        assetType: d.asset_type,
        typeName: d.asset_type_name,
        currency: d.currency,
        amount: Number(d.amount) || 0,
      })),
      dayVolumes: volumeRows.map((v) => ({
        uid: String(v.bingx_uid),
        email: emails.get(v.bingx_uid) ?? null,
        volume: Number(v.crypto_futures_volume) || 0,
      })),
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/admin/stats]", err);
    return NextResponse.json({ error: "Lỗi máy chủ. Vui lòng thử lại sau." }, { status: 500 });
  }
}
