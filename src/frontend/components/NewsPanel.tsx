"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import EconomicCalendar from "./EconomicCalendar";
import NewsFeed from "./NewsFeed";

type TabKey = "calendar" | "community";

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "calendar", label: "Lịch đỏ" },
  { key: "community", label: "Tin cộng đồng" },
];

/** Sidebar with two tabs: ForexFactory red-folder calendar (default) and Telegram posts. */
export default function NewsPanel() {
  const [tab, setTab] = useState<TabKey>("calendar");
  const [channel, setChannel] = useState<string | null>(null);
  const ids = useId();
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ calendar: null, community: null });

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === tab);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    setTab(next.key);
    tabRefs.current[next.key]?.focus();
  }

  const link =
    tab === "calendar"
      ? { href: "https://www.forexfactory.com/calendar", text: "ForexFactory ↗" }
      : channel
        ? { href: `https://t.me/${channel}`, text: `@${channel} ↗` }
        : null;

  return (
    <section className="news" aria-label="Tin tức">
      <header className="news__head">
        <span className="live-dot" aria-hidden="true" />
        <div className="tabs" role="tablist" aria-label="Nguồn tin" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`${ids}-${t.key}-tab`}
              aria-selected={tab === t.key}
              aria-controls={`${ids}-${t.key}-panel`}
              tabIndex={tab === t.key ? 0 : -1}
              className={`tabs__tab${tab === t.key ? " is-on" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {link && (
          <a className="news__channel" href={link.href} target="_blank" rel="noopener noreferrer">
            {link.text}
          </a>
        )}
      </header>

      {/* Both panels stay mounted so each keeps its data and refresh timer. */}
      <div
        id={`${ids}-calendar-panel`}
        role="tabpanel"
        aria-labelledby={`${ids}-calendar-tab`}
        className="news__list"
        hidden={tab !== "calendar"}
      >
        <EconomicCalendar />
      </div>
      <div
        id={`${ids}-community-panel`}
        role="tabpanel"
        aria-labelledby={`${ids}-community-tab`}
        className="news__list"
        hidden={tab !== "community"}
        aria-live="polite"
      >
        <NewsFeed onChannel={setChannel} />
      </div>
    </section>
  );
}
