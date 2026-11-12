"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Legend, useWidth } from "@/frontend/components/AdminCharts";
import { fmtDate, fmtDateTimeShort, fmtPct, fmtPrice, fmtR } from "@/frontend/lib/format";
import type { CandlePoint, GroupStats, Signal, SignalStats } from "@/shared/signals";

/**
 * Hand-drawn SVG charts for the signal statistics, in the same language as AdminCharts: one y-axis,
 * recessive grid, 2px lines, 4px rounded bar ends, tooltip on hover and keyboard. Colours come from
 * the validated --viz-* tokens: blue = winning side, orange = losing side.
 */

const WIN = "var(--viz-1)";
const LOSS = "var(--viz-2)";
const UP = "var(--viz-3)";

/** A round signed axis that always includes 0. */
function signedScale(min: number, max: number): { lo: number; hi: number; step: number } {
  const lo0 = Math.min(0, min);
  const hi0 = Math.max(0, max);
  const span = hi0 - lo0 || 1;
  const rough = span / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
  return { lo: Math.floor(lo0 / step) * step, hi: Math.ceil(hi0 / step) * step || step, step };
}

function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

const fmtTick = (v: number) => `${Number(v.toFixed(2))}R`;

function useKeyboardIndex(n: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const current = active ?? n - 1;
    const next = e.key === "ArrowLeft" ? current - 1 : e.key === "ArrowRight" ? current + 1 : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(n - 1, Math.max(0, next)));
  };
  return { active, setActive, onKey };
}

// ---------------------------------------------------------------------------------------------------
// Equity curve

const EQ_H = 260;
const EQ_M = { top: 24, right: 16, bottom: 30, left: 52 };

