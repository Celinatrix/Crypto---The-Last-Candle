/**
 * POST /api/register — step 1 of linking (also how a member signs in again after the session ends).
 * Body: { uid: string; email: string; turnstileToken?: string }
 *
 * Same-origin + Cloudflare Turnstile check, then one database call (public.auth_start: invitee
 * check, 1 UID = 1 Gmail, rate limits per Gmail and per IP, store the hashed code), then the
 * code is emailed. A UID not synced yet is looked up live on BingX. Step 2 is /api/verify-otp.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { RegisterResult } from "@/shared/types";
import { checkInvitee } from "@/backend/bingx";
import { bytea, rpc, upsert } from "@/backend/db";
import { otpEmailBody, sendEmail } from "@/backend/email";
import { sameOrigin, verifyTurnstile } from "@/backend/guard";
import { clientIp, generateOtp, sha256 } from "@/backend/session";

export const dynamic = "force-dynamic";

const GMAIL_RE = /^[a-z0-9.+_-]+@(gmail|googlemail)\.com$/;
const UID_RE = /^\d{5,20}$/;

const REJECTED: Record<string, [string, number]> = {
  not_invitee: ["UID này không đăng ký BingX qua link đối tác của cộng đồng.", 403],
  email_taken: ["Gmail này đã được liên kết với một UID khác.", 409],
  uid_taken: ["UID này đã được liên kết với một Gmail khác.", 409],
  rate_limited: ["Gmail này đã yêu cầu quá nhiều mã. Vui lòng thử lại sau 1 giờ.", 429],
  rate_limited_ip: ["Thiết bị của bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau 1 giờ.", 429],
};

const fail = (error: string, status: number) => NextResponse.json<RegisterResult>({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Yêu cầu không hợp lệ.", 403);

  let uid: string, email: string, turnstileToken: unknown;
  try {
    const body = (await req.json()) as { uid?: unknown; email?: unknown; turnstileToken?: unknown };
    uid = String(body?.uid ?? "").trim();
    email = String(body?.email ?? "").trim().toLowerCase();
    turnstileToken = body?.turnstileToken;
  } catch {
    return fail("Dữ liệu không hợp lệ.", 400);
  }
  if (!UID_RE.test(uid)) return fail("UID không hợp lệ. Vui lòng nhập đúng UID BingX.", 400);
  if (!GMAIL_RE.test(email)) return fail("Chỉ chấp nhận địa chỉ Gmail (@gmail.com).", 400);

  const ip = clientIp(req);
  if (!(await verifyTurnstile(turnstileToken, ip))) {
    return fail("Không xác minh được bạn là người thật. Vui lòng tải lại trang và thử lại.", 403);
  }

  try {
    const code = generateOtp();
    const start = () =>
      rpc<string>("auth_start", { p_uid: Number(uid), p_email: email, p_code_hash: bytea(sha256(code)), p_ip: ip });

    let result = await start();
    if (result === "not_invitee") {
      // Registered on BingX after this morning's sync? Ask BingX directly.
      const invitee = await checkInvitee(Number(uid)).catch((err) => {
        console.error("[/api/register] BingX lookup", err);
        return null;
      });
      if (invitee) {
        await upsert(
          "bingx_invitees",
          [{ uid: invitee.uid, direct_invitation: invitee.directInvitation, registered_at: invitee.registeredAt }],
          "uid",
        );
        result = await start();
      }
    }

    const rejected = REJECTED[result];
    if (rejected) return fail(...rejected);
    if (result !== "ok") throw new Error(`auth_start: ${result}`);

    await sendEmail({ to: email, ...otpEmailBody(code) });
    return NextResponse.json<RegisterResult>({ ok: true });
  } catch (err) {
    console.error("[/api/register]", err);
    return fail("Lỗi máy chủ. Vui lòng thử lại sau.", 500);
  }
}
