/**
 * POST /api/admin/auth/verify — checks the emailed code and starts an admin session: 12 hours, or
 * 3 days on a device the admin chose to remember.
 * Body: { email: string; code: string; remember?: boolean }
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_REMEMBER_HOURS, ADMIN_SESSION_HOURS, buildAdminCookie, isAdminEmail } from "@/backend/admin";
import { bytea, eq, rpc, update } from "@/backend/db";
import { sameOrigin } from "@/backend/guard";
import { clientIp, generateSessionToken, otpHash, sha256 } from "@/backend/session";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Yêu cầu không hợp lệ.", 403);

  let email: string, code: string, remember: boolean;
  try {
    const body = (await req.json()) as { email?: unknown; code?: unknown; remember?: unknown };
    email = String(body?.email ?? "").trim().toLowerCase();
    code = String(body?.code ?? "").trim();
    remember = body?.remember === true;
  } catch {
    return fail("Dữ liệu không hợp lệ.", 400);
  }
  if (email.length > 254 || !/^\d{6}$/.test(code)) return fail("Mã xác thực gồm 6 chữ số.", 400);

  // One answer for every failure, so a stranger cannot tell which address is the admin's.
  const invalid = "Mã không đúng hoặc đã hết hạn. Nhập sai nhiều lần sẽ làm mã mất hiệu lực, khi đó hãy yêu cầu mã mới.";

  try {
    const token = generateSessionToken();
    const tokenHash = bytea(sha256(token));
    const result = await rpc<string>("admin_verify", {
      p_email: email,
      p_code_hash: bytea(otpHash("admin", email, code)),
      p_token_hash: tokenHash,
      p_ip: clientIp(req),
      p_is_admin: isAdminEmail(email),
    });
    if (result === "ok") {
      let hours = ADMIN_SESSION_HOURS;
      if (remember) {
        // The database sets 12 hours; if extending fails the admin is still signed in, for 12 hours.
        const expiresAt = new Date(Date.now() + ADMIN_REMEMBER_HOURS * 3_600_000).toISOString();
        await update("admin_sessions", `token_hash=${eq(tokenHash)}`, { expires_at: expiresAt })
          .then(() => {
            hours = ADMIN_REMEMBER_HOURS;
          })
          .catch((err: unknown) => console.error("[/api/admin/auth/verify] remember", err));
      }
      return NextResponse.json(
        { ok: true },
        { headers: { "Set-Cookie": buildAdminCookie(token, req.nextUrl.protocol === "https:", hours) } },
      );
    }
    if (result === "rate_limited") return fail("Thiết bị của bạn đã thử quá nhiều lần. Vui lòng thử lại sau 1 giờ.", 429);
    if (result === "no_code" || result === "too_many" || result.startsWith("wrong:")) return fail(invalid, 400);
    throw new Error(`admin_verify: ${result}`);
  } catch (err) {
    console.error("[/api/admin/auth/verify]", err);
    return fail("Lỗi máy chủ. Vui lòng thử lại sau.", 500);
  }
}
