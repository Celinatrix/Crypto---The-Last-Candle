/**
 * Request guards for the public POST endpoints (register, verify-otp, logout).
 */
import type { NextRequest } from "next/server";

/**
 * True when the request comes from this site's own pages. Browsers always send `Origin` on
 * cross-site POSTs, so a mismatch means another website is calling the API (CSRF / abuse).
 * Requests without `Origin` must at least not be marked cross-site by `Sec-Fetch-Site`.
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new Set([req.nextUrl.origin]);
    if (process.env.SITE_URL) allowed.add(new URL(process.env.SITE_URL).origin);
    return allowed.has(origin);
  }
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Whether the Turnstile bot check is configured (both keys set). */
export const turnstileEnabled = () =>
  Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/**
 * Verifies a Cloudflare Turnstile token. Passes when Turnstile is not configured (local
 * development); in production set TURNSTILE_SECRET_KEY + NEXT_PUBLIC_TURNSTILE_SITE_KEY.
 */
export async function verifyTurnstile(token: unknown, ip: string | null): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? "", response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch(TURNSTILE_VERIFY, { method: "POST", body, signal: AbortSignal.timeout(8_000) });
    const result = (await res.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
