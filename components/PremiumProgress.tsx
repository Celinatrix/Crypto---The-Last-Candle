"use client";

import type { ReactNode } from "react";
import { fmtDateTimeShort, fmtDay, fmtDayFull, fmtUSD } from "@/lib/format";
import { PREMIUM_RULE, type CycleProgress } from "@/lib/premium";
import type { Tone } from "@/lib/status";

interface Props {
  progress: CycleProgress;
  tone: Tone;
  now: number;
}

interface Tile {
  title: string;
  value: ReactNode;
  urgent?: boolean;
  ok?: boolean;
}

/** "2 ngày 07 giờ", "5 giờ 12 phút", "8 phút" */
function countdown(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} ngày ${String(h).padStart(2, "0")} giờ`;
  return h > 0 ? `${h} giờ ${m} phút` : `${m} phút`;
}

function Warn() {
  return (
    <span className="progress__warn" aria-label="Cảnh báo">
      {" "}
      ⚠
    </span>
  );
}

function Pace({ value }: { value: number }) {
  return (
    <>
      ~{fmtUSD(value)}
      <wbr />
      <span className="progress__unit">/ngày</span>
    </>
  );
}

function badgeFor(p: CycleProgress): string {
  switch (p.phase) {
    case "rest":
      return "Đang nghỉ";
    case "grace":
      return "Gia hạn 24 giờ";
    case "failed":
      return "Không đạt";
    default:
      return `Ngày ${p.dayOfCycle}/${PREMIUM_RULE.cycleDays}`;
  }
}

function tilesFor(p: CycleProgress, now: number): Tile[] {
  const required: Tile = { title: "Yêu cầu", value: fmtUSD(p.required) };
  switch (p.phase) {
    case "rest":
      return [
        required,
        { title: "Đạt ngày", value: p.metDay ? fmtDay(p.metDay) : "—", ok: true },
        { title: "Tính lại từ", value: p.nextStartDay ? fmtDay(p.nextStartDay) : "—" },
        { title: "Còn nghỉ", value: p.resumesAt ? countdown(p.resumesAt - now) : "—", ok: true },
      ];
    case "grace":
      return [
        required,
        { title: "Còn lại", value: <>{countdown(p.graceDeadline - now)}<Warn /></>, urgent: true },
        { title: "Cần thêm", value: fmtUSD(p.remaining) },
        { title: "Hạn chót", value: fmtDateTimeShort(p.graceDeadline) },
      ];
    case "failed":
      return [
        required,
        { title: "Kết quả", value: "Không đạt", urgent: true },
        { title: "Còn thiếu", value: fmtUSD(p.remaining) },
        { title: "Hết hạn", value: fmtDateTimeShort(p.graceDeadline) },
      ];
    default:
      return [
        required,
        {
          title: "Còn lại",
          value: p.phase === "warning" ? <>{p.daysLeft} ngày<Warn /></> : `${p.daysLeft} ngày`,
          urgent: p.phase === "warning",
        },
        { title: "Cần thêm", value: fmtUSD(p.remaining) },
        { title: "Mỗi ngày cần", value: <Pace value={p.perDay} /> },
      ];
  }
}

export default function PremiumProgress({ progress: p, tone, now }: Props) {
  const tiles = tilesFor(p, now);
  const barWidth = Math.min(100, Math.max(p.percent, p.volume > 0 ? 2 : 0));

  return (
    <section className={`progress progress--${tone}`} aria-label="Tiến độ Signal Groups Premium">
      <div className="progress__top">
        <div className="progress__heading">
          <span className="label">Signal Groups Premium · Chu kỳ #{p.index}</span>
          <span className="progress__period num">
            {fmtDayFull(p.startDay)} – {fmtDayFull(p.endDay)}
          </span>
        </div>
        <span className="progress__day num">{badgeFor(p)}</span>
      </div>

      <div className="progress__amounts">
        <span className="progress__volume num">{fmtUSD(p.volume)}</span>
        <span className="progress__target num">/ {fmtUSD(p.required)}</span>
        <span className="progress__pct num">{p.percent}%</span>
      </div>

      <div
        className="bar"
        role="progressbar"
        aria-label="Hoàn thành yêu cầu khối lượng"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, p.percent)}
        aria-valuetext={`${p.percent}% — ${fmtUSD(p.volume)} trên ${fmtUSD(p.required)}`}
      >
        <span className="bar__fill" style={{ width: `${barWidth}%` }} />
      </div>

      <dl className="progress__grid">
        {tiles.map((t) => (
          <div key={t.title} className={`progress__item${t.urgent ? " is-urgent" : ""}`}>
            <dt>{t.title}</dt>
            <dd className={`num${t.ok ? " is-ok" : ""}`}>{t.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
