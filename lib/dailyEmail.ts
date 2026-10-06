import type { CalendarEvent } from "./types";
import { VN_LABEL, vnClock, vnDayKey, vnLongDate, vnShortDate } from "./vnTime";

export interface DailyEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Daily 07:00 email with today's ForexFactory red-folder events.
 * `windowStart` is 07:00 Vietnam time of the day being reported.
 * Inline styles and table layout so it renders in Gmail and other clients.
 */
export function renderDailyEmail(events: CalendarEvent[], windowStart: number, siteUrl: string): DailyEmail {
  const dateLong = vnLongDate(windowStart);
  const subject = `🔴 Lịch tin đỏ hôm nay ${vnShortDate(windowStart)} · ${events.length} tin`;
  const calendarUrl = `${siteUrl.replace(/\/$/, "")}/#news`;
  const reportDay = vnDayKey(windowStart);
  /** Events after midnight fall on the next calendar day — say so next to the time. */
  const nextDayNote = (t: number) => (vnDayKey(t) !== reportDay ? `rạng sáng ${vnShortDate(t)}` : "");

  const rows = events
    .map((e) => {
      const t = Date.parse(e.time);
      const nums = [e.forecast ? `Dự báo ${e.forecast}` : "", e.previous ? `Kỳ trước ${e.previous}` : ""]
        .filter(Boolean)
        .join(" · ");
      return `
          <tr>
            <td style="padding:14px 12px 14px 0;vertical-align:top;width:64px;border-top:1px solid #ececf1;">
              <div style="font-size:17px;font-weight:700;color:#0a0608;font-variant-numeric:tabular-nums;">${vnClock(t)}</div>
              <div style="display:inline-block;margin-top:4px;padding:2px 7px;border-radius:6px;background:#f1f2f6;font-size:11px;font-weight:700;letter-spacing:.06em;color:#3a3f4b;">${escapeHtml(e.currency)}</div>
              ${nextDayNote(t) ? `<div style="margin-top:4px;font-size:11px;color:#8a8f9c;white-space:nowrap;">${nextDayNote(t)}</div>` : ""}
            </td>
            <td style="padding:14px 0;vertical-align:top;border-top:1px solid #ececf1;">
              <div style="font-size:15px;font-weight:600;color:#0a0608;line-height:1.4;">
                <span style="display:inline-block;width:10px;height:8px;margin-right:8px;border-radius:2px;background:#e5484d;vertical-align:middle;"></span>${escapeHtml(e.title)}
              </div>
              ${nums ? `<div style="margin-top:4px;font-size:13px;color:#6b7280;">${escapeHtml(nums)}</div>` : ""}
            </td>
          </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f8;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${events.length} tin tác động cao hôm nay — tin đầu tiên lúc ${vnClock(Date.parse(events[0]?.time ?? ""))}.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="background:#0a0608;padding:26px 28px;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:24px;color:#ffffff;">The Last Candle</div>
                <div style="margin-top:14px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#a9dcec;">Lịch tin đỏ hôm nay</div>
                <div style="margin-top:6px;font-size:22px;font-weight:700;color:#ffffff;">${escapeHtml(dateLong)}</div>
                <div style="margin-top:4px;font-size:13px;color:rgba(255,255,255,.65);">${events.length} tin tác động cao · ${VN_LABEL}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 4px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 28px;">
                <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#3a3f4b;">
                  Tin đỏ thường làm thị trường biến động mạnh. Hãy cân nhắc giảm đòn bẩy và đặt stop-loss rõ ràng quanh các mốc giờ trên.
                </p>
                <a href="${escapeHtml(calendarUrl)}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#0a0608;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Xem lịch trên trang</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;background:#fafafc;border-top:1px solid #ececf1;font-size:12px;line-height:1.6;color:#8a8f9c;">
                Nguồn: ForexFactory (chỉ tin tác động cao). Bạn nhận email này vì đã liên kết Gmail tại khu vực thành viên The Last Candle.
                Để ngừng nhận, hãy trả lời email này với nội dung "Huỷ đăng ký".
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `THE LAST CANDLE — LỊCH TIN ĐỎ HÔM NAY`,
    `${dateLong} · ${events.length} tin tác động cao · ${VN_LABEL}`,
    "",
    ...events.map((e) => {
      const nums = [e.forecast ? `Dự báo ${e.forecast}` : "", e.previous ? `Kỳ trước ${e.previous}` : ""]
        .filter(Boolean)
        .join(" · ");
      const t = Date.parse(e.time);
      const when = nextDayNote(t) ? `${vnClock(t)} (${nextDayNote(t)})` : vnClock(t);
      return `${when}  [${e.currency}]  ${e.title}${nums ? `\n        ${nums}` : ""}`;
    }),
    "",
    `Xem lịch trên trang: ${calendarUrl}`,
    "",
    `Nguồn: ForexFactory. Bạn nhận email này vì đã liên kết Gmail tại The Last Candle. Trả lời "Huỷ đăng ký" để ngừng nhận.`,
  ].join("\n");

  return { subject, html, text };
}
