import { NextResponse } from "next/server";
import type { CalendarEvent, CalendarResponse } from "@/lib/types";

/**
 * High-impact ("red folder") events of the current week from ForexFactory.
 *
 * forexfactory.com has no public API and blocks automated requests, so this uses the
 * weekly JSON export ForexFactory publishes on nfs.faireconomy.media. The feed only
 * covers the current week, has forecast/previous but no actual values, sends no CORS
 * headers, and rate-limits frequent callers — hence this server-side proxy with a
 * 15-minute cache.
 */
const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const REVALIDATE_SECONDS = 900;

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

export async function GET() {
  try {
    const res = await fetch(FEED_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) throw new Error("Unexpected feed format");

    const events: CalendarEvent[] = raw
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

    const body: CalendarResponse = { source: "ForexFactory", events, fetchedAt: new Date().toISOString() };
    return NextResponse.json(body, {
      headers: { "Cache-Control": `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=600` },
    });
  } catch (err) {
    const body: CalendarResponse = {
      source: "ForexFactory",
      events: [],
      fetchedAt: new Date().toISOString(),
      error: `Không tải được lịch kinh tế (${err instanceof Error ? err.message : "lỗi không xác định"}).`,
    };
    return NextResponse.json(body, { status: 502 });
  }
}
