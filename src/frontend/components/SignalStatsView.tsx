"use client";

import { useEffect, useMemo, useState } from "react";
import { ColumnsChart, Figure } from "@/frontend/components/AdminCharts";
import { CandleChart, EquityChart, EVENT_LABEL, RHistogram, WinrateBars } from "@/frontend/components/SignalCharts";
import { fmtDateTimeShort, fmtDayFull, fmtPct, fmtPrice, fmtR } from "@/frontend/lib/format";
import { computeStats, plannedRR, statusOf, type Signal, type SignalCandlesResponse } from "@/shared/signals";

type Period = "30" | "90" | "180" | "all";
type SideFilter = "all" | "long" | "short";

const PERIODS: [Period, string][] = [
  ["30", "30 ngày"],
  ["90", "90 ngày"],
  ["180", "180 ngày"],
  ["all", "Tất cả"],
];
const SIDE_LABEL = { long: "Long", short: "Short" } as const;
const PAGE = 15;

export { statusOf };

export default function SignalStatsView({
  signals,
  updatedAt,
  loadCandles,
}: {
  signals: Signal[];
  updatedAt: string;
  loadCandles: (id: number) => Promise<SignalCandlesResponse>;
}) {
  const [period, setPeriod] = useState<Period>("90");
  const [symbol, setSymbol] = useState("all");
  const [side, setSide] = useState<SideFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<number | null>(null);

  const symbols = useMemo(() => [...new Set(signals.map((s) => s.symbol))].sort(), [signals]);
  const filtered = useMemo(() => {
    const since = period === "all" ? -Infinity : Date.parse(updatedAt) - Number(period) * 86_400_000;
    return signals.filter(
      (s) => Date.parse(s.createdAt) >= since && (symbol === "all" || s.symbol === symbol) && (side === "all" || s.side === side),
    );
  }, [signals, period, symbol, side, updatedAt]);
  const st = useMemo(() => computeStats(filtered), [filtered]);

  useEffect(() => setShown(PAGE), [period, symbol, side]);

  const tiles = [
    {
      label: "Winrate",
      value: st.winrate === null ? "—" : fmtPct(st.winrate),
      sub: `${st.wins} thắng · ${st.losses} thua${st.breakeven ? ` · ${st.breakeven} hoà` : ""}`,
    },
    { label: "Tổng lợi nhuận", value: fmtR(st.totalR), sub: `${st.closed} lệnh đã đóng`, tone: st.totalR > 0 ? "ok" : st.totalR < 0 ? "danger" : undefined },
    {
      label: "R:R thực tế",
      value: st.realizedRR === null ? "—" : `1 : ${st.realizedRR.toFixed(2)}`,
      sub: st.avgWinR !== null && st.avgLossR !== null ? `TB thắng ${fmtR(st.avgWinR)} · TB thua ${fmtR(-st.avgLossR)}` : "Cần cả lệnh thắng và thua",
    },
    { label: "R:R kế hoạch", value: st.plannedRR === null ? "—" : `1 : ${st.plannedRR.toFixed(2)}`, sub: "Trung bình các TP lúc đăng" },
    { label: "Kỳ vọng mỗi lệnh", value: st.avgR === null ? "—" : fmtR(st.avgR), sub: "Lợi nhuận TB của 1 lệnh" },
    { label: "Profit factor", value: st.profitFactor === null ? "—" : st.profitFactor.toFixed(2), sub: "Tổng R thắng ÷ tổng R thua" },
    { label: "Sụt giảm lớn nhất", value: fmtR(st.maxDrawdownR), sub: "Từ đỉnh R cộng dồn" },
    { label: "Chuỗi dài nhất", value: `${st.longestWinStreak} / ${st.longestLossStreak}`, sub: "Thắng liên tiếp / thua liên tiếp" },
  ];

  const list = useMemo(() => [...filtered].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [filtered]);

  return (
    <div className="sig">
      <div className="sig__filters" role="group" aria-label="Bộ lọc">
        <div className="sig__seg" role="group" aria-label="Khoảng thời gian">
          {PERIODS.map(([id, label]) => (
            <button key={id} type="button" className={`admin__tab${period === id ? " is-active" : ""}`} aria-pressed={period === id} onClick={() => setPeriod(id)}>
              {label}
            </button>
          ))}
        </div>
        <select className="input sig__select" aria-label="Cặp coin" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          <option value="all">Tất cả cặp</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="sig__seg" role="group" aria-label="Hướng lệnh">
          {(
            [
              ["all", "Long + Short"],
              ["long", "Long"],
              ["short", "Short"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" className={`admin__tab${side === id ? " is-active" : ""}`} aria-pressed={side === id} onClick={() => setSide(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="sig__tiles">
        {tiles.map((t) => (
          <li key={t.label} className="admin__stat">
            <span className={`stats__tile-value num${t.tone ? ` is-${t.tone}` : ""}`}>{t.value}</span>
            <span className="admin__stat-label">{t.label}</span>
            <span className="sig__tile-sub num">{t.sub}</span>
          </li>
        ))}
      </ul>
      <p className="sig__meta num">
        {st.open} lệnh đang chạy · {st.pending} lệnh chờ khớp · {st.cancelled} lệnh huỷ (không tính) · Cập nhật giá BingX{" "}
        {fmtDateTimeShort(Date.parse(updatedAt))}
      </p>

      {st.closed === 0 ? (
        <p className="admin__empty">Chưa có lệnh nào đóng trong bộ lọc này.</p>
      ) : (
        <div className="sig__figures">
          <div className="sig__wide">
            <Figure
              n={1}
              title="Đường vốn theo R"
              caption={
                <>
                  Lợi nhuận cộng dồn sau mỗi lệnh đóng, tính theo R (1R = khoảng cách từ Entry, hoặc giá trung bình nếu có 2 ET, đến SL ban đầu), xếp theo thời điểm
                  đóng. Không phụ thuộc vốn hay đòn bẩy. Nguồn giá: BingX, nến 1 phút.
                </>
              }
              table={
                <table className="admin__table">
                  <thead>
                    <tr>
                      <th>Lệnh</th>
                      <th>Đóng lúc</th>
                      <th className="is-num">R</th>
                      <th className="is-num">Cộng dồn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.equity.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Lệnh" className="num">#{p.id} {p.symbol}</td>
                        <td data-label="Đóng lúc" className="num">{fmtDateTimeShort(Date.parse(p.at))}</td>
                        <td data-label="R" className="is-num num">{fmtR(p.r)}</td>
                        <td data-label="Cộng dồn" className="is-num num">{fmtR(p.cum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <EquityChart equity={st.equity} />
            </Figure>
          </div>

          <div className="sig__wide">
            <Figure
              n={2}
              title="Số lệnh thắng, thua theo tuần"
              caption={<>Mỗi cột là một tuần (bắt đầu thứ Hai, giờ Việt Nam), xếp theo ngày đóng lệnh. Lệnh huỷ không được tính.</>}
              table={
                <table className="admin__table">
                  <thead>
                    <tr>
                      <th>Tuần</th>
                      <th className="is-num">Thắng</th>
                      <th className="is-num">Thua</th>
                      <th className="is-num">Hoà</th>
                      <th className="is-num">Winrate</th>
                      <th className="is-num">R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.weekly.map((w) => (
                      <tr key={w.week}>
                        <td data-label="Tuần" className="num">{fmtDayFull(w.week)}</td>
                        <td data-label="Thắng" className="is-num num">{w.wins}</td>
                        <td data-label="Thua" className="is-num num">{w.losses}</td>
                        <td data-label="Hoà" className="is-num num">{w.breakeven}</td>
                        <td data-label="Winrate" className="is-num num">{w.wins + w.losses ? fmtPct(w.wins / (w.wins + w.losses), 0) : "—"}</td>
                        <td data-label="R" className="is-num num">{fmtR(w.r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <ColumnsChart
                days={st.weekly.map((w) => w.week)}
                series={[
                  { name: "Thắng", color: "var(--viz-1)", values: st.weekly.map((w) => w.wins) },
                  { name: "Thua", color: "var(--viz-2)", values: st.weekly.map((w) => w.losses) },
                  { name: "Hoà", color: "var(--viz-3)", values: st.weekly.map((w) => w.breakeven) },
                ]}
                yTitle="Số lệnh"
                summary={`Số lệnh thắng, thua, hoà theo tuần, ${st.weekly.length} tuần.`}
                format={(v) => String(v)}
                totalLabel="Tổng"
              />
            </Figure>
          </div>

          <Figure n={3} title="Phân bố kết quả theo R" caption={<>Số lệnh trong từng khoảng 0,5R. Lệnh nhiều TP có thể dừng giữa các mức nguyên.</>}>
            <RHistogram bins={st.histogram} />
          </Figure>

          <Figure
            n={4}
            title="Winrate theo cặp coin và hướng lệnh"
            caption={<>Thanh là winrate, vạch dọc là mốc 50%. Bên phải: số lệnh thắng trên số lệnh thắng + thua, và tổng R.</>}
          >
            <p className="sig__group">Theo hướng lệnh</p>
            <WinrateBars rows={st.bySide} labelOf={(k) => SIDE_LABEL[k as "long" | "short"] ?? k} />
            <p className="sig__group">Theo cặp coin</p>
            <WinrateBars rows={st.bySymbol} labelOf={(k) => k.replace("-USDT", "")} />
          </Figure>
        </div>
      )}

      <section className="sig__list" aria-label="Danh sách tín hiệu">
        <h3 className="stats__title">Danh sách tín hiệu</h3>
        {list.length === 0 ? (
          <p className="admin__empty">Không có tín hiệu phù hợp.</p>
        ) : (
          <>
            <table className="admin__table sig__table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Đăng lúc</th>
                  <th>Cặp</th>
                  <th>Lệnh</th>
                  <th className="is-num">Entry</th>
                  <th className="is-num">SL</th>
                  <th className="is-num">TP</th>
                  <th className="is-num">R:R</th>
                  <th>Trạng thái</th>
                  <th className="is-num">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, shown).map((s) => {
                  const st0 = statusOf(s);
                  const open = openId === s.id;
                  return (
                    <SignalRow key={s.id} s={s} status={st0} open={open} onToggle={() => setOpenId(open ? null : s.id)} loadCandles={loadCandles} />
                  );
                })}
              </tbody>
            </table>
            {shown < list.length && (
              <button type="button" className="btn btn--ghost btn--sm sig__more" onClick={() => setShown((n) => n + PAGE)}>
                Xem thêm ({list.length - shown} lệnh)
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function SignalRow({
  s,
  status,
  open,
  onToggle,
  loadCandles,
}: {
  s: Signal;
  status: ReturnType<typeof statusOf>;
  open: boolean;
  onToggle: () => void;
  loadCandles: (id: number) => Promise<SignalCandlesResponse>;
}) {
  const finished = s.status === "closed";
  return (
    <>
      <tr className={`sig__row${open ? " is-open" : ""}`}>
        <td data-label="#" className="num">
          <button type="button" className="link-btn sig__toggle" aria-expanded={open} onClick={onToggle}>
            #{s.id} {open ? "▴" : "▾"}
          </button>
        </td>
        <td data-label="Đăng lúc" className="num">{fmtDateTimeShort(Date.parse(s.createdAt))}</td>
        <td data-label="Cặp" className="num">{s.symbol}</td>
        <td data-label="Lệnh">
          <span className={`sig__side is-${s.side}`}>{SIDE_LABEL[s.side]}</span> <span className="sig__type">{s.orderType === "market" ? "Market" : "Limit"}</span>
        </td>
        <td data-label="Entry" className="is-num num">
          {fmtPrice(s.entry)}
          {s.entry2 !== null && <> · {fmtPrice(s.entry2)}</>}
        </td>
        <td data-label="SL" className="is-num num">
          {fmtPrice(s.currentSl)}
          {s.currentSl !== s.sl && <small className="sig__was"> (gốc {fmtPrice(s.sl)})</small>}
        </td>
        <td data-label="TP" className="is-num num">{s.tps.map(fmtPrice).join(" · ")}</td>
        <td data-label="R:R" className="is-num num">1 : {plannedRR(s).toFixed(2)}</td>
        <td data-label="Trạng thái">
          <span className={`admin__badge is-${status.tone}`}>{status.label}</span>
        </td>
        <td data-label="Kết quả" className={`is-num num${finished ? (s.realizedR > 0 ? " is-ok" : s.realizedR < 0 ? " is-danger" : "") : ""}`}>
          {s.status === "cancelled" || s.status === "pending" ? "—" : finished ? fmtR(s.realizedR) : `${fmtR(s.realizedR)} đã chốt`}
        </td>
      </tr>
      {open && (
        <tr className="sig__detail-row">
          <td colSpan={10}>
            <SignalDetail s={s} loadCandles={loadCandles} />
          </td>
        </tr>
      )}
    </>
  );
}

function SignalDetail({ s, loadCandles }: { s: Signal; loadCandles: (id: number) => Promise<SignalCandlesResponse> }) {
  const [data, setData] = useState<SignalCandlesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCandles(s.id)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Không tải được giá từ BingX."));
    return () => {
      alive = false;
    };
  }, [s.id, loadCandles]);

  return (
    <div className="sig__detail">
      {s.note && <p className="sig__note">{s.note}</p>}
      <figure className="viz">
        <h4 className="viz__title">
          {s.symbol} · nến {data?.interval ?? "…"} quanh tín hiệu #{s.id}
        </h4>
        {error ? (
          <div className="alert alert--danger" role="alert">{error}</div>
        ) : data ? (
          <CandleChart signal={data.signal} candles={data.candles} interval={data.interval} />
        ) : (
          <span className="skeleton" style={{ height: 300 }} aria-label="Đang tải nến BingX" />
        )}
        <figcaption className="viz__caption">
          Nét đứt: Entry hoặc ET1 và ET2 (trắng), SL (cam), TP (xanh). Chấm tròn: thời điểm khớp lệnh, chạm TP/SL hoặc đóng tay. Nguồn: BingX.
        </figcaption>
      </figure>
      <ol className="sig__timeline">
        {s.events.map((e, i) => (
          <li key={i} className="num">
            <span className="sig__timeline-at">{fmtDateTimeShort(Date.parse(e.at))}</span>
            <span>{EVENT_LABEL[e.kind]}</span>
            {e.price !== null && <span>@ {fmtPrice(e.price)}</span>}
            {e.r !== null && <b>{fmtR(e.r)}</b>}
          </li>
        ))}
      </ol>
    </div>
  );
}
