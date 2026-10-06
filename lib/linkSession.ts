/**
 * Remembers a successful UID + Gmail link on this device for 24 hours.
 * After that the page treats the device as "not linked" and asks again.
 * localStorage is per browser/device, so each device keeps its own record.
 */

const KEY = "tlc_link_v1";
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;

export interface LinkRecord {
  uid: string;
  email: string;
  /** ms timestamp */
  expiresAt: number;
}

function isRecord(v: unknown): v is LinkRecord {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.uid === "string" && typeof r.email === "string" && typeof r.expiresAt === "number";
}

/** The saved link, or null if missing, malformed or expired (expired records are removed). */
export function readLink(now: number = Date.now()): LinkRecord | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && parsed.expiresAt > now) return parsed;
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked (private mode, disabled site data) → behave as not linked.
  }
  return null;
}

export function saveLink(uid: string, email: string, now: number = Date.now()): LinkRecord {
  const record: LinkRecord = { uid, email, expiresAt: now + LINK_TTL_MS };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Not persisted; the link still works for this page view.
  }
  return record;
}

export function clearLink(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
