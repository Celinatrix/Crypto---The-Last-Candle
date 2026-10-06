import { NextResponse } from "next/server";
import { CALENDAR_REVALIDATE_SECONDS, fetchRedEvents } from "@/lib/ffCalendar";
import type { CalendarResponse } from "@/lib/types";

/** This week's ForexFactory red-folder events for the "Lịch đỏ" tab (see lib/ffCalendar.ts). */
export async function GET() {
  try {
    const body: CalendarResponse = {
      source: "ForexFactory",
      events: await fetchRedEvents(),
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": `public, s-maxage=${CALENDAR_REVALIDATE_SECONDS}, stale-while-revalidate=600` },
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
