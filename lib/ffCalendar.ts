import type { CalendarEvent } from "./types";

/**
 * High-impact ("red folder") events of the current week from ForexFactory. Server-only.
 *
 * forexfactory.com has no public API and blocks automated requests, so this reads the
 * weekly JSON export ForexFactory publishes on nfs.faireconomy.media. The feed only
 * covers the current week, has forecast/previous but no actual values, sends no CORS
 * headers and rate-limits frequent callers — so it is fetched server-side and cached.
 */
const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
export const CALENDAR_REVALIDATE_SECONDS = 900;

interface FeedItem {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast?: string;
  previous?: string;
}

function isFeedItem(v: unknown): v is FeedItem {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.title === "string" &&
    typeof r.country === "string" &&
    typeof r.date === "string" &&
    typeof r.impact === "string"
  );
}

/** Sorted by time. Throws when the feed is unreachable or malformed. */
export async function fetchRedEvents(): Promise<CalendarEvent[]> {
  const res = await fetch(FEED_URL, {
    next: { revalidate: CALENDAR_REVALIDATE_SECONDS },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) throw new Error("Unexpected feed format");

  return raw
    .filter(isFeedItem)
    .filter((e) => e.impact === "High" && Number.isFinite(Date.parse(e.date)))
    .map((e) => ({
      id: `${e.date}|${e.country}|${e.title}`,
      title: e.title,
      currency: e.country,
      time: new Date(e.date).toISOString(),
      forecast: e.forecast?.trim() || null,
      previous: e.previous?.trim() || null,
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
