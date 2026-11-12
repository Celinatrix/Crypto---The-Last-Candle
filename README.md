# The Last Candle — member area

Next.js 15 (App Router) · React 19 · TypeScript (strict) · plain CSS, "Serene" visual language
(video hero, liquid-glass cards, parallax quote section) · Supabase (PostgreSQL) · BingX Agent API ·
Gmail SMTP (email) · Cloudflare Turnstile (bot check). Deployed on Vercel (region `bom1`, next to Supabase).

## Flow

1. On first open, a popup asks for the member's **BingX UID** and **Gmail**. It can be closed
   ("Để sau"); it asks again on the next visit until a UID is linked.
2. **Gửi mã xác thực** (`POST /api/register`): bot check, the UID must be under the partner link
   (looked up live on BingX if today's sync has not seen it yet), 1 UID = 1 Gmail. A 6-digit code is
   emailed (valid 10 min, 5 tries; at most 5 codes/hour per Gmail and 10/hour per IP).
3. **Xác nhận** (`POST /api/verify-otp`): creates the member and membership and sets an httpOnly session
   cookie for **7 days**. The device also remembers the link for 7 days (`linkSession.ts`). Signing in
   again later uses the same two steps.
4. The dashboard shows the current Premium cycle and 30 days of crypto-futures volume.

## Premium volume rule

Defined in `src/frontend/lib/premium.ts` (`PREMIUM_RULE`) for the page and in the database function
`public.evaluate_premium_cycles` for the daily evaluation — keep them in sync.

- Cycles follow the calendar, the same for everyone: **day 1–14** and **day 15–end of month** (UTC).
  A member is counted from the first day of the cycle they join in.
- Each cycle needs **68,686$ of crypto-futures volume** = BingX `perpetualFutures` − `tradFi`
  (TradFi is reported inside perpetualFutures).
- **Reached early**: the rest of the cycle is rest time and its volume is ignored.
- **3 days left** and still short: on-page warning + one reminder email to the member's linked Gmail.
- Still short at the end: **24h grace** (the next cycle's first day) + one email. Missing it marks the
  cycle `failed`, the membership `warned`, and opens a **kick review** for the admin.

## Data & jobs

- **Schema**: `supabase/migrations/*.sql`, run in order in the Supabase SQL Editor (each file once).
  RLS is on everywhere with no policies; only the server's secret key can read or write.
- **Daily sync** (`/api/cron/sync-volume`, 02:00 UTC = 09:00 VN): invitees + the last 16 days of volume
  from BingX (self-healing upsert), then cycle evaluation, member warning emails, and the admin digest
  of pending kick reviews (`ADMIN_EMAIL`). `?days=N` (≤365) backfills.
- **Kick decision**: in Supabase → Table Editor → `kick_reviews`, set `decision` to `approved` (kick) or
  `rejected` (stay; continues from the calendar cycle containing that day). Triggers apply it and the
  change is recorded in `audit_log`.
- **Daily 07:00 email** (`/api/cron/daily-calendar`, 00:00 UTC): today's ForexFactory red-folder events
  to `public.email_recipients` (active + warned, not unsubscribed). Each message carries a signed
  one-click unsubscribe link (`/api/unsubscribe`, also Gmail's own button). Manual checks with the cron
  header: `?preview=1`, `?dry=1`, `?test=you@gmail.com`.

## Signal statistics

The admin posts signals in `/admin` → **Tín hiệu** (symbol, Long/Short, Market/Limit, entry, SL, 1–3 TPs).
Each one is scored automatically against BingX public 1-minute candles (`swap/v3/quote/klines`, no key).
The rules are in `src/shared/signals.ts`, which the server, the admin page and the mocks all share:

- 1R = |entry − original SL|. Profit is counted in R, so capital and leverage do not matter.
- The position is split evenly across the TPs. The SL stays put unless the admin moves it ("Dời SL").
- Limit orders fill when a candle touches the entry. Reaching the SL or TP1 first cancels the signal, and
  cancelled signals are left out of the stats. Market orders fill at the posted entry.
- Replay starts at the first full minute after the post. A candle that reaches both SL and TP counts as SL.
- Win / loss / breakeven = total R above / below / equal to 0. Winrate = wins ÷ (wins + losses).
- Signals are brought up to date when someone opens the page (at most once a minute per instance), and
  `/api/cron/signals` (03:00 UTC) catches up every open signal daily.

Members who linked a UID see the section on the home page (`#signals`): KPI tiles, R equity curve,
weekly wins/losses, R distribution, winrate by symbol and side, and a BingX candle chart per signal.
Schema: `supabase/migrations/20261112000000_signals.sql`.

## Routes

| Route | Behaviour |
| --- | --- |
| `POST /api/register` `{ uid, email, turnstileToken }` | Step 1: emails a code. `{ ok }` or `{ ok: false, error }` (400/403/409/429/500). |
| `POST /api/verify-otp` `{ uid, email, code }` | Step 2: sets the 7-day session cookie. |
| `GET /api/me` | 401 `{ member: null }` without a valid session; otherwise `{ member, volume }`. |
| `POST /api/auth/logout` | Revokes the session and clears the cookie. |
| `GET /api/calendar` | This week's high-impact ForexFactory events (cached 15 min). |
| `GET /api/signals` | Member session: every signal with its replayed outcome `{ signals, updatedAt }`. 401 otherwise. |
| `GET /api/signals/candles?id=` | Member session: BingX candles around one signal, for its chart. |
| `GET\|POST /api/admin/signals` | Admin: list (`?price=SYM` live price, `?candles=ID` chart); POST `create`, `move_sl`, `close`. |
| `GET\|POST /api/unsubscribe?e=&t=` | Confirmation page / stop the 07:00 email. |
| `GET /api/cron/*` | Vercel Cron only (`Authorization: Bearer $CRON_SECRET`). |

POST routes accept same-origin requests only. Security headers (CSP, frame-ancestors, HSTS) are set in
`next.config.ts`.

### Economic calendar

forexfactory.com has no public API and blocks automated requests, so `/api/calendar` reads the weekly
JSON export at `nfs.faireconomy.media/ff_calendar_thisweek.json`, keeps `impact: "High"`, and caches it
for 15 minutes server-side. Current week only; forecast and previous values, no actual results.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the keys (see comments in the file)
npm run dev
```

### Dev mocks

`NEXT_PUBLIC_DEV_MOCKS=1` runs the page without the backend. Switch states with
`?mock=new|fresh|active|soon|met|rest|grace|failed|kicked|error`. A dev-only virtual clock
(`devClock.ts`) moves "today" to the cycle day each scenario needs. Mocks only run under `next dev`.

## Layout

Toàn bộ code nằm trong `src/`; ngoài gốc chỉ còn file cấu hình và `supabase/migrations/`.

```
src/
  app/              Next.js routing — chỉ là "cửa vào"
    layout.tsx · page.tsx · globals.css
    api/register · verify-otp · me · auth/logout · unsubscribe · calendar
    api/cron/sync-volume · cron/daily-calendar

  frontend/         Chạy trên trình duyệt
    components/     NewsPanel · EconomicCalendar · MemberProvider · LinkModal · RegisterForm · Turnstile
                    Dashboard · PremiumProgress · VolumeChart · SiteNav · Hero
                    PremiumSection · QuoteSection · ContactSection · LogoutButton
    lib/            api.ts · premium.ts (cycle rule) · status.ts · format.ts · linkSession.ts (7-day link)
                    useNow.ts · devClock.ts · clipboard.ts · env.ts · mocks.ts (dev only)

  backend/          Chỉ chạy trên server
    db.ts           Supabase (PostgREST) client
    bingx.ts        BingX Agent API (invitees, daily volume, live UID check)
    session.ts      OTP / session tokens and cookies
    guard.ts        same-origin check, Turnstile verification
    email.ts        Gmail SMTP, templates, unsubscribe links
    notify.ts       member warnings + admin kick digest
    cronAuth.ts · ffCalendar.ts · dailyEmail.ts

  shared/           Dùng chung cả hai phía
    types.ts · vnTime.ts (GMT+7)
```
