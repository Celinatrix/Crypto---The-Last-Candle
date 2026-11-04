/**
 * /api/unsubscribe?e=<email>&t=<hmac> — stop the 07:00 red-folder email (members.email_opt_out_at).
 *
 *   GET  → confirmation page with a button (link scanners that open URLs do not unsubscribe anyone)
 *   POST → unsubscribes; also what Gmail's own "Unsubscribe" button sends (RFC 8058 one-click)
 *
 * The token is an HMAC of the address, so only links from our emails work.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq, update } from "@/backend/db";
import { checkUnsubscribeToken } from "@/backend/email";

export const dynamic = "force-dynamic";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200) {
  const html = `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)} · The Last Candle</title></head>
<body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:64px 20px">
  <main style="max-width:440px;margin:0 auto">
    <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#fff;margin:0 0 24px">The Last Candle</p>
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
    ${body}
  </main>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function params(req: NextRequest): { email: string; token: string } | null {
  const email = (req.nextUrl.searchParams.get("e") ?? "").trim().toLowerCase();
  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!email || !token || email.length > 254 || token.length > 100) return null;
  try {
    return checkUnsubscribeToken(email, token) ? { email, token } : null;
  } catch {
    return null;
  }
}

const invalid = () =>
  page("Link không hợp lệ", `<p style="color:#a3a3a3;line-height:1.6">Link huỷ đăng ký đã bị sửa hoặc không đầy đủ. Hãy dùng đúng link trong email.</p>`, 400);

export async function GET(req: NextRequest) {
  const p = params(req);
  if (!p) return invalid();
  const action = `/api/unsubscribe?${new URLSearchParams({ e: p.email, t: p.token })}`;
  return page(
    "Huỷ nhận email lịch tin đỏ?",
    `<p style="color:#a3a3a3;line-height:1.6">Địa chỉ <strong style="color:#fff">${escapeHtml(p.email)}</strong> sẽ không nhận email 07:00 nữa. Các email cảnh báo về tiến độ Premium vẫn được gửi.</p>
    <form method="post" action="${escapeHtml(action)}">
      <button type="submit" style="margin-top:12px;padding:12px 24px;border:0;border-radius:999px;background:#f97316;color:#0a0a0a;font-size:15px;font-weight:600;cursor:pointer">Huỷ nhận email</button>
    </form>`,
  );
}

export async function POST(req: NextRequest) {
  const p = params(req);
  if (!p) return invalid();
  try {
    await update("members", `email=${eq(p.email)}&email_opt_out_at=is.null`, {
      email_opt_out_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/unsubscribe]", err);
    return page("Có lỗi xảy ra", `<p style="color:#a3a3a3">Vui lòng thử lại sau ít phút.</p>`, 500);
  }
  return page(
    "Đã huỷ nhận email",
    `<p style="color:#a3a3a3;line-height:1.6">Bạn sẽ không nhận email lịch tin đỏ 07:00 nữa. Muốn nhận lại, hãy liên hệ quản trị viên.</p>`,
  );
}
