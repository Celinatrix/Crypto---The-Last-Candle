/**
 * Request guards for the public POST endpoints (register, verify-otp, logout).
 */
import type { NextRequest } from "next/server";

/** Origins allowed to call the POST APIs: this request's own origin and SITE_URL. */
function allowedOrigins(req: NextRequest): Set<string> {
  const allowed = new Set([req.nextUrl.origin]);
  try {
    if (process.env.SITE_URL) allowed.add(new URL(process.env.SITE_URL).origin);
  } catch {
    // malformed SITE_URL: only the request origin is allowed
  }
  return allowed;
}

/**
 * True when the request comes from this site's own pages. Browsers always send `Origin` on
 * cross-site POSTs, so a mismatch means another website is calling the API (CSRF / abuse).
 * Requests without `Origin` must at least not be marked cross-site by `Sec-Fetch-Site`.
 */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin) return allowedOrigins(req).has(origin);
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Whether the Turnstile bot check is configured (both keys set). */
export const turnstileEnabled = () =>
  Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

export type TurnstileResult = "ok" | "failed" | "misconfigured";

/**
 * Verifies a Cloudflare Turnstile token, including that it was issued for this site's hostname.
 * Without keys: allowed in development, refused in production (fail closed), so a missing
 * Vercel variable can never silently turn the bot check off.
 */
export async function verifyTurnstile(req: NextRequest, token: unknown, ip: string | null): Promise<TurnstileResult> {
  if (!turnstileEnabled()) return process.env.NODE_ENV === "production" ? "misconfigured" : "ok";
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return "failed";
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY ?? "", response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch(TURNSTILE_VERIFY, { method: "POST", body, signal: AbortSignal.timeout(8_000) });
    const result = (await res.json()) as { success?: boolean; hostname?: string };
    if (result.success !== true) return "failed";
    const hosts = new Set([...allowedOrigins(req)].map((o) => new URL(o).hostname));
    return result.hostname && hosts.has(result.hostname) ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
