/**
 * POST /api/auth/logout — revokes the current session and clears the cookie.
 * Safe to call when not signed in. Only accepted from this site's own pages.
 */
import { NextResponse, type NextRequest } from "next/server";
import { bytea, eq, update } from "@/backend/db";
import { sameOrigin } from "@/backend/guard";
import { clearSessionCookie, extractToken, sha256 } from "@/backend/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false }, { status: 403 });

  const token = extractToken(req);
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await update("member_sessions", `token_hash=${eq(bytea(sha256(token)))}&revoked_at=is.null`, {
      revoked_at: new Date().toISOString(),
    }).catch(() => {}); // the cookie is cleared either way
  }
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookie(req.nextUrl.protocol === "https:") } },
  );
}
