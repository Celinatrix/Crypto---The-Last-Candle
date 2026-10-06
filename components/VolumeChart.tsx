"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmtCompact, fmtDay, fmtUSDT } from "@/lib/format";
import type { DailyVolume } from "@/lib/types";

const VIEW_W = 300;
const VIEW_H = 100;
const MIN_BAR = 1.6; // zero-volume stub height, in viewBox units

interface Props {
  daily: DailyVolume[];
  /** "YYYY-MM-DD": highlight days from here to the newest bar (the cycle under review). */
  bandFrom?: string;
  bandLabel?: string;
}

export default function VolumeChart({ daily, bandFrom, bandLabel = "Chu kỳ hiện tại" }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const descId = useId();
  const n = daily.length;
  if (n === 0) return null;

  const firstInBand = bandFrom ? daily.findIndex((d) => d.day >= bandFrom) : -1;
  const bandStart = firstInBand === -1 ? n : firstInBand;
  const bandN = n - bandStart;
  const max = Math.max(0, ...daily.map((d) => d.volume));
  const slot = VIEW_W / n;
  const barW = slot * 0.64;
  const zeroDays = daily.slice(bandStart).filter((d) => d.volume <= 0).length;
  const activeDay = active !== null ? daily[active] : undefined;

  function indexFromPointer(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    return Math.min(n - 1, Math.max(0, i));
  }

  function handleKey(e: KeyboardEvent<SVGSVGElement>) {
    const current = active ?? n - 1;
    const next =
      e.key === "ArrowLeft" ? current - 1 : e.key === "ArrowRight" ? current + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, next)));
  }

  const first = daily[0];
  const bandFirst = daily[bandStart];
  const last = daily[n - 1];

  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <span className="label">Khối lượng theo ngày</span>
        <span className="chart__legend">
          {bandN > 0 && (
            <>
              <span className="chart__swatch chart__swatch--band" aria-hidden="true" />
              {bandLabel}
            </>
          )}
          {zeroDays > 0 && (
            <>
              <span className="chart__swatch chart__swatch--zero" aria-hidden="true" />
              Ngày không giao dịch
            </>
          )}
        </span>
      </figcaption>

      <div className="chart__plot">
        <span className="chart__max num" aria-hidden="true">
          {max > 0 ? fmtCompact(max) : "0"}
        </span>
        <svg
          className="chart__svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          role="img"
          tabIndex={0}
          aria-label={`Biểu đồ khối lượng ${n} ngày. Dùng phím mũi tên để xem từng ngày.`}
          aria-describedby={descId}
          onPointerMove={(e) => setActive(indexFromPointer(e))}
          onPointerDown={(e) => setActive(indexFromPointer(e))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={handleKey}
        >
          <rect className="chart__band" x={bandStart * slot} y={0} width={bandN * slot} height={VIEW_H} />
          <line className="chart__band-edge" x1={bandStart * slot} x2={bandStart * slot} y1={0} y2={VIEW_H} vectorEffect="non-scaling-stroke" />
          <line className="chart__baseline" x1={0} x2={VIEW_W} y1={VIEW_H} y2={VIEW_H} vectorEffect="non-scaling-stroke" />
          {daily.map((d, i) => {
            const h = d.volume > 0 && max > 0 ? Math.max(MIN_BAR, (d.volume / max) * (VIEW_H - 4)) : MIN_BAR;
            const inBand = i >= bandStart;
            const cls = [
              "chart__bar",
              inBand ? "chart__bar--band" : "",
              inBand && d.volume <= 0 ? "chart__bar--zero" : "",
              active === i ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return <rect key={d.day} className={cls} x={i * slot + (slot - barW) / 2} y={VIEW_H - h} width={barW} height={h} rx={0.6} />;
          })}
        </svg>

        {activeDay && active !== null && (
          <div
            className={`chart__tip${active < 4 ? " chart__tip--start" : active > n - 5 ? " chart__tip--end" : ""}`}
            style={{ left: `${((active + 0.5) / n) * 100}%` }}
            aria-live="polite"
          >
            <span className="chart__tip-day num">{fmtDay(activeDay.day)}</span>
            <span className={`chart__tip-val num${activeDay.volume <= 0 && active >= bandStart ? " is-zero" : ""}`}>
              {fmtUSDT(activeDay.volume)}
            </span>
          </div>
        )}
      </div>

      <div className="chart__axis num" aria-hidden="true">
        <span>{first && fmtDay(first.day)}</span>
        {/* Skip the band label when it would collide with the first/last date. */}
        {bandFirst && bandStart > 3 && bandStart < n - 4 && (
          <span style={{ left: `${(bandStart / n) * 100}%` }} className="chart__axis-band">
            {fmtDay(bandFirst.day)}
          </span>
        )}
        <span>{last && fmtDay(last.day)}</span>
      </div>

      <p id={descId} className="sr-only">
        {`Từ ${first ? fmtDay(first.day) : ""} đến ${last ? fmtDay(last.day) : ""}. Cao nhất ${fmtUSDT(max)}. ${zeroDays} trên ${bandN} ngày trong chu kỳ không có giao dịch.`}
      </p>
    </figure>
  );
}
