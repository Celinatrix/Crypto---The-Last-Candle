/**
 * POST /api/admin/auth/verify — checks the emailed code and starts an admin session: 12 hours, or
 * 3 days on a device the admin chose to remember.
 * Body: { email: string; code: string; remember?: boolean }
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_REMEMBER_HOURS, ADMIN_SESSION_HOURS, buildAdminCookie, isAdminEmail } from "@/backend/admin";
import { bytea, eq, rpc, update } from "@/backend/db";
import { sameOrigin } from "@/backend/guard";
import { generateSessionToken, otpHash, sha256 } from "@/backend/session";

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

  const expired = "Mã đã hết hạn hoặc chưa được gửi. Hãy yêu cầu mã mới.";
  if (!isAdminEmail(email)) return fail(expired, 400);

  try {
    const token = generateSessionToken();
    const tokenHash = bytea(sha256(token));
    const result = await rpc<string>("admin_verify", {
      p_email: email,
      p_code_hash: bytea(otpHash("admin", email, code)),
      p_token_hash: tokenHash,
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
    if (result === "no_code") return fail(expired, 400);
    if (result === "too_many" || result === "wrong:0") return fail("Nhập sai quá nhiều lần. Hãy yêu cầu mã mới.", 429);
    if (result.startsWith("wrong:")) return fail(`Mã không đúng. Còn ${result.slice(6)} lần thử.`, 400);
    throw new Error(`admin_verify: ${result}`);
  } catch (err) {
    console.error("[/api/admin/auth/verify]", err);
    return fail("Lỗi máy chủ. Vui lòng thử lại sau.", 500);
  }
}
