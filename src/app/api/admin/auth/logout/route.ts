/**
 * POST /api/admin/auth/logout — ends the admin session on the server and clears the cookie.
 * Body { all: true } ends every session of this admin, for example after losing a device.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adminToken, clearAdminCookie, currentAdmin } from "@/backend/admin";
import { bytea, rpc } from "@/backend/db";
import { sameOrigin } from "@/backend/guard";
import { sha256 } from "@/backend/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "Yêu cầu không hợp lệ." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { all?: unknown } | null;
  if (body?.all === true) {
    // Must really end them: on failure the admin has to know the lost device may still be signed in.
    try {
      const admin = await currentAdmin(req);
      if (!admin) return NextResponse.json({ ok: false, error: "Chưa đăng nhập." }, { status: 401 });
      await rpc("admin_logout_all", { p_email: admin });
    } catch (err) {
      console.error("[/api/admin/auth/logout] all", err);
      return NextResponse.json({ ok: false, error: "Chưa đăng xuất được. Vui lòng thử lại." }, { status: 500 });
    }
  } else {
    const token = adminToken(req);
    if (token) await rpc("admin_logout", { p_token_hash: bytea(sha256(token)) }).catch((err) => console.error("[/api/admin/auth/logout]", err));
  }
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": clearAdminCookie(req.nextUrl.protocol === "https:") } });
}
