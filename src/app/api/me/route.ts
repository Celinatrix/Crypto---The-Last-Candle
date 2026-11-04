/**
 * GET /api/me — the signed-in member and their last 30 UTC days of crypto-futures volume
 * (perpetual − TradFi, the Premium metric), in one database call (public.member_me).
 * 401 when there is no valid session.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { DailyVolume, MemberStatus, MeResponse } from "@/shared/types";
import { bytea, rpc } from "@/backend/db";
import { extractToken, sha256 } from "@/backend/session";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface MemberMe {
  uid: string;
  email: string;
  status: MemberStatus | null;
  joinedAt: string | null;
  warnedAt: string | null;
  cycleStart: string | null;
  cycleIndex: number | null;
  daily: { day: string; volume: number | string }[];
  updatedAt: string | null;
}

const notLinked = () => NextResponse.json<MeResponse>({ member: null }, { status: 401 });

export async function GET(req: NextRequest) {
  const token = extractToken(req);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return notLinked();

  try {
    const me = await rpc<MemberMe | null>("member_me", { p_token_hash: bytea(sha256(token)) });
    if (!me || !me.status || !me.joinedAt) return notLinked();

    const member = { uid: me.uid, email: me.email, status: me.status, joinedAt: me.joinedAt, warnedAt: me.warnedAt };
    // Waiting for the admin: no volume until the UID ↔ Gmail link is approved.
    if (me.status === "pending") return NextResponse.json<MeResponse>({ member, volume: null });

    // 30 buckets oldest → newest; days with no trades (or not synced yet) are 0.
    const byDay = new Map(me.daily.map((d) => [d.day, Number(d.volume) || 0]));
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    const daily: DailyVolume[] = Array.from({ length: 30 }, (_, i) => {
      const day = dayKey(today - (29 - i) * DAY_MS);
      return { day, volume: byDay.get(day) ?? 0 };
    });
    const sum = (list: DailyVolume[]) => list.reduce((s, d) => s + d.volume, 0);

    return NextResponse.json<MeResponse>({
      member,
      volume: {
        total30: sum(daily),
        total14: sum(daily.slice(-14)),
        daily,
        updatedAt: me.updatedAt ?? new Date().toISOString(),
        ...(me.cycleStart ? { cycleStart: me.cycleStart, cycleIndex: me.cycleIndex ?? 1 } : {}),
      },
    });
  } catch (err) {
    console.error("[/api/me]", err);
    return NextResponse.json<MeResponse>({ member: null, error: "Lỗi máy chủ. Vui lòng thử lại." }, { status: 500 });
  }
}
