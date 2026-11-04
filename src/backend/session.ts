/**
 * Session & OTP helpers (all crypto stays server-side).
 *
 * Storage contract (matches the SQL schema, both columns are 32-byte bytea):
 *   email_verifications.code_hash = SHA-256(6-digit code)
 *   member_sessions.token_hash    = SHA-256(random 32-byte hex token in the cookie)
 * Sessions last 7 days (cookie Max-Age and member_sessions.expires_at).
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "slc";
/** Matches member_sessions.expires_at's default (7 days). */
export const SESSION_TTL_HOURS = 7 * 24;
export const OTP_MAX_ATTEMPTS = 5;

/** SHA-256 hex of a string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
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

export function buildSessionCookie(token: string, secure: boolean): string {
  const maxAge = SESSION_TTL_HOURS * 3600;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** Client IP as Vercel reports it (first x-forwarded-for hop), if it looks like an IP. */
export function clientIp(req: NextRequest): string | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
}
