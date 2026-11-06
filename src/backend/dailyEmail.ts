import type { CalendarEvent } from "@/shared/types";
import { VN_LABEL, vnClock, vnDayKey, vnLongDate, vnShortDate } from "@/shared/vnTime";
import { isUsdEvent, type MarketBrief } from "./marketBriefText";

export interface DailyEmail {
  subject: string;
  html: string;
  text: string;
}

/** Replaced per recipient with their signed unsubscribe link (see unsubscribeUrl). */
export const UNSUBSCRIBE_PLACEHOLDER = "%%UNSUBSCRIBE_URL%%";

/** The part of the footer that only applies to members: why they get it and how to stop it. */
const MEMBER_FOOTER_HTML = `Bạn nhận email này vì đã liên kết Gmail tại khu vực thành viên The Last Candle.
                <a href="${UNSUBSCRIBE_PLACEHOLDER}" style="color:#8a8f9c;text-decoration:underline;">Huỷ nhận email này</a>.`;
const MEMBER_FOOTER_TEXT = `Bạn nhận email này vì đã liên kết Gmail tại The Last Candle.
Huỷ nhận email này: ${UNSUBSCRIBE_PLACEHOLDER}`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface DailyEmailOptions {
  /** The approved scenario for BTC and gold. Left out, the USD section lists the news only. */
  brief?: MarketBrief | null;
  /** A message above the email, for the admin's draft. */
  banner?: { text: string; href: string; label: string };
}

const eventNumbers = (e: CalendarEvent) =>
  [e.forecast ? `Dự báo ${e.forecast}` : "", e.previous ? `Kỳ trước ${e.previous}` : ""].filter(Boolean).join(" · ");

const BRIEF_DISCLAIMER = "Phân tích do AI tạo, chỉ mang tính tham khảo, không phải khuyến nghị đầu tư. Thị trường có thể đi ngược mọi kịch bản.";
const price = (n: number) => Math.round(n).toLocaleString("en-US");

function briefLines(b: MarketBrief): { levels: string; snapshot: string } {
  const levels = b.assets
    .map((a) => `${a.name} ${[a.support, a.resistance].filter((l): l is number => l !== null).map(price).join(" và ")}`)
    .join(". ");
  const prices = b.assets.map((a) => `${a.name} ${price(a.last)}`).join(" · ");
  return { levels: `${levels}.`, snapshot: `Giá lúc ${vnClock(Date.parse(b.createdAt))}: ${prices}. Giá có thể đã thay đổi khi tin ra.` };
}

/** The "Chú ý tin USD" row, or nothing on a day without USD news. */
function usdSection(events: CalendarEvent[], brief?: MarketBrief | null): { html: string; text: string[] } {
  const usd = events.filter(isUsdEvent);
  if (usd.length === 0) return { html: "", text: [] };
  const para = "margin:8px 0 0;font-size:13px;line-height:1.6;color:#3a3f4b;";
  const news = usd
    .map((e) => {
      const nums = eventNumbers(e);
      return `<div style="${para}"><strong>${vnClock(Date.parse(e.time))}</strong> ${escapeHtml(e.title)}${nums ? ` <span style="color:#6b7280;">(${escapeHtml(nums)})</span>` : ""}</div>`;
    })
    .join("");
  const lines = brief ? briefLines(brief) : null;
  const analysis =
    brief && lines
      ? `<div style="${para}margin-top:14px;"><strong>Nếu USD mạnh lên sau tin:</strong> ${escapeHtml(brief.strong)}</div>
                  <div style="${para}"><strong>Nếu USD yếu đi sau tin:</strong> ${escapeHtml(brief.weak)}</div>
                  <div style="${para}"><strong>Mức đáng chú ý:</strong> ${escapeHtml(lines.levels)}</div>
                  <div style="${para}color:#6b7280;">${escapeHtml(lines.snapshot)}</div>
                  <div style="margin:10px 0 0;font-size:12px;line-height:1.6;font-style:italic;color:#6b7280;">${BRIEF_DISCLAIMER}</div>`
      : "";
  const html = `
            <tr>
              <td style="padding:16px 28px 0;">
                <div style="padding:14px 16px;border-radius:12px;background:#fff7ed;border-left:3px solid #f97316;">
                  <div style="font-size:14px;font-weight:700;color:#0a0608;">⚠️ Chú ý tin USD</div>
                  ${news}${analysis}
                </div>
              </td>
            </tr>`;
  const text = [
    "",
    "CHÚ Ý TIN USD",
    ...usd.map((e) => {
      const nums = eventNumbers(e);
      return `${vnClock(Date.parse(e.time))}  ${e.title}${nums ? ` (${nums})` : ""}`;
    }),
    ...(brief && lines
      ? [
          "",
          `Nếu USD mạnh lên sau tin: ${brief.strong}`,
          `Nếu USD yếu đi sau tin: ${brief.weak}`,
          `Mức đáng chú ý: ${lines.levels}`,
          lines.snapshot,
          BRIEF_DISCLAIMER,
        ]
      : []),
  ];
  return { html, text };
}

/**
 * Daily 07:00 email with today's ForexFactory red-folder events.
 * `windowStart` is 07:00 Vietnam time of the day being reported.
 * Inline styles and table layout so it renders in Gmail and other clients.
 */
export function renderDailyEmail(
  events: CalendarEvent[],
  windowStart: number,
  siteUrl: string,
  options: DailyEmailOptions = {},
): DailyEmail {
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

  const usd = usdSection(events, options.brief);
  const banner = options.banner;
  const bannerRow = banner
    ? `
            <tr>
              <td style="padding:16px 28px;background:#fff7ed;font-size:13px;line-height:1.6;color:#3a3f4b;">
                ${escapeHtml(banner.text)}<br>
                <a href="${escapeHtml(banner.href)}" style="display:inline-block;margin-top:10px;padding:10px 20px;border-radius:999px;background:#f97316;color:#0a0608;font-weight:700;text-decoration:none;">${escapeHtml(banner.label)}</a>
              </td>
            </tr>`
    : "";

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
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;">${bannerRow}
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
            </tr>${usd.html}
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
                Nguồn: ForexFactory (chỉ tin tác động cao). ${MEMBER_FOOTER_HTML}
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
    ...usd.text,
    "",
    `Xem lịch trên trang: ${calendarUrl}`,
    "",
    `Nguồn: ForexFactory. ${MEMBER_FOOTER_TEXT}`,
  ].join("\n");

  return { subject, html, text };
}

/**
 * The admin's copy. It has no unsubscribe link: that link only changes the members table, so for an
 * admin it would report success and change nothing.
 */
export function adminCopy(email: DailyEmail): DailyEmail {
  return {
    subject: email.subject,
    html: email.html.replace(MEMBER_FOOTER_HTML, ""),
    text: email.text.replace(MEMBER_FOOTER_TEXT, ""),
  };
}
