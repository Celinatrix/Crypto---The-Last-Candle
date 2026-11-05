"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ColumnsChart, Figure, LineChart, RankedBars } from "@/frontend/components/AdminCharts";
import { fmtAmount, fmtDateTime, fmtDay, fmtDayFull, fmtUSD } from "@/frontend/lib/format";
import { vnClock, vnDayKey } from "@/shared/vnTime";
import type { AdminOverview, AdminStats as Stats } from "@/shared/types";

const STALE_MS = 5 * 60_000;
const VOLUME_SERIES = [
  { name: "Thành viên đã liên kết", color: "var(--viz-1)" },
  { name: "UID chưa liên kết", color: "var(--viz-2)" },
];

function depositKind(assetType: number, name: string): string {
  if (assetType === 30) return "Nạp on-chain";
  if (assetType === 231) return "Mua P2P";
  if (assetType === 131) return "Chuyển nội bộ";
  return name;
}

const usdt = (v: number) => `${fmtAmount(v)} USDT`;

export default function AdminStats({ overview, onSignedOut }: { overview: AdminOverview; onSignedOut: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [depositDay, setDepositDay] = useState<string | null>(null);
  const [volumeDay, setVolumeDay] = useState<string | null>(null);
  const autoSynced = useRef(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (depositDay) qs.set("depositDay", depositDay);
    if (volumeDay) qs.set("volumeDay", volumeDay);
    try {
      const res = await fetch(`/api/admin/stats?${qs}`, { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) return onSignedOut();
      if (!res.ok) throw new Error();
      const next = (await res.json()) as Stats;
      setStats(next);
      setError(null);
      return next;
    } catch {
      setError("Không tải được thống kê. Vui lòng thử lại.");
    }
  }, [depositDay, volumeDay, onSignedOut]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/admin/deposits/sync", { method: "POST", credentials: "same-origin" });
      if (res.status === 401) return onSignedOut();
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setSyncError("Chưa lấy được dữ liệu mới từ BingX. Số liệu bên dưới là của lần cập nhật trước.");
    } finally {
      setSyncing(false);
    }
  }, [load, onSignedOut]);

  useEffect(() => {
    void load().then((next) => {
      if (!next || autoSynced.current) return;
      autoSynced.current = true;
      if (!next.syncedAt || Date.now() - Date.parse(next.syncedAt) > STALE_MS) void sync();
    });
  }, [load, sync]);

  const topRows = useMemo(() => {
    const rows = [
      ...overview.members
        .filter((m) => m.status !== "kicked" && m.volume > 0)
        .map((m) => ({ label: m.uid, value: m.volume, seriesIndex: 0 })),
      ...overview.unlinked.map((u) => ({ label: u.uid, value: u.volume, seriesIndex: 1 })),
    ];
    return rows.sort((a, b) => b.value - a.value).slice(0, 10);
  }, [overview]);

  if (error && !stats) {
    return (
      <div className="alert alert--danger" role="alert">
        {error}
      </div>
    );
  }
  if (!stats) return <p className="admin__empty" role="status">Đang tải thống kê…</p>;

  const days = stats.volumeDaily.map((d) => d.day);
  const last = stats.volumeDaily.at(-1);
  const prev = stats.volumeDaily.at(-2);
  const lastTotal = last ? last.linked + last.other : 0;
  const prevTotal = prev ? prev.linked + prev.other : 0;
  const delta = prevTotal > 0 ? ((lastTotal - prevTotal) / prevTotal) * 100 : null;
  const total30 = stats.volumeDaily.reduce((s, d) => s + d.linked + d.other, 0);
  const todayDeposit = stats.depositDaily.find((d) => d.day === stats.today);
  const todayUsdt = todayDeposit ? todayDeposit.onchain + todayDeposit.p2p + todayDeposit.transfer : 0;
  const depositDays = stats.depositDaily.map((d) => d.day);
  const dayTotal = stats.deposits.filter((d) => d.currency === "USDT").reduce((s, d) => s + d.amount, 0);
  const otherCurrencies = stats.depositDaily.reduce((s, d) => s + d.otherCurrency, 0);
  const selectedVolumeTotal = stats.dayVolumes.reduce((s, v) => s + v.volume, 0);
  const isToday = stats.depositDay === stats.today;

  const tiles = [
    { label: `Volume ngày ${fmtDay(stats.lastVolumeDay)}`, value: fmtUSD(lastTotal), note: delta === null ? "Chưa có ngày trước để so sánh" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% so với ${prev ? fmtDay(prev.day) : ""}` },
    { label: "Tổng volume 30 ngày", value: fmtUSD(total30), note: `${fmtDay(days[0] ?? "")} – ${fmtDay(stats.lastVolumeDay)}` },
    { label: `UID có giao dịch ngày ${fmtDay(stats.lastVolumeDay)}`, value: String(last?.traders ?? 0), note: "Thành viên và UID chưa liên kết" },
    { label: "Nạp hôm nay", value: usdt(todayUsdt), note: `${todayDeposit?.events ?? 0} lượt từ ${todayDeposit?.uids ?? 0} UID` },
  ];

  return (
    <div className="admin__stats-page">
      <ul className="stats__tiles">
        {tiles.map((t) => (
          <li key={t.label} className="admin__stat">
            <span className="admin__stat-label">{t.label}</span>
            <span className="stats__tile-value num">{t.value}</span>
            <span className="admin__stat-label">{t.note}</span>
          </li>
        ))}
      </ul>

      <section className="stats__section" aria-labelledby="stats-deposits">
        <header className="stats__head">
          <div>
            <h2 id="stats-deposits" className="stats__title">
              {isToday ? "Hôm nay ai đã nạp tiền" : `Nạp tiền ngày ${fmtDayFull(stats.depositDay)}`}
            </h2>
            <p className="admin__hint">
              {stats.deposits.length} lượt · {usdt(dayTotal)} · Giờ Việt Nam.{" "}
              {stats.syncedAt ? `Cập nhật lúc ${fmtDateTime(Date.parse(stats.syncedAt))}.` : "Chưa cập nhật lần nào."}
            </p>
          </div>
          <div className="stats__controls">
            <label className="sr-only" htmlFor="stats-deposit-day">Chọn ngày nạp</label>
            <input
              id="stats-deposit-day"
              className="input stats__date"
              type="date"
              min={depositDays[0]}
              max={stats.today}
              value={stats.depositDay}
              onChange={(e) => e.target.value && setDepositDay(e.target.value)}
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void sync()} disabled={syncing}>
              {syncing ? "Đang lấy từ BingX…" : "Cập nhật từ BingX"}
            </button>
          </div>
        </header>

        {syncError && <div className="alert alert--warn" role="alert">{syncError}</div>}
        {stats.failedUids > 0 && (
          <div className="alert alert--warn" role="status">
            Lần cập nhật gần nhất chưa đọc được {stats.failedUids} UID, nên số liệu có thể thiếu. Hãy đợi vài phút rồi bấm Cập nhật từ
            BingX.
          </div>
        )}
        <div className="alert alert--warn" role="note">
          <strong>Chưa có dữ liệu rút tiền.</strong> API đối tác của BingX chỉ cung cấp lượt nạp của người được mời, không cung
          cấp lượt rút, nên web chưa thể cho biết ai đã rút tiền.
        </div>

        {stats.deposits.length === 0 ? (
          <p className="admin__empty">{isToday ? "Hôm nay chưa có lượt nạp nào." : "Ngày này không có lượt nạp nào."}</p>
        ) : (
          <table className="admin__table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>UID</th>
                <th>Gmail</th>
                <th>Hình thức</th>
                <th className="is-num">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {stats.deposits.map((d, i) => (
                <tr key={`${d.uid}-${d.time}-${i}`}>
                  <td data-label="Thời gian" className="num">
                    {vnClock(Date.parse(d.time))} {fmtDay(vnDayKey(Date.parse(d.time)))}
                  </td>
                  <td data-label="UID" className="num">{d.uid}</td>
                  <td data-label="Gmail" className={`admin__cell-email${d.email ? "" : " is-muted"}`}>{d.email ?? "Chưa liên kết"}</td>
                  <td data-label="Hình thức">{depositKind(d.assetType, d.typeName)}</td>
                  <td data-label="Số tiền" className="is-num num">{fmtAmount(d.amount)} {d.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Figure
          n={1}
          title="Tiền nạp theo ngày"
          caption={
            <>
              Tổng USDT nạp vào của các UID dưới link đối tác trong 30 ngày, theo ngày giờ Việt Nam, chia theo hình thức. Chuyển nội
              bộ có thể không phải tiền mới vào BingX.
              {otherCurrencies > 0 ? ` Không tính ${otherCurrencies} lượt bằng loại tiền khác.` : ""} Nguồn: BingX Partner API. Bấm vào
              một cột để xem chi tiết ngày đó.
            </>
          }
          table={
            <table className="admin__table">
              <thead>
                <tr><th>Ngày</th><th className="is-num">On-chain</th><th className="is-num">P2P</th><th className="is-num">Nội bộ</th><th className="is-num">Lượt</th><th className="is-num">UID</th></tr>
              </thead>
              <tbody>
                {[...stats.depositDaily].reverse().filter((d) => d.events > 0).map((d) => (
                  <tr key={d.day}>
                    <td data-label="Ngày" className="num">{fmtDayFull(d.day)}</td>
                    <td data-label="On-chain" className="is-num num">{fmtAmount(d.onchain)}</td>
                    <td data-label="P2P" className="is-num num">{fmtAmount(d.p2p)}</td>
                    <td data-label="Nội bộ" className="is-num num">{fmtAmount(d.transfer)}</td>
                    <td data-label="Lượt" className="is-num num">{d.events}</td>
                    <td data-label="UID" className="is-num num">{d.uids}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <ColumnsChart
            days={depositDays}
            series={[
              { name: "Nạp on-chain", color: "var(--viz-1)", values: stats.depositDaily.map((d) => d.onchain) },
              { name: "Mua P2P", color: "var(--viz-2)", values: stats.depositDaily.map((d) => d.p2p) },
              { name: "Chuyển nội bộ và khác", color: "var(--viz-3)", values: stats.depositDaily.map((d) => d.transfer) },
            ]}
            yTitle="USDT"
            summary={`Biểu đồ cột tiền nạp 30 ngày. Hôm nay ${usdt(todayUsdt)}. Dùng phím mũi tên để xem từng ngày.`}
            format={usdt}
            totalLabel="Tổng"
            selected={stats.depositDay}
            onSelect={setDepositDay}
          />
        </Figure>
      </section>

      <section className="stats__section" aria-labelledby="stats-volume">
        <h2 id="stats-volume" className="stats__title">Khối lượng giao dịch</h2>

        <Figure
          n={2}
          title="Tổng volume futures crypto theo ngày"
          caption={
            <>
              Tổng volume futures crypto (đã trừ TradFi) của tất cả UID dưới link đối tác, theo ngày UTC của BingX. Dữ liệu tới hết
              hôm qua vì BingX công bố số của một ngày vào ngày hôm sau. Nguồn: BingX Partner API. Bấm vào một cột để xem từng UID.
            </>
          }
          table={
            <table className="admin__table">
              <thead>
                <tr><th>Ngày</th><th className="is-num">Thành viên</th><th className="is-num">Chưa liên kết</th><th className="is-num">Tổng</th><th className="is-num">UID GD</th></tr>
              </thead>
              <tbody>
                {[...stats.volumeDaily].reverse().map((d) => (
                  <tr key={d.day}>
                    <td data-label="Ngày" className="num">{fmtDayFull(d.day)}</td>
                    <td data-label="Thành viên" className="is-num num">{fmtUSD(d.linked)}</td>
                    <td data-label="Chưa liên kết" className="is-num num">{fmtUSD(d.other)}</td>
                    <td data-label="Tổng" className="is-num num">{fmtUSD(d.linked + d.other)}</td>
                    <td data-label="UID GD" className="is-num num">{d.traders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <ColumnsChart
            days={days}
            series={[
              { ...VOLUME_SERIES[0]!, values: stats.volumeDaily.map((d) => d.linked) },
              { ...VOLUME_SERIES[1]!, values: stats.volumeDaily.map((d) => d.other) },
            ]}
            yTitle="USD"
            summary={`Biểu đồ cột volume 30 ngày. Ngày gần nhất ${fmtUSD(lastTotal)}, tổng 30 ngày ${fmtUSD(total30)}. Dùng phím mũi tên để xem từng ngày.`}
            format={fmtUSD}
            totalLabel="Tổng"
            selected={stats.volumeDay}
            onSelect={setVolumeDay}
          />
        </Figure>

        <div className="stats__detail">
          <h3 className="viz__title">
            Volume từng UID ngày {fmtDayFull(stats.volumeDay)}: {fmtUSD(selectedVolumeTotal)} từ {stats.dayVolumes.length} UID
          </h3>
          {stats.dayVolumes.length === 0 ? (
            <p className="admin__empty">Ngày này không có giao dịch.</p>
          ) : (
            <table className="admin__table">
              <thead>
                <tr><th>UID</th><th>Gmail</th><th className="is-num">Volume</th><th className="is-num">Tỷ trọng</th></tr>
              </thead>
              <tbody>
                {stats.dayVolumes.map((v) => (
                  <tr key={v.uid}>
                    <td data-label="UID" className="num">{v.uid}</td>
                    <td data-label="Gmail" className={`admin__cell-email${v.email ? "" : " is-muted"}`}>{v.email ?? "Chưa liên kết"}</td>
                    <td data-label="Volume" className="is-num num">{fmtUSD(v.volume)}</td>
                    <td data-label="Tỷ trọng" className="is-num num">{((v.volume / selectedVolumeTotal) * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Figure
          n={3}
          title="Số UID có giao dịch mỗi ngày"
          caption={<>Số UID dưới link đối tác có volume futures crypto lớn hơn 0 trong ngày, theo ngày UTC của BingX. Nguồn: BingX Partner API.</>}
        >
          <LineChart
            days={days}
            series={[{ name: "UID có giao dịch", color: "var(--viz-1)", values: stats.volumeDaily.map((d) => d.traders) }]}
            yTitle="Số UID"
            summary={`Biểu đồ đường số UID có giao dịch 30 ngày. Ngày gần nhất ${last?.traders ?? 0} UID. Dùng phím mũi tên để xem từng ngày.`}
            format={(v) => String(v)}
          />
        </Figure>

        <Figure
          n={4}
          title="10 UID có volume cao nhất trong chu kỳ"
          caption={
            <>
              Volume futures crypto từ {fmtDayFull(overview.cycle.start)} tới dữ liệu mới nhất. Vạch dọc là mục tiêu {fmtUSD(overview.cycle.target)} mỗi
              chu kỳ. Chỉ thành viên đã liên kết mới được xét điều kiện. Nguồn: BingX Partner API.
            </>
          }
        >
          {topRows.length === 0 ? (
            <p className="admin__empty">Chưa có giao dịch trong chu kỳ này.</p>
          ) : (
            <RankedBars rows={topRows} target={overview.cycle.target} format={fmtUSD} series={VOLUME_SERIES} />
          )}
        </Figure>
      </section>
    </div>
  );
}
