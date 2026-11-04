/**
 * POST /api/verify-otp — step 2 of linking / signing in.
 * Body: { uid: string; email: string; code: string }
 *
 * One database call (public.auth_verify: checks the code, creates the member / membership and
 * the session), then sets the 7-day httpOnly session cookie. A new link (or a re-join after a
 * kick) waits for the admin, who is emailed right away. Returns RegisterResult.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { RegisterResult } from "@/shared/types";
import { bytea, rpc } from "@/backend/db";
import { sameOrigin } from "@/backend/guard";
import { notifyPendingApproval } from "@/backend/notify";
import { buildSessionCookie, generateSessionToken, otpHash, sha256 } from "@/backend/session";

export const dynamic = "force-dynamic";

const GMAIL_RE = /^[a-z0-9.+_-]{1,64}@(gmail|googlemail)\.com$/;
const UID_RE = /^\d{5,20}$/;
const CODE_RE = /^\d{6}$/;
const MAX_EMAIL = 254;

const fail = (error: string, status: number) => NextResponse.json<RegisterResult>({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Yêu cầu không hợp lệ.", 403);

  let uid: string, email: string, code: string;
  try {
    const b = (await req.json()) as { uid?: unknown; email?: unknown; code?: unknown };
    uid = String(b?.uid ?? "").trim();
    email = String(b?.email ?? "").trim().toLowerCase();
    code = String(b?.code ?? "").trim();
  } catch {
    return fail("Dữ liệu không hợp lệ.", 400);
  }
  if (!UID_RE.test(uid) || email.length > MAX_EMAIL || !GMAIL_RE.test(email)) return fail("Dữ liệu không hợp lệ.", 400);
  if (!CODE_RE.test(code)) return fail("Mã xác thực gồm 6 chữ số.", 400);

  try {
    const token = generateSessionToken();
    const result = await rpc<string>("auth_verify", {
      p_uid: Number(uid),
      p_email: email,
      p_code_hash: bytea(otpHash(uid, email, code)),
      p_token_hash: bytea(sha256(token)),
    });

    if (result === "ok" || result === "ok_new") {
      if (result === "ok_new") await notifyPendingApproval(uid, email);
      return NextResponse.json<RegisterResult>(
        { ok: true },
        { headers: { "Set-Cookie": buildSessionCookie(token, req.nextUrl.protocol === "https:") } },
      );
    }
    if (result === "no_code") return fail("Mã đã hết hạn hoặc chưa được gửi. Hãy bấm gửi lại mã.", 400);
    if (result === "too_many" || result === "wrong:0") return fail("Nhập sai quá nhiều lần. Hãy bấm gửi lại mã mới.", 429);
    if (result.startsWith("wrong:")) return fail(`Mã không đúng. Còn ${result.slice(6)} lần thử.`, 400);
    if (result === "uid_taken") return fail("UID này đã được liên kết với một Gmail khác.", 409);
    throw new Error(`auth_verify: ${result}`);
  } catch (err) {
    console.error("[/api/verify-otp]", err);
    return fail("Lỗi máy chủ. Vui lòng thử lại sau.", 500);
  }
}
