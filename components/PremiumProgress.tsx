"use client";

import { fmtDateTimeShort, fmtDayFull, fmtUSD } from "@/lib/format";
import { PREMIUM_RULE, type CycleProgress } from "@/lib/premium";
import type { Tone } from "@/lib/status";

interface Props {
  progress: CycleProgress;
  tone: Tone;
  now: number;
}

interface View {
  title: string;
  startDay: string;
  endDay: string;
  dayLabel: string;
  volume: number;
  percent: number;
  remaining: number;
  leftLabel: string;
  leftUrgent: boolean;
  paceTitle: string;
  paceLabel: string;
  paceUnit?: string;
}

function hoursLeft(ms: number): string {
  const totalMin = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} giờ ${m} phút` : `${m} phút`;
}

function toView(p: CycleProgress, now: number): View {
  const g = p.grace;
  if (g) {
    return {
      title: `Chu kỳ #${g.index} · gia hạn 24 giờ`,
      startDay: g.startDay,
      endDay: g.endDay,
      dayLabel: "Đã hết 14 ngày",
      volume: g.volume,
      percent: Math.floor((g.volume / p.required) * 100),
      remaining: g.remaining,
      leftLabel: hoursLeft(g.deadline - now),
      leftUrgent: true,
      paceTitle: "Hạn chót",
      paceLabel: fmtDateTimeShort(g.deadline),
    };
  }
  return {
    title: `Chu kỳ #${p.index}`,
    startDay: p.startDay,
    endDay: p.endDay,
    dayLabel: `Ngày ${p.dayOfCycle}/${PREMIUM_RULE.cycleDays}`,
    volume: p.volume,
    percent: p.percent,
    remaining: p.remaining,
    leftLabel: `${p.daysLeft} ngày`,
    leftUrgent: p.phase === "warning",
    paceTitle: "Mỗi ngày cần",
    paceLabel: p.phase === "met" ? "Đã đạt" : `~${fmtUSD(p.perDay)}`,
    paceUnit: p.phase === "met" ? undefined : "/ngày",
  };
}

export default function PremiumProgress({ progress, tone, now }: Props) {
  const v = toView(progress, now);
  const met = v.remaining === 0;

  return (
    <section className={`progress progress--${tone}`} aria-label="Tiến độ Signal Groups Premium">
      <div className="progress__top">
        <div className="progress__heading">
          <span className="label">Signal Groups Premium · {v.title}</span>
          <span className="progress__period num">
            {fmtDayFull(v.startDay)} – {fmtDayFull(v.endDay)}
          </span>
        </div>
        <span className="progress__day num">{v.dayLabel}</span>
      </div>

      <div className="progress__amounts">
        <span className="progress__volume num">{fmtUSD(v.volume)}</span>
        <span className="progress__target num">/ {fmtUSD(progress.required)}</span>
        <span className="progress__pct num">{v.percent}%</span>
      </div>

      <div
        className="bar"
        role="progressbar"
        aria-label="Hoàn thành yêu cầu khối lượng"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, v.percent)}
        aria-valuetext={`${v.percent}% — ${fmtUSD(v.volume)} trên ${fmtUSD(progress.required)}`}
      >
        <span className="bar__fill" style={{ width: `${Math.min(100, Math.max(v.percent, v.volume > 0 ? 2 : 0))}%` }} />
      </div>

      <dl className="progress__grid">
        <div className="progress__item">
          <dt>Yêu cầu</dt>
          <dd className="num">{fmtUSD(progress.required)}</dd>
        </div>
        <div className={`progress__item${v.leftUrgent && !met ? " is-urgent" : ""}`}>
          <dt>Còn lại</dt>
          <dd className="num">
            {v.leftLabel}
            {v.leftUrgent && !met && (
              <span className="progress__warn" aria-label="Cảnh báo">
                {" "}
                ⚠
              </span>
            )}
          </dd>
        </div>
        <div className="progress__item">
          <dt>Cần thêm</dt>
          <dd className={`num${met ? " is-ok" : ""}`}>{met ? "Đã đủ" : fmtUSD(v.remaining)}</dd>
        </div>
        <div className="progress__item">
          <dt>{v.paceTitle}</dt>
          <dd className={`num${met ? " is-ok" : ""}`}>
            {v.paceLabel}
            {v.paceUnit && (
              <>
                <wbr />
                <span className="progress__unit">{v.paceUnit}</span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
