/**
 * POST /api/admin/auth/start — emails a sign-in code to an address listed in ADMIN_EMAIL.
 * Body: { email: string; turnstileToken?: string }
 *
 * Every outcome after the bot check looks the same to the caller, including an admin address that
 * has asked for too many codes, so this cannot be used to discover who the admin is.
 */
import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminEmail } from "@/backend/admin";
import { bytea, rpc } from "@/backend/db";
import { otpEmailBody, sendEmail } from "@/backend/email";
import { sameOrigin, verifyTurnstile } from "@/backend/guard";
import { clientIp, generateOtp, otpHash } from "@/backend/session";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,}$/;

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

/** The answer when no email goes out, after about as long as sending one takes. */
async function sameAnswer() {
  await new Promise((r) => setTimeout(r, randomInt(2500, 4500)));
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Yêu cầu không hợp lệ.", 403);

  let email: string, turnstileToken: unknown;
  try {
    const body = (await req.json()) as { email?: unknown; turnstileToken?: unknown };
    email = String(body?.email ?? "").trim().toLowerCase();
    turnstileToken = body?.turnstileToken;
  } catch {
    return fail("Dữ liệu không hợp lệ.", 400);
  }
  if (email.length > 254 || !EMAIL_RE.test(email)) return fail("Địa chỉ email không hợp lệ.", 400);

  const ip = clientIp(req);
  const bot = await verifyTurnstile(req, turnstileToken, ip);
  if (bot === "misconfigured") return fail("Hệ thống đăng nhập tạm thời chưa sẵn sàng.", 503);
  if (bot !== "ok") return fail("Không xác minh được bạn là người thật. Vui lòng thử lại.", 403);

  if (!isAdminEmail(email)) return sameAnswer();

  try {
    const code = generateOtp();
    const result = await rpc<string>("admin_start", {
      p_email: email,
      p_code_hash: bytea(otpHash("admin", email, code)),
      p_ip: ip,
    });
    if (result === "rate_limited") return sameAnswer();
    await sendEmail({ to: email, ...otpEmailBody(code), subject: "🔐 Mã đăng nhập trang quản trị The Last Candle" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/auth/start]", err);
    return fail("Không gửi được mã. Vui lòng thử lại sau ít phút.", 502);
  }
}
