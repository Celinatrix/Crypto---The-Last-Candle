/** POST /api/admin/auth/logout — ends the admin session on the server and clears the cookie. */
import { NextResponse, type NextRequest } from "next/server";
import { adminToken, clearAdminCookie } from "@/backend/admin";
import { bytea, rpc } from "@/backend/db";
import { sameOrigin } from "@/backend/guard";
import { sha256 } from "@/backend/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "Yêu cầu không hợp lệ." }, { status: 403 });
  const token = adminToken(req);
  if (token) await rpc("admin_logout", { p_token_hash: bytea(sha256(token)) }).catch((err) => console.error("[/api/admin/auth/logout]", err));
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": clearAdminCookie(req.nextUrl.protocol === "https:") } });
}
