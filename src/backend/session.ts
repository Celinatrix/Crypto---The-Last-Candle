/**
 * Session & OTP helpers (all crypto stays server-side).
 *
 * Storage contract (matches the SQL schema, both columns are 32-byte bytea):
 *   email_verifications.code_hash = HMAC-SHA256(server key, "otp:<uid>:<email>:<code>")
 *     — keyed, so a leaked table cannot be reversed by trying all 1,000,000 codes.
 *   member_sessions.token_hash    = SHA-256(random 32-byte hex token in the cookie)
 *     — the token itself has 256 bits of entropy, so a plain hash is enough.
 * Sessions last 7 days (cookie Max-Age and member_sessions.expires_at).
 */
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "slc";
/** Matches member_sessions.expires_at's default (7 days). */
export const SESSION_TTL_HOURS = 7 * 24;
export const OTP_MAX_ATTEMPTS = 5;

const isProd = () => process.env.NODE_ENV === "production";

/** SHA-256 hex of a string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Keyed hash of an OTP, bound to the UID and Gmail it was sent for. */
export function otpHash(uid: string, email: string, code: string): string {
  const key = process.env.CRON_SECRET;
  if (!key) throw new Error("CRON_SECRET chưa được cấu hình");
  return createHmac("sha256", key).update(`otp:${uid}:${email}:${code}`).digest("hex");
}

/** Uniformly random 6-digit OTP (zero-padded). */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Secure random session token (64 hex chars). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** The raw session token from the cookie. */
export function extractToken(req: NextRequest): string | null {
  return req.cookies.get(SESSION_COOKIE)?.value ?? null;
}

/** `Secure` always in production; on plain-http localhost only when the request itself was https. */
const secureFlag = (https: boolean) => (https || isProd() ? "; Secure" : "");

export function buildSessionCookie(token: string, https: boolean): string {
  const maxAge = SESSION_TTL_HOURS * 3600;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag(https)}`;
}

export function clearSessionCookie(https: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(https)}`;
}

const IP_RE = /^[0-9a-f.:]{3,45}$/i;

/**
 * Client IP for rate limiting. On Vercel `x-real-ip` is set by the platform (a client cannot
 * forge it); `x-forwarded-for` is only trusted outside production (local development).
 */
export function clientIp(req: NextRequest): string | null {
  const candidates = [
    req.headers.get("x-real-ip"),
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0],
    isProd() ? null : req.headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const c of candidates) {
    const ip = c?.trim();
    if (ip && IP_RE.test(ip)) return ip;
  }
  return null;
}
