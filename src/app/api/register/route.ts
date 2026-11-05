/**
 * POST /api/register — step 1 of linking (also how a member signs in again after the session ends).
 * Body: { uid: string; email: string; turnstileToken?: string }
 *
 * Same-origin + Cloudflare Turnstile check, then one database call (public.auth_start: per-IP limit
 * on codes and unknown UIDs, invitee check, 1 UID = 1 Gmail, per-Gmail limit, store the keyed hash
 * of the code), then the code is emailed. A UID not synced yet is looked up live on BingX (unless
 * BingX already said "no" within the hour). Step 2 is /api/verify-otp.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { RegisterResult } from "@/shared/types";
import { checkInvitee } from "@/backend/bingx";
import { bytea, eq, rpc, select, upsert } from "@/backend/db";
import { otpEmailBody, sendEmail } from "@/backend/email";
import { sameOrigin, verifyTurnstile } from "@/backend/guard";
import { clientIp, generateOtp, otpHash } from "@/backend/session";

export const dynamic = "force-dynamic";

const GMAIL_RE = /^[a-z0-9.+_-]{1,64}@(gmail|googlemail)\.com$/;
const UID_RE = /^\d{5,20}$/;
const MAX_EMAIL = 254;

const REJECTED: Record<string, [string, number]> = {
  not_invitee: ["UID này không đăng ký BingX qua link đối tác của cộng đồng.", 403],
  email_taken: ["Gmail này đã được liên kết với một UID khác.", 409],
  uid_taken: ["UID này đã được liên kết (hoặc đang chờ duyệt) với một Gmail khác. Nếu đây là UID của bạn, hãy liên hệ admin.", 409],
  rate_limited: ["Gmail này đã yêu cầu quá nhiều mã. Vui lòng thử lại sau 1 giờ.", 429],
  rate_limited_ip: ["Thiết bị của bạn đã thử quá nhiều lần. Vui lòng thử lại sau 1 giờ.", 429],
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
  if (email.length > MAX_EMAIL || !GMAIL_RE.test(email)) return fail("Chỉ chấp nhận địa chỉ Gmail (@gmail.com) hợp lệ.", 400);

  const ip = clientIp(req);
  const bot = await verifyTurnstile(req, turnstileToken, ip);
  if (bot === "misconfigured") {
    console.error("[/api/register] Turnstile keys missing in production — registration refused");
    return fail("Hệ thống đăng ký tạm thời chưa sẵn sàng. Vui lòng thử lại sau.", 503);
  }
  if (bot !== "ok") return fail("Không xác minh được bạn là người thật. Vui lòng tải lại trang và thử lại.", 403);

  try {
    const code = generateOtp();
    const start = () =>
      rpc<string>("auth_start", { p_uid: Number(uid), p_email: email, p_code_hash: bytea(otpHash(uid, email, code)), p_ip: ip });

    let result = await start();
    if (result === "not_invitee") {
      // Registered on BingX after this morning's sync? Ask BingX directly — unless it already said
      // "no" for this UID within the hour (keeps guessing from turning into BingX API traffic).
      const hourAgo = encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString());
      const [recentMiss] = await select<{ uid: number }>("invitee_misses", `uid=${eq(uid)}&checked_at=gt.${hourAgo}&select=uid`);
      if (!recentMiss) {
        const invitee = await checkInvitee(Number(uid)).catch((err) => {
          console.error("[/api/register] BingX lookup", err);
          return undefined; // network problem: do not remember it as a miss
        });
        if (invitee) {
          await upsert(
            "bingx_invitees",
            [{ uid: invitee.uid, direct_invitation: invitee.directInvitation, registered_at: invitee.registeredAt }],
            "uid",
          );
          result = await start();
        } else if (invitee === null) {
          await upsert("invitee_misses", [{ uid: Number(uid), checked_at: new Date().toISOString() }], "uid");
        }
      }
    }

    const rejected = REJECTED[result];
    if (rejected) return fail(...rejected);
    if (result !== "ok") throw new Error(`auth_start: ${result}`);

    try {
      await sendEmail({ to: email, ...otpEmailBody(code) });
    } catch (err) {
      console.error("[/api/register] sending the code", err);
      return fail("Không gửi được mã tới Gmail này. Hãy kiểm tra lại địa chỉ hoặc thử lại sau ít phút.", 502);
    }
    return NextResponse.json<RegisterResult>({ ok: true });
  } catch (err) {
    console.error("[/api/register]", err);
    return fail("Lỗi máy chủ. Vui lòng thử lại sau.", 500);
  }
}
