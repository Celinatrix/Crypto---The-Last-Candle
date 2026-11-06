import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/backend/cronAuth";
import { adminCopy, renderDailyEmail, UNSUBSCRIBE_PLACEHOLDER } from "@/backend/dailyEmail";
import { select } from "@/backend/db";
import { sendBatch, unsubscribeHeaders, unsubscribeUrl } from "@/backend/email";
import { fetchRedEvents } from "@/backend/ffCalendar";
import { adminEmails } from "@/backend/notify";
import { vnDayAt, vnDayKey } from "@/shared/vnTime";

/**
 * Daily 07:00 (Vietnam time) email with today's ForexFactory red-folder events.
 *
 * Triggered by Vercel Cron (vercel.json: "0 0 * * *" = 00:00 UTC = 07:00 GMT+7), which
 * sends `Authorization: Bearer $CRON_SECRET`. Recipients come from public.email_recipients, plus
 * every ADMIN_EMAIL address; emails go out through Gmail, one message per person. Members get their
 * own unsubscribe link, admins get a copy without one.
 * Running this by hand again on the same day sends the email again.
 *
 * Manual checks (same Authorization header):
 *   ?preview=1        → returns the email HTML, sends nothing
 *   ?dry=1            → returns a JSON summary (events, recipient count), sends nothing
 *   ?test=a@gmail.com → sends only to that address
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 100;
const GMAIL_RE = /^[a-z0-9.+_-]+@(gmail|googlemail)\.com$/i;

const adminAddresses = () => adminEmails().map((e) => e.toLowerCase());

/** Active + warned members who have not unsubscribed (public.email_recipients), and the admins. */
async function fetchRecipients(): Promise<string[]> {
  const rows = await select<{ email: string }>("email_recipients", "select=email");
  const clean = rows.map((r) => r.email.trim().toLowerCase());
  return [...new Set([...clean.filter((e) => GMAIL_RE.test(e)), ...adminAddresses()])];
}

/** One message per recipient. Members get their own signed one-click unsubscribe link. */
async function sendDaily(
  recipients: string[],
  email: ReturnType<typeof renderDailyEmail>,
  siteUrl: string,
): Promise<number> {
  const admins = new Set(adminAddresses());
  const messages = recipients.map((to) => {
    if (admins.has(to)) return { to, ...adminCopy(email) };
    const url = unsubscribeUrl(siteUrl, to);
    return {
      to,
      subject: email.subject,
      // The placeholder sits in an href / plain text; the URL only holds [A-Za-z0-9%._~=&?/:-].
      html: email.html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, url.replaceAll("&", "&amp;")),
      text: email.text.replaceAll(UNSUBSCRIBE_PLACEHOLDER, url),
      headers: unsubscribeHeaders(url),
    };
  });
  return (await sendBatch(messages)).filter((id) => id !== null).length;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  // Local convenience: `next dev` may open ?preview=1 in a browser without the secret.
  const devPreview = process.env.NODE_ENV === "development" && params.has("preview");
  if (!devPreview && !cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = Date.now();
  // Report window: 07:00 today → 07:00 tomorrow, Vietnam time.
  const windowStart = vnDayAt(now, 7);
  const windowEnd = windowStart + 24 * 60 * 60 * 1000;
  const day = vnDayKey(windowStart);
  const siteUrl = process.env.SITE_URL || req.nextUrl.origin;

  let events;
  try {
    events = (await fetchRedEvents()).filter((e) => {
      const t = Date.parse(e.time);
      return t >= windowStart && t < windowEnd;
    });
  } catch (err) {
    return NextResponse.json({ day, error: `ForexFactory: ${(err as Error).message}` }, { status: 502 });
  }

  const email = events.length > 0 ? renderDailyEmail(events, windowStart, siteUrl) : null;

  if (params.has("preview")) {
    if (!email) return new NextResponse(`Không có tin đỏ nào cho ngày ${day}.`, { status: 200 });
    return new NextResponse(email.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  // No red events today → nothing is sent.
  if (!email) return NextResponse.json({ day, events: 0, sent: 0, skipped: "no-red-events" });

  try {
    const test = params.get("test");
    const recipients = test ? [test.trim().toLowerCase()].filter((e) => GMAIL_RE.test(e)) : await fetchRecipients();

    if (params.has("dry")) {
      return NextResponse.json({
        day,
        events: events.map((e) => `${e.time} ${e.currency} ${e.title}`),
        subject: email.subject,
        recipients: recipients.length,
      });
    }

    let sent = 0;
    const failures: string[] = [];
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const chunk = recipients.slice(i, i + BATCH_SIZE);
      try {
        sent += await sendDaily(chunk, email, siteUrl);
      } catch (err) {
        failures.push((err as Error).message);
      }
    }

    return NextResponse.json(
      { day, events: events.length, recipients: recipients.length, sent, failures },
      { status: failures.length > 0 && sent === 0 ? 502 : 200 },
    );
  } catch (err) {
    return NextResponse.json({ day, error: (err as Error).message }, { status: 500 });
  }
}
