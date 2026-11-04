/**
 * Transactional email through Resend: OTP codes, cycle warnings, the admin kick digest,
 * and the signed one-click unsubscribe link used by the 07:00 email.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const RESEND_URL = "https://api.resend.com/emails";
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

function resendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY / EMAIL_FROM chưa được cấu hình");
  return { apiKey, from, replyTo: process.env.EMAIL_REPLY_TO || undefined };
}

const payloadOf = (m: EmailMessage, from: string, replyTo?: string) => ({
  from,
  to: [m.to],
  subject: m.subject,
  html: m.html,
  text: m.text,
  ...(replyTo ? { reply_to: replyTo } : {}),
  ...(m.headers ? { headers: m.headers } : {}),
});

async function post(url: string, body: unknown, apiKey: string, idempotencyKey?: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof json === "object" && json !== null && "message" in json ? String((json as { message: unknown }).message) : "";
    throw new Error(`Resend HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return json;
}

/** Send one email. Returns Resend's message id. */
export async function sendEmail(m: EmailMessage): Promise<string> {
  const { apiKey, from, replyTo } = resendConfig();
  const json = (await post(RESEND_URL, payloadOf(m, from, replyTo), apiKey)) as { id?: string };
  return json.id ?? "";
}

/** Send up to 100 emails in one request. Returns the message ids in order. */
export async function sendBatch(messages: EmailMessage[], idempotencyKey?: string): Promise<string[]> {
  if (messages.length === 0) return [];
  if (messages.length > 100) throw new Error("sendBatch: tối đa 100 email mỗi lần");
  const { apiKey, from, replyTo } = resendConfig();
  const json = (await post(RESEND_BATCH_URL, messages.map((m) => payloadOf(m, from, replyTo)), apiKey, idempotencyKey)) as {
    data?: { id?: string }[];
  };
  return (json.data ?? []).map((d) => d.id ?? "");
}

// ---------------------------------------------------------------------------------------------
// Unsubscribe links (07:00 email)
// ---------------------------------------------------------------------------------------------

function unsubscribeKey(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET chưa được cấu hình");
  return secret;
}

/** HMAC of the email, so only links we sent can unsubscribe an address. */
export function unsubscribeToken(email: string): string {
  return createHmac("sha256", unsubscribeKey()).update(`unsubscribe:${email}`).digest("base64url");
}

export function checkUnsubscribeToken(email: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(email));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function unsubscribeUrl(siteUrl: string, email: string): string {
  const qs = new URLSearchParams({ e: email, t: unsubscribeToken(email) });
  return `${siteUrl.replace(/\/$/, "")}/api/unsubscribe?${qs}`;
}

