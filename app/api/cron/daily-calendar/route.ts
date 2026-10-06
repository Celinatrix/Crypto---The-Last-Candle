import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { renderDailyEmail } from "@/lib/dailyEmail";
import { fetchRedEvents } from "@/lib/ffCalendar";
import { vnDayAt, vnDayKey } from "@/lib/vnTime";

/**
 * Daily 07:00 (Vietnam time) email with today's ForexFactory red-folder events.
 *
 * Triggered by Vercel Cron (vercel.json: "0 0 * * *" = 00:00 UTC = 07:00 GMT+7), which
 * sends `Authorization: Bearer $CRON_SECRET`. Recipients come from the backend's internal
 * endpoint; emails go out through Resend, one message per member.
 *
 * Manual checks (same Authorization header):
 *   ?preview=1        → returns the email HTML, sends nothing
 *   ?dry=1            → returns a JSON summary (events, recipient count), sends nothing
 *   ?test=a@gmail.com → sends only to that address
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const BATCH_SIZE = 100; // Resend batch limit
const GMAIL_RE = /^[a-z0-9.+_-]+@(gmail|googlemail)\.com$/i;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Active members' Gmail addresses from the backend (see README "Daily email"). */
async function fetchRecipients(): Promise<string[]> {
  const url = process.env.MEMBERS_EMAILS_URL;
  const key = process.env.INTERNAL_API_KEY;
  if (!url || !key) throw new Error("MEMBERS_EMAILS_URL / INTERNAL_API_KEY chưa được cấu hình");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Backend trả về HTTP ${res.status}`);
  const body: unknown = await res.json();
  const emails =
    typeof body === "object" && body !== null && Array.isArray((body as { emails?: unknown }).emails)
      ? (body as { emails: unknown[] }).emails
      : [];
  const clean = emails.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase());
  return [...new Set(clean.filter((e) => GMAIL_RE.test(e)))];
}

async function sendBatch(
  recipients: string[],
  email: ReturnType<typeof renderDailyEmail>,
  idempotencyKey: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY / EMAIL_FROM chưa được cấu hình");
  const replyTo = process.env.EMAIL_REPLY_TO;

  const payload = recipients.map((to) => ({
    from,
    to: [to],
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(replyTo
      ? {
          reply_to: replyTo,
          headers: { "List-Unsubscribe": `<mailto:${replyTo}?subject=Huy%20dang%20ky>` },
        }
      : {}),
  }));

  const res = await fetch(RESEND_BATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Makes a retried cron run for the same day/batch a no-op instead of a duplicate email.
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  // Local convenience: `next dev` may open ?preview=1 in a browser without the secret.
  const devPreview = process.env.NODE_ENV === "development" && params.has("preview");
  if (!devPreview && !authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
        await sendBatch(chunk, email, `daily-calendar-${day}-${test ? "test" : "all"}-${i / BATCH_SIZE}`);
        sent += chunk.length;
      } catch (err) {
        failures.push((err as Error).message);
      }
      // Stay under Resend's default rate limit (2 requests/second).
      if (i + BATCH_SIZE < recipients.length) await new Promise((r) => setTimeout(r, 600));
    }

    return NextResponse.json(
      { day, events: events.length, recipients: recipients.length, sent, failures },
      { status: failures.length > 0 && sent === 0 ? 502 : 200 },
    );
  } catch (err) {
    return NextResponse.json({ day, error: (err as Error).message }, { status: 500 });
  }
}
