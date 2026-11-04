import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; manual calls must send the same. */
export function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
