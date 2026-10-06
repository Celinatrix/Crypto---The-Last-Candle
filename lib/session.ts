import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "./types";

/**
 * Reads the httpOnly session cookie written by `/api/auth/telegram`.
 *
 * Expected format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256(SESSION_SECRET, payloadPart))>`
 * Payload: `{ id, first_name, username?, photo_url?, exp }` (exp = unix seconds).
 *
 * If the existing backend stores sessions differently, this function is the single
 * integration point to adapt — nothing else on the page touches the cookie.
 */
const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "tlc_session";

interface SessionPayload {
  id: number;
  first_name: string;
  username?: string;
  photo_url?: string;
  exp: number;
}

function isPayload(v: unknown): v is SessionPayload {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "number" &&
    typeof p.first_name === "string" &&
    typeof p.exp === "number" &&
    (p.username === undefined || typeof p.username === "string") &&
    (p.photo_url === undefined || typeof p.photo_url === "string")
  );
}

export async function getSession(): Promise<SessionUser | null> {
  // Read the cookie first so the page is always rendered per request.
  const raw = (await cookies()).get(COOKIE_NAME)?.value;
  const secret = process.env.SESSION_SECRET;
  if (!raw || !secret) return null;

  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isPayload(payload) || payload.exp * 1000 <= Date.now()) return null;

  return {
    id: payload.id,
    firstName: payload.first_name,
    username: payload.username ?? null,
    photoUrl: payload.photo_url?.startsWith("https://") ? payload.photo_url : null,
  };
}
