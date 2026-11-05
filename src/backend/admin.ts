/**
 * Admin sessions for /admin. The cookie is separate from a member's: Path=/api/admin so it is sent
 * only to the admin APIs, SameSite=Strict, 12 hours. The database stores only its SHA-256, and every
 * request checks the address is still in ADMIN_EMAIL, so removing an address locks it out at once.
 */
import type { NextRequest } from "next/server";
import { bytea, rpc } from "./db";
import { adminEmails } from "./notify";
import { sha256 } from "./session";

const ADMIN_COOKIE = "slc_admin";
const ADMIN_SESSION_HOURS = 12;
const TOKEN_RE = /^[0-9a-f]{64}$/;

const cookieAttrs = (https: boolean, maxAge: number) =>
  `Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${https || process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

export const buildAdminCookie = (token: string, https: boolean) =>
  `${ADMIN_COOKIE}=${token}; ${cookieAttrs(https, ADMIN_SESSION_HOURS * 3600)}`;

export const clearAdminCookie = (https: boolean) => `${ADMIN_COOKIE}=; ${cookieAttrs(https, 0)}`;

export const isAdminEmail = (email: string) => adminEmails().some((a) => a.toLowerCase() === email);

/** The raw admin token from the cookie, when it is well formed. */
export function adminToken(req: NextRequest): string | null {
  const token = req.cookies.get(ADMIN_COOKIE)?.value ?? "";
  return TOKEN_RE.test(token) ? token : null;
}

/** The signed-in admin's address, or null. */
export async function currentAdmin(req: NextRequest): Promise<string | null> {
  const token = adminToken(req);
  if (!token) return null;
  const email = await rpc<string | null>("admin_session_email", { p_token_hash: bytea(sha256(token)) });
  return email && isAdminEmail(email) ? email : null;
}
