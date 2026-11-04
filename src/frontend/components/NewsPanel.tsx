"use client";

import EconomicCalendar from "./EconomicCalendar";

/** Sidebar: this week's ForexFactory red-folder calendar. */
export default function NewsPanel() {
  return (
    <section className="news" aria-labelledby="news-title">
      <header className="news__head">
        <span className="live-dot" aria-hidden="true" />
        <div className="tabs">
          <h2 id="news-title" className="tabs__tab is-on">
            Lịch đỏ
          </h2>
        </div>
        <a className="news__channel" href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener noreferrer">
          ForexFactory ↗
        </a>
      </header>

      <div className="news__list">
        <EconomicCalendar />
      </div>
    </section>
  );
}
