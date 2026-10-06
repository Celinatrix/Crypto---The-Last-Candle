# The Last Candle — member area

Next.js 15 (App Router) · React 19 · TypeScript (strict) · plain CSS.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in NEXT_PUBLIC_TELEGRAM_BOT_USERNAME, SESSION_SECRET
npm run dev
```

The backend routes (`/api/me`, `/api/register`, `/api/news`, `/api/auth/telegram`, `/api/auth/logout`) are expected
to be served from the same origin. Register the site's domain with @BotFather (`/setdomain`) or the Telegram widget
will not render.

### Session cookie

`lib/session.ts` is the only code that reads the session. It expects an httpOnly cookie
(`SESSION_COOKIE_NAME`, default `tlc_session`) of the form
`base64url(JSON{id, first_name, username?, photo_url?, exp}) + "." + base64url(HMAC-SHA256(SESSION_SECRET, payloadPart))`.
Adapt that one function if the backend signs sessions differently.

### Dev mocks

Put `NEXT_PUBLIC_DEV_MOCKS=1` in `.env.development.local` to run without the backend. Switch states with
`?mock=out|new|fresh|active|soon|warned|kicked|error`. Mocks only run under `next dev`; production builds strip them.

## Layout

```
app/        layout.tsx (fonts, metadata) · page.tsx (server component) · globals.css
components/ TelegramLogin · Dashboard · RegisterForm · VolumeChart · NewsFeed · LogoutButton
lib/        api.ts (client fetchers) · format.ts (fmtUSDT, timeAgo, …) · status.ts (member state → pill/note)
            session.ts (server) · types.ts · useNow.ts · env.ts · mocks.ts (dev only)
```
