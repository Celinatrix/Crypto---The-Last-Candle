/**
 * /api/brief/approve?d=<day>&t=<hmac> — the admin approves the day's USD news scenario.
 *
 *   GET  → shows the text with a button (link scanners that open URLs do not approve anything)
 *   POST → approves it
 *
 * The token is an HMAC of the day, so only the link in the admin's email works, and only until 08:00
 * Vietnam time of that day: by then the 07:00 email has gone out and approving would change nothing.
 */
import { NextResponse, type NextRequest } from "next/server";
import { approveBrief, checkBriefToken, getBrief } from "@/backend/marketBrief";
import { vnDayKey, vnParts } from "@/shared/vnTime";

export const dynamic = "force-dynamic";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200) {
  const html = `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)} · The Last Candle</title></head>
<body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:64px 20px">
  <main style="max-width:520px;margin:0 auto">
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

const note = (s: string) => `<p style="color:#a3a3a3;line-height:1.6">${s}</p>`;

function params(req: NextRequest): { day: string; token: string } | null {
  const day = req.nextUrl.searchParams.get("d") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !token || token.length > 100) return null;
  try {
    return checkBriefToken(day, token) ? { day, token } : null;
  } catch {
    return null;
  }
}

const invalid = () => page("Link không hợp lệ", note("Link duyệt đã bị sửa hoặc không đầy đủ. Hãy dùng đúng link trong email."), 400);

/** Still possible to approve: the same Vietnam day, before 08:00. */
function isOpen(day: string): boolean {
  const now = Date.now();
  return vnDayKey(now) === day && vnParts(now).hour < 8;
}

const closed = () => page("Đã hết hạn duyệt", note("Email của ngày này đã được gửi, nên phần phân tích sẽ không đến thành viên."));

export async function GET(req: NextRequest) {
  const p = params(req);
  if (!p) return invalid();
  if (!isOpen(p.day)) return closed();
  try {
    const row = await getBrief(p.day);
    if (!row) return page("Không tìm thấy bản nháp", note("Ngày này chưa có bản nháp."), 404);
    const b = row.brief;
    const levels = b.assets
      .map((a) => `${escapeHtml(a.name)}: ${[a.support, a.resistance].filter((l) => l !== null).map((l) => Math.round(l as number).toLocaleString("en-US")).join(" và ")}`)
      .join(" · ");
    const text = `
      <p style="line-height:1.6"><strong>Nếu USD mạnh lên sau tin:</strong> ${escapeHtml(b.strong)}</p>
      <p style="line-height:1.6"><strong>Nếu USD yếu đi sau tin:</strong> ${escapeHtml(b.weak)}</p>
      <p style="line-height:1.6"><strong>Mức đáng chú ý:</strong> ${levels}</p>`;
    if (row.status === "approved") return page("Đã duyệt", `${text}${note("Phần này sẽ có trong email 07:00.")}`);
    const action = `/api/brief/approve?${new URLSearchParams({ d: p.day, t: p.token })}`;
    return page(
      "Duyệt phân tích tin USD?",
      `${text}
      ${note("Sau khi duyệt, thành viên sẽ nhận phần này trong email lịch tin đỏ hôm nay. Nếu email đã gửi trước lúc bạn duyệt thì phần này không được gửi thêm.")}
      <form method="post" action="${escapeHtml(action)}">
        <button type="submit" style="margin-top:12px;padding:12px 24px;border:0;border-radius:999px;background:#f97316;color:#0a0a0a;font-size:15px;font-weight:600;cursor:pointer">Duyệt</button>
      </form>`,
    );
  } catch (err) {
    console.error("[/api/brief/approve]", err);
    return page("Có lỗi xảy ra", note("Vui lòng thử lại sau ít phút."), 500);
  }
}

export async function POST(req: NextRequest) {
  const p = params(req);
  if (!p) return invalid();
  if (!isOpen(p.day)) return closed();
  try {
    await approveBrief(p.day);
  } catch (err) {
    console.error("[/api/brief/approve]", err);
    return page("Có lỗi xảy ra", note("Vui lòng thử lại sau ít phút."), 500);
  }
  return page("Đã duyệt", note("Email lịch tin đỏ gửi sau lúc này sẽ có phần phân tích. Nếu email hôm nay đã gửi trước đó thì phần này không được gửi thêm."));
}