export function EquityChart({ equity }: { equity: SignalStats["equity"] }) {
  const { ref, width } = useWidth();
  const points = [{ id: 0, symbol: "", at: "", r: 0, cum: 0 }, ...equity];
  const n = points.length;
  const { active, setActive, onKey } = useKeyboardIndex(n);
  const innerW = width - EQ_M.left - EQ_M.right;
  const innerH = EQ_H - EQ_M.top - EQ_M.bottom;
  const { lo, hi, step } = signedScale(Math.min(...points.map((p) => p.cum)), Math.max(...points.map((p) => p.cum)));
  const x = (i: number) => EQ_M.left + (innerW * i) / Math.max(1, n - 1);
  const y = (v: number) => EQ_M.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  const last = points[n - 1]!;
  const labelEvery = Math.max(1, Math.ceil((n - 1) / Math.max(2, Math.floor(innerW / 90))));
  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.round(((e.clientX - rect.left - EQ_M.left) / innerW) * (n - 1))));
  };
  const p = active !== null ? points[active] : null;

  return (
    <div className="viz__plot" ref={ref}>
      <svg
        className="viz__svg"
        width={width}
        height={EQ_H}
        role="img"
        tabIndex={0}
        aria-label={`Đường vốn theo R qua ${n - 1} lệnh đã đóng, hiện tại ${fmtR(last.cum)}.`}
        onPointerMove={(e) => setActive(indexAt(e))}
        onPointerDown={(e) => setActive(indexAt(e))}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        <text className="viz__axis-title" x={0} y={12}>R cộng dồn</text>
        {ticks(lo, hi, step).map((v) => (
          <g key={v}>
            <line className={v === 0 ? "viz__baseline" : "viz__grid"} x1={EQ_M.left} x2={width - EQ_M.right} y1={y(v)} y2={y(v)} />
            <text className="viz__tick" x={EQ_M.left - 8} y={y(v) + 4} textAnchor="end">{fmtTick(v)}</text>
          </g>
        ))}
        {points.map((pt, i) =>
          i > 0 && (n - 1 - i) % labelEvery === 0 ? (
            <text key={pt.id} className="viz__tick" x={x(i)} y={EQ_H - 10} textAnchor="middle">
              {fmtDate(Date.parse(pt.at)).slice(0, 5)}
            </text>
          ) : null,
        )}
        <polyline className="viz__line" style={{ stroke: WIN }} points={points.map((pt, i) => `${x(i)},${y(pt.cum)}`).join(" ")} />
        <circle className="viz__dot" style={{ fill: WIN }} cx={x(n - 1)} cy={y(last.cum)} r={4} />
        <text className="viz__tick sig__direct" x={Math.min(x(n - 1), width - EQ_M.right)} y={y(last.cum) - 10} textAnchor="end">
          {fmtR(last.cum)}
        </text>
        {p && (
          <>
            <line className="viz__crosshair" x1={x(active!)} x2={x(active!)} y1={EQ_M.top} y2={EQ_M.top + innerH} />
            <circle className="viz__dot" style={{ fill: WIN }} cx={x(active!)} cy={y(p.cum)} r={5} />
          </>
        )}
      </svg>
      {p && (
        <div className="viz__tip" style={{ left: Math.min(width - 190, Math.max(0, x(active!) - 95)), top: 18 }} aria-live="polite">
          {active === 0 ? (
            <p className="viz__tip-day">Điểm bắt đầu: 0R</p>
          ) : (
            <>
              <p className="viz__tip-day num">
                #{p.id} {p.symbol} · {fmtDateTimeShort(Date.parse(p.at))}
              </p>
              <p className="viz__tip-row">
                <span>Lệnh này</span>
                <b className="num">{fmtR(p.r)}</b>
              </p>
              <p className="viz__tip-row">
                <span>Cộng dồn</span>
                <b className="num">{fmtR(p.cum)}</b>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// R distribution

const H_H = 240;
const H_M = { top: 24, right: 12, bottom: 30, left: 40 };

export function RHistogram({ bins }: { bins: SignalStats["histogram"] }) {
  const { ref, width } = useWidth();
  const n = bins.length;
  const { active, setActive, onKey } = useKeyboardIndex(n);
  const innerW = width - H_M.left - H_M.right;
  const innerH = H_H - H_M.top - H_M.bottom;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const step = maxCount <= 5 ? 1 : maxCount <= 10 ? 2 : Math.ceil(maxCount / 5);
  const top = Math.ceil(maxCount / step) * step;
  const slot = innerW / Math.max(1, n);
  const barW = Math.max(2, Math.min(32, slot - 2));
  const y = (v: number) => H_M.top + innerH - (v / top) * innerH;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 44))));
  const colorOf = (b: { to: number }) => (b.to <= 0 ? LOSS : WIN);
  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor((e.clientX - rect.left - H_M.left) / slot)));
  };
  const b = active !== null ? bins[active] : null;

  return (
    <>
      <Legend
        series={[
          { name: "Lệnh thua (R < 0)", color: LOSS, values: [] },
          { name: "Lệnh thắng hoặc hoà (R ≥ 0)", color: WIN, values: [] },
        ]}
      />
      <div className="viz__plot" ref={ref}>
        <svg
          className="viz__svg"
          width={width}
          height={H_H}
          role="img"
          tabIndex={0}
          aria-label={`Phân bố R của ${bins.reduce((s, x) => s + x.count, 0)} lệnh đã đóng, mỗi cột rộng 0,5R.`}
          onPointerMove={(e) => setActive(indexAt(e))}
          onPointerDown={(e) => setActive(indexAt(e))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          <text className="viz__axis-title" x={0} y={12}>Số lệnh</text>
          {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((v) => (
            <g key={v}>
              <line className={v === 0 ? "viz__baseline" : "viz__grid"} x1={H_M.left} x2={width - H_M.right} y1={y(v)} y2={y(v)} />
              <text className="viz__tick" x={H_M.left - 8} y={y(v) + 4} textAnchor="end">{v}</text>
            </g>
          ))}
          {active !== null && <rect className="viz__hover" x={H_M.left + slot * active} y={H_M.top} width={slot} height={innerH} />}
          {bins.map((bin, i) => {
            if (!bin.count) return null;
            const x0 = H_M.left + slot * i + (slot - barW) / 2;
            const t = y(bin.count);
            const base = y(0);
            const r = Math.min(4, barW / 2, base - t);
            return (
              <path
                key={bin.from}
                style={{ fill: colorOf(bin) }}
                d={`M${x0},${base}V${t + r}Q${x0},${t} ${x0 + r},${t}H${x0 + barW - r}Q${x0 + barW},${t} ${x0 + barW},${t + r}V${base}Z`}
              />
            );
          })}
          {bins.map((bin, i) =>
            i % labelEvery === 0 ? (
              <text key={bin.from} className="viz__tick" x={H_M.left + slot * i} y={H_H - 10} textAnchor="middle">
                {Number(bin.from.toFixed(1))}
              </text>
            ) : null,
          )}
        </svg>
        {b && (
          <div className="viz__tip" style={{ left: Math.min(width - 190, Math.max(0, H_M.left + slot * (active! + 0.5) - 95)), top: 18 }} aria-live="polite">
            <p className="viz__tip-day num">
              Từ {fmtR(b.from, 1)} đến {fmtR(b.to, 1)}
            </p>
            <p className="viz__tip-row">
              <i style={{ background: colorOf(b) }} aria-hidden="true" />
              <span>Số lệnh</span>
              <b className="num">{b.count}</b>
            </p>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------
// Winrate by group

export function WinrateBars({ rows, labelOf }: { rows: GroupStats[]; labelOf?: (key: string) => string }) {
  return (
    <ul className="sig-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="sig-bars__label">{labelOf ? labelOf(r.key) : r.key}</span>
          <span className="sig-bars__track" title={`Thắng ${r.wins} · Thua ${r.losses}`}>
            <i className="sig-bars__bar" style={{ width: `${(r.winrate ?? 0) * 100}%`, background: WIN }} />
            <i className="sig-bars__mark" aria-hidden="true" />
          </span>
          <span className="sig-bars__value num">
            {r.winrate === null ? "—" : fmtPct(r.winrate, 0)}
            <small>
              {r.wins}/{r.wins + r.losses} · {fmtR(r.totalR, 1)}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------------
// Candles of one signal

const C_H = 340;
const C_M = { top: 16, right: 92, bottom: 30, left: 12 };

const EVENT_LABEL: Record<string, string> = {
  created: "Đăng tín hiệu",
  filled: "Khớp lệnh",
  tp: "Chạm TP",
  sl: "Chạm SL",
  sl_moved: "Dời SL",
  manual_close: "Đóng tay",
  cancelled: "Huỷ lệnh",
};

export function CandleChart({ signal, candles, interval }: { signal: Signal; candles: CandlePoint[]; interval: string }) {
  const { ref, width } = useWidth();
  const n = candles.length;
  const { active, setActive, onKey } = useKeyboardIndex(n);
  if (!n) return <p className="admin__empty">BingX không trả về nến cho khoảng thời gian này.</p>;

  const levels = [
    { key: "entry", label: signal.entry2 === null ? "Entry" : "ET1", price: signal.entry, color: "rgba(255,255,255,0.75)", dash: "6 4" },
    ...(signal.entry2 !== null ? [{ key: "entry2", label: "ET2", price: signal.entry2, color: "rgba(255,255,255,0.75)", dash: "2 3" }] : []),
    { key: "sl", label: "SL", price: signal.sl, color: LOSS, dash: "6 4" },
    ...(signal.currentSl !== signal.sl ? [{ key: "sl2", label: "SL mới", price: signal.currentSl, color: LOSS, dash: "2 3" }] : []),
    ...signal.tps.map((tp, i) => ({ key: `tp${i}`, label: `TP${i + 1}`, price: tp, color: WIN, dash: "6 4" })),
  ];
  const lows = [...candles.map((c) => c.low), ...levels.map((l) => l.price)];
  const highs = [...candles.map((c) => c.high), ...levels.map((l) => l.price)];
  const pad = (Math.max(...highs) - Math.min(...lows)) * 0.06;
  const lo = Math.min(...lows) - pad;
  const hi = Math.max(...highs) + pad;
  const innerW = width - C_M.left - C_M.right;
  const innerH = C_H - C_M.top - C_M.bottom;
  const slot = innerW / n;
  const bodyW = Math.max(1, Math.min(10, slot * 0.62));
  const cx = (i: number) => C_M.left + slot * (i + 0.5);
  const y = (v: number) => C_M.top + ((hi - v) / (hi - lo)) * innerH;
  const indexOfTime = (t: number) => {
    let idx = -1;
    for (let i = 0; i < n; i++) if (candles[i]!.time <= t) idx = i;
    return idx;
  };
  const events = signal.events
    .filter((e) => e.price !== null && e.kind !== "created")
    .map((e) => ({ ...e, idx: indexOfTime(Date.parse(e.at)) }))
    .filter((e) => e.idx >= 0);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 96))));
  const indexAt = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor((e.clientX - rect.left - C_M.left) / slot)));
  };
  const c = active !== null ? candles[active] : null;

  // Keep the right-hand level labels from overlapping: push each at least 13px from the previous one.
  const placed = [...levels].sort((a, b) => y(a.price) - y(b.price));
  let lastY = -Infinity;
  const labelY = new Map<string, number>();
  for (const l of placed) {
    const ly = Math.max(y(l.price), lastY + 13);
    labelY.set(l.key, ly);
    lastY = ly;
  }

  return (
    <>
      <Legend
        series={[
          { name: "Nến tăng", color: UP, values: [] },
          { name: "Nến giảm", color: LOSS, values: [] },
          { name: "TP", color: WIN, values: [] },
        ]}
      />
      <div className="viz__plot" ref={ref}>
        <svg
          className="viz__svg"
          width={width}
          height={C_H}
          role="img"
          tabIndex={0}
          aria-label={`Biểu đồ nến ${interval} của ${signal.symbol} quanh tín hiệu #${signal.id}, kèm các mức Entry, SL và TP.`}
          onPointerMove={(e) => setActive(indexAt(e))}
          onPointerDown={(e) => setActive(indexAt(e))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {candles.map((k, i) =>
            (n - 1 - i) % labelEvery === 0 && cx(i) > 44 ? (
              <text key={k.time} className="viz__tick" x={cx(i)} y={C_H - 10} textAnchor="middle">
                {fmtDateTimeShort(k.time)}
              </text>
            ) : null,
          )}
          <line className="viz__baseline" x1={C_M.left} x2={width - C_M.right} y1={C_M.top + innerH} y2={C_M.top + innerH} />
          {active !== null && <rect className="viz__hover" x={C_M.left + slot * active} y={C_M.top} width={slot} height={innerH} />}
          {candles.map((k, i) => {
            const color = k.close >= k.open ? UP : LOSS;
            const top = y(Math.max(k.open, k.close));
            const h = Math.max(1, Math.abs(y(k.open) - y(k.close)));
            return (
              <g key={k.time} style={{ stroke: color, fill: color }}>
                <line x1={cx(i)} x2={cx(i)} y1={y(k.high)} y2={y(k.low)} strokeWidth={1} />
                <rect x={cx(i) - bodyW / 2} y={top} width={bodyW} height={h} stroke="none" />
              </g>
            );
          })}
          {levels.map((l) => (
            <g key={l.key}>
              <line x1={C_M.left} x2={width - C_M.right + 4} y1={y(l.price)} y2={y(l.price)} style={{ stroke: l.color }} strokeDasharray={l.dash} strokeWidth={1.25} />
              <text className="viz__tick sig__level" x={width - C_M.right + 8} y={(labelY.get(l.key) ?? y(l.price)) + 4}>
                {l.label} {fmtPrice(l.price)}
              </text>
            </g>
          ))}
          {events.map((e, i) => (
            <circle
              key={`${e.kind}-${i}`}
              className="viz__dot"
              cx={cx(e.idx)}
              cy={y(e.price!)}
              r={5}
              style={{ fill: e.kind === "tp" ? WIN : e.kind === "sl" ? LOSS : "#fff" }}
            />
          ))}
        </svg>
        {c && (
          <div className="viz__tip" style={{ left: Math.min(width - 190, Math.max(0, cx(active!) - 95)), top: 12 }} aria-live="polite">
            <p className="viz__tip-day num">{fmtDateTimeShort(c.time)}</p>
            {(
              [
                ["Mở", c.open],
                ["Cao", c.high],
                ["Thấp", c.low],
                ["Đóng", c.close],
              ] as const
            ).map(([k, v]) => (
              <p key={k} className="viz__tip-row">
                <span>{k}</span>
                <b className="num">{fmtPrice(v)}</b>
              </p>
            ))}
            {events
              .filter((e) => e.idx === active)
              .map((e, i) => (
                <p key={i} className="viz__tip-row is-total">
                  <span>{EVENT_LABEL[e.kind]}</span>
                  <b className="num">{e.r !== null ? fmtR(e.r) : fmtPrice(e.price!)}</b>
                </p>
              ))}
          </div>
        )}
      </div>
    </>
  );
}

export { EVENT_LABEL };
