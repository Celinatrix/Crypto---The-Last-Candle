"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { fmtCompact, fmtDay } from "@/frontend/lib/format";

/**
 * Hand-drawn SVG charts for the admin page. One scale per chart, a recessive grid, thin marks, a
 * legend for two or more series, a tooltip on hover and keyboard, and a table view under each figure.
 */

const HEIGHT = 280;
const M = { top: 26, right: 14, bottom: 30, left: 54 };
const MAX_BAR = 24;

export interface Series {
  name: string;
  /** A CSS color, normally var(--viz-1) */
  color: string;
  values: number[];
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** A round axis top and the step between its ticks. */
function niceScale(max: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 1 };
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
  return { top: Math.ceil(max / step) * step, step };
}

function ticksOf(top: number, step: number): number[] {
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

const tick = (v: number) => (v < 10_000 ? v.toLocaleString("en-US") : fmtCompact(v));

/** A column with a 4px rounded data end and a square foot. */
function columnPath(x: number, w: number, top: number, bottom: number, rounded: boolean): string {
  const r = rounded ? Math.min(4, w / 2, bottom - top) : 0;
  return `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="viz__legend">
      {series.map((s) => (
        <li key={s.name}>
          <i style={{ background: s.color }} aria-hidden="true" />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

interface PlotProps {
  days: string[];
  series: Series[];
  yTitle: string;
  summary: string;
  format: (v: number) => string;
  /** Tooltip total line; omitted with one series. */
  totalLabel?: string;
  selected?: string;
  onSelect?: (day: string) => void;
  kind: "columns" | "line";
}

function Plot({ days, series, yTitle, summary, format, totalLabel, selected, onSelect, kind }: PlotProps) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const n = days.length;
  const innerW = width - M.left - M.right;
  const innerH = HEIGHT - M.top - M.bottom;
  const totals = days.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const { top, step } = niceScale(Math.max(0, ...totals));
  const y = (v: number) => M.top + innerH - (v / top) * innerH;
  const slot = innerW / Math.max(1, n);
  const barW = Math.min(MAX_BAR, Math.max(2, slot * 0.68));
  const cx = (i: number) => M.left + slot * (i + 0.5);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 58))));

  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor((e.clientX - rect.left - M.left) / slot)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const current = active ?? n - 1;
    if (e.key === "Enter" && active !== null) onSelect?.(days[active] as string);
    const next = e.key === "ArrowLeft" ? current - 1 : e.key === "ArrowRight" ? current + 1 : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, next)));
  };
  const linePoints = kind === "line" ? (series[0]?.values ?? []).map((v, i) => `${cx(i)},${y(v)}`) : [];

  return (
    <div className="viz__plot" ref={ref}>
      <svg
        className={`viz__svg${onSelect ? " is-selectable" : ""}`}
        width={width}
        height={HEIGHT}
        role="img"
        tabIndex={0}
        aria-label={summary}
        onPointerMove={(e) => setActive(indexAt(e))}
        onPointerDown={(e) => setActive(indexAt(e))}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
        onClick={(e) => onSelect?.(days[indexAt(e as unknown as PointerEvent<SVGSVGElement>)] as string)}
      >
        <text className="viz__axis-title" x={0} y={12}>{yTitle}</text>
        {ticksOf(top, step).map((v) => (
          <g key={v}>
            <line className={v === 0 ? "viz__baseline" : "viz__grid"} x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} />
            <text className="viz__tick" x={M.left - 8} y={y(v) + 4} textAnchor="end">{tick(v)}</text>
          </g>
        ))}
        {days.map((d, i) =>
          (n - 1 - i) % labelEvery === 0 ? (
            <text key={d} className="viz__tick" x={cx(i)} y={HEIGHT - 10} textAnchor="middle">{fmtDay(d)}</text>
          ) : null,
        )}
        {selected && days.includes(selected) && (
          <rect className="viz__selected" x={M.left + slot * days.indexOf(selected)} y={M.top} width={slot} height={innerH} />
        )}
        {active !== null && kind === "columns" && (
          <rect className="viz__hover" x={M.left + slot * active} y={M.top} width={slot} height={innerH} />
        )}
        {kind === "columns" &&
          days.map((d, i) => {
            let base = M.top + innerH;
            const parts = series.map((s) => ({ color: s.color, v: s.values[i] ?? 0 })).filter((p) => p.v > 0);
            return (
              <g key={d}>
                {parts.map((p, j) => {
                  const h = Math.max(1.5, (p.v / top) * innerH);
                  const segTop = base - h;
                  const el = (
                    <path
                      key={j}
                      d={columnPath(cx(i) - barW / 2, barW, segTop, base, j === parts.length - 1)}
                      style={{ fill: p.color }}
                    />
                  );
                  base = segTop - 2; // the surface gap between stacked segments
                  return el;
                })}
              </g>
            );
          })}
        {kind === "line" && series[0] && (
          <>
            <path
              style={{ fill: series[0].color }}
              className="viz__area"
              d={`M${cx(0)},${y(0)}L${linePoints.join("L")}L${cx(n - 1)},${y(0)}Z`}
            />
            <polyline className="viz__line" style={{ stroke: series[0].color }} points={linePoints.join(" ")} />
            <circle className="viz__dot" style={{ fill: series[0].color }} cx={cx(n - 1)} cy={y(series[0].values[n - 1] ?? 0)} r={4} />
            {active !== null && (
              <>
                <line className="viz__crosshair" x1={cx(active)} x2={cx(active)} y1={M.top} y2={M.top + innerH} />
                <circle className="viz__dot" style={{ fill: series[0].color }} cx={cx(active)} cy={y(series[0].values[active] ?? 0)} r={5} />
              </>
            )}
          </>
        )}
      </svg>

      {active !== null && (
        <div
          className="viz__tip"
          style={{ left: Math.min(width - 190, Math.max(0, cx(active) - 90)), top: 18 }}
          aria-live="polite"
        >
          <p className="viz__tip-day num">{fmtDay(days[active] as string)}</p>
          {series.map((s) => (
            <p key={s.name} className="viz__tip-row">
              {series.length > 1 && <i style={{ background: s.color }} aria-hidden="true" />}
              <span>{s.name}</span>
              <b className="num">{format(s.values[active] ?? 0)}</b>
            </p>
          ))}
          {totalLabel && series.length > 1 && (
            <p className="viz__tip-row is-total">
              <span>{totalLabel}</span>
              <b className="num">{format(totals[active] ?? 0)}</b>
            </p>
          )}
          {onSelect && <p className="viz__tip-hint">Bấm để xem chi tiết ngày này</p>}
        </div>
      )}
    </div>
  );
}

export const ColumnsChart = (p: Omit<PlotProps, "kind">) => (
  <>
    <Legend series={p.series} />
    <Plot {...p} kind="columns" />
  </>
);

export const LineChart = (p: Omit<PlotProps, "kind">) => <Plot {...p} kind="line" />;

/** Ranked horizontal bars, with a marker at the target. */
export function RankedBars({
  rows,
  target,
  format,
  series,
}: {
  rows: { label: string; value: number; seriesIndex: number }[];
  target: number;
  format: (v: number) => string;
  series: { name: string; color: string }[];
}) {
  const { top } = niceScale(Math.max(target, ...rows.map((r) => r.value)));
  return (
    <>
      <Legend series={series.map((s) => ({ ...s, values: [] }))} />
      <ul className="viz__ranked">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="viz__ranked-label num">{r.label}</span>
            <span className="viz__ranked-track">
              <i
                className="viz__ranked-bar"
                style={{ width: `${(r.value / top) * 100}%`, background: series[r.seriesIndex]?.color }}
              />
              <i className="viz__ranked-target" style={{ left: `${(target / top) * 100}%` }} aria-hidden="true" />
            </span>
            <span className="viz__ranked-value num">{format(r.value)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A numbered figure: title, chart, caption with method and source, and the numbers as a table. */
export function Figure({
  n,
  title,
  caption,
  table,
  children,
}: {
  n: number;
  title: string;
  caption: ReactNode;
  table?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="viz">
      <h3 className="viz__title">{title}</h3>
      {children}
      <figcaption className="viz__caption">
        <strong>Hình {n}.</strong> {caption}
      </figcaption>
      {table && (
        <details className="viz__table">
          <summary>Xem bảng số liệu</summary>
          {table}
        </details>
      )}
    </figure>
  );
}
