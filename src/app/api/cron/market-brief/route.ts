import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/backend/cronAuth";
import { adminCopy, renderDailyEmail } from "@/backend/dailyEmail";
import { sendEmail } from "@/backend/email";
import { fetchRedEvents } from "@/backend/ffCalendar";
import { briefApprovalUrl, draftBrief, getBrief, saveDraft } from "@/backend/marketBrief";
import { isUsdEvent } from "@/backend/marketBriefText";
import { fetchAssetSnapshots } from "@/backend/marketData";
import { adminEmails } from "@/backend/notify";
import { vnDayAt, vnDayKey, vnShortDate } from "@/shared/vnTime";

/**
 * Drafts the USD news scenario for BTC and gold and emails it to the admin for approval.
 * Vercel Cron (vercel.json: "0 22 * * *" = 05:00 Vietnam time; it may fire up to an hour late). Only
 * an approved draft reaches members, in the 07:00 email. Runs once per day: a second run finds the
 * row and stops, so it never costs a second Claude call or replaces an approved text.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ skipped: "no-api-key" });

  const now = Date.now();
  const windowStart = vnDayAt(now, 7);
  const day = vnDayKey(windowStart);
  const siteUrl = process.env.SITE_URL || req.nextUrl.origin;

  try {
    const events = (await fetchRedEvents()).filter((e) => {
      const t = Date.parse(e.time);
      return t >= windowStart && t < windowStart + DAY_MS;
    });
    const usd = events.filter(isUsdEvent);
    if (usd.length === 0) return NextResponse.json({ day, skipped: "no-usd-events" });

    const existing = await getBrief(day);
    if (existing) return NextResponse.json({ day, skipped: "already-drafted", status: existing.status });

    const brief = await draftBrief(usd, await fetchAssetSnapshots(), now);
    await saveDraft(day, brief);

    const email = adminCopy(
      renderDailyEmail(events, windowStart, siteUrl, {
        brief,
        banner: {
          text: "Bản nháp phần phân tích. Thành viên chỉ nhận phần này nếu bạn duyệt trước khi email 07:00 được gửi. Không duyệt thì email vẫn gửi, không có phần phân tích.",
          href: briefApprovalUrl(siteUrl, day),
          label: "Xem và duyệt",
        },
      }),
    );
    const subject = `📝 Duyệt phân tích tin USD ${vnShortDate(windowStart)}`;
    for (const to of adminEmails()) await sendEmail({ to, subject, html: email.html, text: email.text });
    return NextResponse.json({ day, drafted: true });
  } catch (err) {
    const message = (err as Error).message;
    console.error("[market-brief]", err);
    const subject = `⚠️ Chưa tạo được phân tích tin USD ${vnShortDate(windowStart)}`;
    const text = `Bản nháp hôm nay không tạo được nên email 07:00 sẽ gửi không có phần phân tích.\n\nLý do: ${message}`;
    for (const to of adminEmails()) {
      await sendEmail({ to, subject, text, html: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>` }).catch(() => {});
    }
    return NextResponse.json({ day, error: message }, { status: 502 });
  }
}
