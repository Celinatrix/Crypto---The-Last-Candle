"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCalendar } from "@/lib/api";
import type { CalendarEvent } from "@/lib/types";
import { useNow } from "@/lib/useNow";

const REFRESH_MS = 15 * 60_000;
/** Events within this window are highlighted as "about to be released". */
const SOON_MS = 60 * 60_000;
/** Released events stay visible this long, labelled "Vừa ra". */
const JUST_OUT_MS = 30 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayHeading(ms: number, now: number): string {
  const d = new Date(ms);
  const label = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  if (localDayKey(ms) === localDayKey(now)) return `Hôm nay · ${label}`;
  if (localDayKey(ms) === localDayKey(now + 86_400_000)) return `Ngày mai · ${label}`;
  return `${WEEKDAYS[d.getDay()] ?? ""} · ${label}`;
}

/** "còn 3 ngày 4 giờ", "còn 2 giờ 15 phút", "còn 8 phút", "Vừa ra · 5 phút trước" */
function relative(ms: number, now: number): string {
  const diff = ms - now;
  if (diff <= 0) {
    const ago = Math.max(1, Math.round(-diff / 60_000));
    return `Vừa ra · ${ago} phút trước`;
  }
  const totalMin = Math.ceil(diff / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `còn ${d} ngày ${h} giờ`;
  if (h > 0) return `còn ${h} giờ ${m} phút`;
  return `còn ${m} phút`;
}

/** "GMT+7" for the viewer's current offset */
function gmtLabel(now: number): string {
  const offsetMin = -new Date(now).getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const h = Math.floor(Math.abs(offsetMin) / 60);
  const m = Math.abs(offsetMin) % 60;
  return `GMT${sign}${h}${m ? `:${pad(m)}` : ""}`;
}

interface State {
  events: CalendarEvent[] | null;
  error: string | null;
}

export default function EconomicCalendar() {
  const [state, setState] = useState<State>({ events: null, error: null });
  const [currency, setCurrency] = useState<string>("ALL");
  const inFlight = useRef(false);
  const now = useNow(15_000);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await fetchCalendar();
      setState({ events: data.events, error: data.error ?? null });
    } catch (err) {
      setState((s) => ({ events: s.events ?? [], error: err instanceof Error ? err.message : "Không tải được lịch." }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Refresh every 15 minutes, only while the tab is visible.
  useEffect(() => {
    let timer: number | undefined;
    const stop = () => window.clearInterval(timer);
    const start = () => {
      stop();
      timer = window.setInterval(() => void load(), REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void load();
        start();
      }
    };
    void load();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const upcoming = useMemo(
    () => (state.events ?? []).filter((e) => Date.parse(e.time) > now - JUST_OUT_MS),
    [state.events, now],
  );
  const currencies = useMemo(() => [...new Set(upcoming.map((e) => e.currency))].sort(), [upcoming]);
  const visible = currency === "ALL" ? upcoming : upcoming.filter((e) => e.currency === currency);

  // Fall back to "all" if the selected currency has no events left.
  useEffect(() => {
    if (currency !== "ALL" && !currencies.includes(currency)) setCurrency("ALL");
  }, [currency, currencies]);

  const groups = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of visible) {
      const key = localDayKey(Date.parse(e.time));
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.values()];
  }, [visible]);

  if (state.events === null) return <CalendarSkeleton />;

  return (
    <div className="cal">
      {currencies.length > 1 && (
        <div className="cal__filters" role="group" aria-label="Lọc theo đồng tiền">
          {["ALL", ...currencies].map((c) => (
            <button
              key={c}
              type="button"
              className={`chip${currency === c ? " is-on" : ""}`}
              aria-pressed={currency === c}
              onClick={() => setCurrency(c)}
            >
              {c === "ALL" ? "Tất cả" : c}
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="news__empty">
          <p>{state.error ?? "Không còn tin lịch đỏ nào trong tuần này. Lịch tuần mới sẽ cập nhật vào cuối tuần."}</p>
          {state.error && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void load()}>
              Thử lại
            </button>
          )}
        </div>
      ) : (
        groups.map((events) => {
          const first = events[0];
          if (!first) return null;
          const heading = dayHeading(Date.parse(first.time), now);
          return (
            <section key={heading} className="cal__day" aria-label={heading}>
              <h4 className="cal__date">{heading}</h4>
              <ul className="cal__list">
                {events.map((e) => (
                  <EventRow key={e.id} event={e} now={now} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      {state.error && groups.length > 0 && <p className="news__stale">Đang hiển thị dữ liệu cũ · {state.error}</p>}

      <p className="cal__foot">
        Nguồn: ForexFactory · chỉ tin tác động cao · giờ theo múi giờ của bạn ({gmtLabel(now)})
      </p>
    </div>
  );
}

function EventRow({ event, now }: { event: CalendarEvent; now: number }) {
  const t = Date.parse(event.time);
  const diff = t - now;
  const out = diff <= 0;
  const soon = !out && diff <= SOON_MS;
  const d = new Date(t);

  return (
    <li className={`ev${soon ? " ev--soon" : ""}${out ? " ev--out" : ""}`}>
      <div className="ev__time">
        <time className="num" dateTime={event.time}>
          {pad(d.getHours())}:{pad(d.getMinutes())}
        </time>
        <span className="ev__cur">{event.currency}</span>
      </div>
      <div className="ev__body">
        <p className="ev__title">
          <span className="ev__folder" aria-label="Tác động cao" />
          {event.title}
        </p>
        {(event.forecast || event.previous) && (
          <p className="ev__nums num">
            {event.forecast && <span>Dự báo {event.forecast}</span>}
            {event.previous && <span>Kỳ trước {event.previous}</span>}
          </p>
        )}
        <p className={`ev__when${soon ? " is-soon" : ""}`}>{relative(t, now)}</p>
      </div>
    </li>
  );
}

function CalendarSkeleton() {
  return (
    <div className="cal" aria-busy="true" aria-label="Đang tải lịch kinh tế">
      {[0, 1, 2].map((i) => (
        <div key={i} className="ev ev--skeleton">
          <span className="skeleton" style={{ width: 44, height: 30 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <span className="skeleton" style={{ height: 12, width: "80%" }} />
            <span className="skeleton" style={{ height: 10, width: "45%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
