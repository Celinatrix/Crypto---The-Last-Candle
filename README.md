# The Last Candle — member area

Next.js 15 (App Router) · React 19 · TypeScript (strict) · plain CSS, "Serene" visual language
(video hero, liquid-glass cards, parallax quote section).

## Flow

1. On first open, a popup asks for the member's **BingX UID** and **Gmail** (no Telegram login).
   Both fields are required — the submit button stays disabled until both are filled in.
   It can be closed ("Để sau"); it asks again on the next visit until a UID is linked. The members
   section also keeps an inline form.
2. A successful link is remembered **for 24 hours on that device** (`lib/linkSession.ts`, localStorage).
   After that the device is treated as not linked and the popup asks again, even mid-visit. The backend
   member cookie should use the same lifetime (`Max-Age=86400`).
3. After linking, the page shows the 30-day volume dashboard and the community news feed.

## Premium volume rule

Defined once in `lib/premium.ts` (`PREMIUM_RULE`) and shown in the dashboard's progress card:

- Each cycle gives the member **14 days** to reach **60,000$** of trading volume (UTC calendar days).
- **Reached early** (e.g. day 10): the rest of the 14 days does not count, plus **3 rest days**; the next
  cycle starts the day after (day 18). Reached exactly on day 14 → rest days 15–17. Volume traded while
  resting is ignored. The card turns green with a countdown to when counting resumes.
- From **day 10**, a member still short sees an on-page warning ("còn X ngày — cần thêm $Y (~$Z/ngày)").
- Still short after day 14 → **24h grace** (day 15). Reaching the target then also earns 3 rest days
  (next cycle on day 19). Missing it → "Không đạt yêu cầu"; the **backend** must then set
  `member.status = "kicked"` (the page never removes anyone).

Because cycle start dates now depend on when each cycle was reached, the page walks cycles forward from
an anchor. `/api/me` should send `volume.cycleStart` (first day of the current or most recent cycle,
`"YYYY-MM-DD"`) and optionally `volume.cycleIndex`. Without them the page walks from `joinedAt`, which is
only correct while the member's whole history fits inside `daily` (30 days).

Dev mock scenarios: `?mock=fresh|active|soon|met|rest|grace|failed|kicked`.

## Setup

```bash
npm install
npm run dev
```

## Backend contract

All routes are same-origin. There is no Telegram session any more, so the backend identifies the
member with its own httpOnly cookie:

| Route | Behaviour |
| --- | --- |
| `POST /api/register` `{ uid, email }` | Validates the UID against the partner link, then **sets an httpOnly member cookie** (`Max-Age=86400`). Returns `{ ok: true }` or `{ error }` with 400/403/409/429/502. |
| `GET /api/me` | `{ member: null }` (or 401) when the browser has no member cookie; otherwise `{ member, volume, error? }`. |
| `GET /api/news` | `{ channel, posts, error? }` |
| `GET /api/calendar` | **Served by this app** (`app/api/calendar/route.ts`): this week's high-impact ("red folder") events from ForexFactory → `{ source, events: [{ id, title, currency, time, forecast, previous }], fetchedAt, error? }`. |
| `POST /api/auth/logout` | Clears the member cookie ("Đăng xuất"). |

Because anyone can type any UID, the backend should decide how much to trust a new registration
(e.g. require the Gmail to match a previous registration for that UID, or confirm by email).

### Economic calendar

forexfactory.com has no public API and blocks automated requests (Cloudflare), so `/api/calendar` reads the
weekly JSON export ForexFactory publishes at `nfs.faireconomy.media/ff_calendar_thisweek.json`, keeps only
`impact: "High"`, and caches it for 15 minutes server-side (the feed rate-limits frequent callers and sends no
CORS headers, so the browser cannot call it directly). Limits of that feed: current week only, forecast and
previous values but **no actual results**. The sidebar's "Lịch đỏ" tab shows upcoming events with a
countdown, highlights anything within the next hour, and keeps released events for 30 minutes as "Vừa ra".

### Daily 07:00 email (red-folder calendar)

Every day at **07:00 Vietnam time** each active member with a linked Gmail receives that day's red-folder
events (07:00 today → 07:00 tomorrow, times in GMT+7). Days with no red events send nothing.

- **Schedule** — `vercel.json` runs `/api/cron/daily-calendar` at `0 0 * * *` (00:00 UTC = 07:00 GMT+7).
  On Vercel's Hobby plan cron may fire any time within that hour; Pro runs on the minute.
- **Auth** — set `CRON_SECRET` in the Vercel project; Vercel then sends `Authorization: Bearer <secret>`
  and the route rejects anything else.
- **Sending** — Resend batch API (`RESEND_API_KEY`, `EMAIL_FROM` on a domain verified in Resend), one
  message per member, 100 per request, with an `Idempotency-Key` per day so a retried run does not
  send twice. `EMAIL_REPLY_TO` (optional) receives replies and "Huỷ đăng ký" requests and is used for
  the `List-Unsubscribe` header.
- **Recipients — backend contract.** The route calls `MEMBERS_EMAILS_URL` with
  `Authorization: Bearer $INTERNAL_API_KEY` and expects `{ "emails": ["a@gmail.com", ...] }`: the Gmail
  addresses of members who are not kicked and have not asked to unsubscribe. Non-Gmail and duplicate
  addresses are dropped.
- **Manual checks** (same header): `?preview=1` returns the email HTML (also open without the header
  under `next dev`), `?dry=1` returns a JSON summary without sending, `?test=you@gmail.com` sends only
  to that address.

### Dev mocks

Put `NEXT_PUBLIC_DEV_MOCKS=1` in `.env.development.local` to run without the backend. Switch states with
`?mock=new|fresh|active|soon|met|rest|grace|failed|kicked|error` (default `new` shows the popup). Mocks only run under
`next dev`; production builds strip them.

## Layout

```
app/        layout.tsx (fonts, metadata) · page.tsx · globals.css
components/ NewsPanel (tabs) · EconomicCalendar · MemberProvider (shared /api/me state) · LinkModal (UID + Gmail popup) · SiteNav · Hero
            Dashboard · PremiumProgress · RegisterForm · VolumeChart · NewsFeed · PremiumSection · QuoteSection · ContactSection
            LogoutButton
lib/        ffCalendar.ts (ForexFactory feed) · dailyEmail.ts (07:00 email) · vnTime.ts (GMT+7)
            api.ts (client fetchers) · format.ts (fmtUSD, timeAgo, …) · premium.ts (cycle rule)
            status.ts (member state → pill/note/alert)
            linkSession.ts (24h device link) · clipboard.ts · types.ts · useNow.ts · env.ts · mocks.ts (dev only)
```