/** Headers that give Gmail its own "Unsubscribe" button (RFC 8058 one-click). */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const vnDay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Shared dark layout: heading, body paragraphs (already-escaped HTML) and an optional button. */
function layout(title: string, paragraphs: string[], button?: { href: string; label: string }): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto">
    <h2 style="font-family:Georgia,'Times New Roman',serif;font-style:italic;color:#ffffff;margin:0 0 20px">The Last Candle</h2>
    <h3 style="color:#f97316;margin:0 0 16px;font-size:18px">${escapeHtml(title)}</h3>
    ${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;color:#d4d4d4;margin:0 0 14px">${p}</p>`).join("")}
    ${
      button
        ? `<a href="${escapeHtml(button.href)}" style="display:inline-block;margin-top:8px;padding:12px 24px;border-radius:999px;background:#f97316;color:#0a0a0a;font-weight:600;text-decoration:none">${escapeHtml(button.label)}</a>`
        : ""
    }
  </div>
</body>
</html>`;
}

/** OTP email (HTML + plain text). */
export function otpEmailBody(code: string): { subject: string; html: string; text: string } {
  const subject = "Mã xác thực The Last Candle";
  const html = `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto">
    <h2 style="color:#f97316;margin-bottom:8px">The Last Candle</h2>
    <p style="color:#a3a3a3;margin-top:0">Mã xác thực liên kết tài khoản</p>
    <div style="background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:32px;text-align:center;margin:24px 0">
      <p style="margin:0 0 8px;color:#a3a3a3;font-size:14px">Mã OTP của bạn</p>
      <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#f97316">${code}</span>
      <p style="margin:16px 0 0;color:#737373;font-size:13px">Hết hạn sau <strong style="color:#e5e5e5">10 phút</strong></p>
    </div>
    <p style="font-size:14px;color:#737373">Không chia sẻ mã này cho ai. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
  </div>
</body>
</html>`;
  const text = `Mã OTP của bạn: ${code}\nHết hạn sau 10 phút.\n\nKhông chia sẻ mã này cho ai. Nếu bạn không yêu cầu, hãy bỏ qua email này.`;
  return { subject, html, text };
}

export interface CycleNotice {
  email: string;
  bingx_uid: number;
  kind: "cycle_warning" | "cycle_grace";
  cycle_index: number;
  start_day: string;
  end_day: string;
  counted: number | string;
  target: number | string;
}

/**
 * Member warning: a few days left and still short, or the 24h grace day. `today` is the UTC
 * day of the sync; counted volume is complete through yesterday.
 */
export function cycleNoticeEmail(n: CycleNotice, today: string, siteUrl: string): EmailMessage {
  const counted = Number(n.counted) || 0;
  const target = Number(n.target) || 0;
  const remaining = Math.max(0, target - counted);
  const daysLeft = Math.round((Date.parse(n.end_day) - Date.parse(today)) / 86_400_000) + 1;
  const link = `${siteUrl.replace(/\/$/, "")}/#member`;
  const cycle = `chu kỳ #${n.cycle_index} (${vnDay(n.start_day)} – ${vnDay(n.end_day)})`;

  const grace = n.kind === "cycle_grace";
  const subject = grace
    ? `⚠️ Gia hạn 24 giờ: còn thiếu ${usd(remaining)} volume`
    : `⏳ Còn ${daysLeft} ngày: cần thêm ${usd(remaining)} volume`;
  const title = grace ? "Bạn đang trong 24 giờ gia hạn" : `Còn ${daysLeft} ngày để đạt yêu cầu Premium`;
  const lines = grace
    ? [
        `UID <strong>${n.bingx_uid}</strong> kết thúc ${cycle} với <strong>${usd(counted)}</strong> / ${usd(target)}.`,
        `Bạn còn <strong>hôm nay (UTC)</strong> để giao dịch thêm <strong>${usd(remaining)}</strong>. Nếu vẫn chưa đủ, bạn sẽ bị đề xuất xoá khỏi nhóm Premium.`,
      ]
    : [
        `UID <strong>${n.bingx_uid}</strong> đang ở ${cycle}: <strong>${usd(counted)}</strong> / ${usd(target)} (tính đến hết hôm qua).`,
        `Bạn cần thêm <strong>${usd(remaining)}</strong>, khoảng <strong>${usd(remaining / Math.max(1, daysLeft))}</strong> mỗi ngày trong ${daysLeft} ngày còn lại.`,
      ];
  const text = [title, "", ...lines.map((l) => l.replace(/<[^>]+>/g, "")), "", `Xem tiến độ: ${link}`].join("\n");
  return { to: n.email, subject, html: layout(title, lines, { href: link, label: "Xem tiến độ" }), text };
}

export interface PendingKick {
  bingx_uid: number;
  email: string;
  cycle_index: number;
  start_day: string;
  end_day: string;
  counted_volume: number | string;
  target_usd: number | string;
}

/** Morning digest for the admin: failed cycles waiting for a kick decision. */
export function adminKickDigest(to: string, pending: PendingKick[], dashboardUrl: string): EmailMessage {
  const subject = `🛎️ ${pending.length} đề xuất kick đang chờ duyệt`;
  const rows = pending.map(
    (p) =>
      `• UID <strong>${p.bingx_uid}</strong> (${escapeHtml(p.email)}) — chu kỳ #${p.cycle_index} ${vnDay(p.start_day)}–${vnDay(p.end_day)}: ${usd(Number(p.counted_volume))} / ${usd(Number(p.target_usd))}`,
  );
  const paragraphs = [
    `Các thành viên sau không đạt chu kỳ và đã hết 24 giờ gia hạn:`,
    rows.join("<br>"),
    `Vào Supabase → Table Editor → <strong>kick_reviews</strong>, đổi cột <strong>decision</strong> thành <strong>approved</strong> (xoá khỏi nhóm) hoặc <strong>rejected</strong> (giữ lại).`,
  ];
  const text = [subject, "", ...rows.map((r) => r.replace(/<[^>]+>/g, "")), "", `Duyệt tại: ${dashboardUrl}`].join("\n");
  return { to, subject, html: layout(subject, paragraphs, { href: dashboardUrl, label: "Mở kick_reviews" }), text };
}
