"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSignalCandles, fetchSignals } from "@/frontend/lib/api";
import type { SignalsResponse } from "@/shared/signals";
import { useMember } from "./MemberProvider";
import SignalStatsView from "./SignalStatsView";

/** Statistics of the admin's signals. Only members who linked their UID see the numbers. */
export default function SignalsSection() {
  const { state, openLink } = useMember();
  const linked = state.kind === "ready" && state.data.member !== null;
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const next = await fetchSignals(signal);
      if (!signal?.aborted) setData(next);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error && err.message !== "unauthorized" ? err.message : "Phiên liên kết đã hết hạn. Hãy liên kết lại UID.");
    }
  }, []);

  useEffect(() => {
    if (!linked) {
      setData(null);
      return;
    }
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [linked, load]);

  return (
    <section className="signals" id="signals" aria-labelledby="signals-title">
      <header className="members__intro">
        <p className="eyebrow">Thống kê tín hiệu</p>
        <h2 id="signals-title" className="members__title">
          <span className="font-instrument" lang="en">
            Every <em>signal</em>, scored.
          </span>
          <span className="members__title-vi">Thắng thua, winrate và R:R của các tín hiệu Premium.</span>
        </h2>
        <p className="members__lead">
          Mỗi tín hiệu được chấm tự động theo giá BingX nến 1 phút: chạm TP hay SL trước. Lợi nhuận tính theo R, với 1R là
          khoảng cách từ Entry đến SL ban đầu. Lệnh nhiều TP chốt đều từng phần. Kết quả quá khứ không đảm bảo kết quả tương
          lai.
        </p>
      </header>

      <div className="signals__body">
        {state.kind === "loading" ? (
          <span className="skeleton" style={{ height: 420 }} aria-label="Đang tải" />
        ) : !linked ? (
          <div className="card liquid-glass signals__locked">
            <h3 className="card__title">Dành cho thành viên đã liên kết UID</h3>
            <p className="card__text">Liên kết UID BingX và Gmail để xem toàn bộ thống kê, biểu đồ và lịch sử từng tín hiệu.</p>
            <div className="form__actions">
              <button type="button" className="btn btn--primary" onClick={openLink}>
                Liên kết UID
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="card">
            <div className="alert alert--danger" role="alert">{error}</div>
            <button type="button" className="btn btn--ghost" onClick={() => void load()}>
              Thử lại
            </button>
          </div>
        ) : !data ? (
          <span className="skeleton" style={{ height: 420 }} aria-label="Đang tải thống kê" />
        ) : data.signals.length === 0 ? (
          <div className="card">
            <p className="card__text">Chưa có tín hiệu nào được đăng.</p>
          </div>
        ) : (
          <SignalStatsView signals={data.signals} updatedAt={data.updatedAt} loadCandles={fetchSignalCandles} />
        )}
      </div>
    </section>
  );
}
