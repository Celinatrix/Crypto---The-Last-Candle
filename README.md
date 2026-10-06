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
| `POST /api/auth/logout` | Clears the member cookie ("Đăng xuất"). |

Because anyone can type any UID, the backend should decide how much to trust a new registration
(e.g. require the Gmail to match a previous registration for that UID, or confirm by email).

### Dev mocks

Put `NEXT_PUBLIC_DEV_MOCKS=1` in `.env.development.local` to run without the backend. Switch states with
`?mock=new|fresh|active|soon|warned|kicked|error` (default `new` shows the popup). Mocks only run under
`next dev`; production builds strip them.

## Layout

```
app/        layout.tsx (fonts, metadata) · page.tsx · globals.css
components/ MemberProvider (shared /api/me state) · LinkModal (UID + Gmail popup) · SiteNav · Hero
            Dashboard · RegisterForm · VolumeChart · NewsFeed · QuoteSection · LogoutButton
lib/        api.ts (client fetchers) · format.ts (fmtUSDT, timeAgo, …) · status.ts (member state → pill/note)
            linkSession.ts (24h device link) · types.ts · useNow.ts · env.ts · mocks.ts (dev only)
```
