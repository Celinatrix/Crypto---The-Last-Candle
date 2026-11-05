/**
 * GET /api/admin/overview — everything the admin page shows for the current calendar cycle:
 * members with their volume, links waiting for approval, kick reviews, and partner-link UIDs that
 * traded but never linked the site. Signed-in admins only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/backend/admin";
import { rpc, select, selectAll } from "@/backend/db";
import { isRejoinReady } from "@/backend/notify";
import type { RejoinNotice } from "@/backend/email";
import { calendarCycle, PREMIUM_RULE } from "@/frontend/lib/premium";
import type { AdminMember, AdminOverview } from "@/shared/types";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const isoOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

interface ReportRow {
  uid: number;
  volume: number | string;
  trade_days: number;
}
interface OverviewRow {
  member_id: number;
  bingx_uid: number;
  email: string;
  status: "active" | "warned" | "kicked" | null;
  joined_at: string | null;
  approved: boolean;
}
interface KickRow {
  review_id: number;
  bingx_uid: number;
  email: string;
  start_day: string;
  end_day: string;
  counted_volume: number | string | null;
  target_usd: number | string;
}

export async function GET(req: NextRequest) {
  try {
    const admin = await currentAdmin(req);
    if (!admin) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });

    const today = Math.floor(Date.now() / DAY_MS);
    const cycle = calendarCycle(today);
    const start = isoOf(cycle.start);
    const end = isoOf(cycle.end);
    const target = PREMIUM_RULE.requiredUsd;

    const [report, overview, kicks, syncs, kicked] = await Promise.all([
      rpc<ReportRow[]>("cycle_report", { p_start: start, p_end: end }),
      selectAll<OverviewRow>("member_overview", "member_id"),
      select<KickRow>("pending_kick_reviews", "select=review_id,bingx_uid,email,start_day,end_day,counted_volume,target_usd"),
      select<{ status: string; started_at: string; finished_at: string | null }>(
        "sync_runs",
        "select=status,started_at,finished_at&order=id.desc&limit=1",
      ),
      rpc<RejoinNotice[]>("kicked_progress", {}),
    ]);

    const volumes = new Map(report.map((r) => [r.uid, { volume: Number(r.volume) || 0, tradeDays: r.trade_days }]));
    const memberUids = new Set(overview.map((m) => m.bingx_uid));
    const rejoin = new Map(kicked.map((k) => [k.member_id, k]));

    const members: AdminMember[] = overview.map((m) => {
      const v = volumes.get(m.bingx_uid) ?? { volume: 0, tradeDays: 0 };
      const out = rejoin.get(m.member_id);
      return {
        memberId: m.member_id,
        uid: String(m.bingx_uid),
        email: m.email,
        status: m.status === "kicked" ? "kicked" : !m.approved ? "pending" : (m.status ?? "active"),
        joinedAt: m.joined_at,
        volume: v.volume,
        tradeDays: v.tradeDays,
        shortfall: Math.max(0, target - v.volume),
        rejoin: out ? { volume: Number(out.volume_since) || 0, target: Number(out.target) || target, ready: isRejoinReady(out) } : null,
      };
    });

    const body: AdminOverview = {
      admin,
      cycle: { start, end, target },
      lastSync: syncs[0] ? { status: syncs[0].status, at: syncs[0].finished_at ?? syncs[0].started_at } : null,
      members: members.sort((a, b) => b.volume - a.volume),
      kickReviews: kicks.map((k) => ({
        reviewId: k.review_id,
        uid: String(k.bingx_uid),
        email: k.email,
        startDay: k.start_day,
        endDay: k.end_day,
        volume: Number(k.counted_volume) || 0,
        target: Number(k.target_usd) || target,
      })),
      unlinked: report
        .filter((r) => !memberUids.has(r.uid))
        .map((r) => ({ uid: String(r.uid), volume: Number(r.volume) || 0, tradeDays: r.trade_days })),
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/admin/overview]", err);
    return NextResponse.json({ error: "Lỗi máy chủ. Vui lòng thử lại sau." }, { status: 500 });
  }
}
