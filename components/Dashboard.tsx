"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMe, logout, UnauthorizedError } from "@/lib/api";
import { fmtAmount, fmtDateTime, fmtDateTimeShort, timeAgo } from "@/lib/format";
import { getMemberState } from "@/lib/status";
import type { MeResponse, Member, VolumeSummary } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import RegisterForm from "./RegisterForm";
import VolumeChart from "./VolumeChart";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "expired" }
  | { kind: "ready"; data: MeResponse };

export default function Dashboard() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [editing, setEditing] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchMe(signal);
      if (!signal?.aborted) setState({ kind: "ready", data });
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof UnauthorizedError) setState({ kind: "expired" });
      else setState({ kind: "error", message: err instanceof Error ? err.message : "Đã có lỗi xảy ra." });
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  function reload() {
    setEditing(false);
    setState({ kind: "loading" });
    void load();
  }

  if (state.kind === "loading") return <CardSkeleton />;

  if (state.kind === "expired") {
    return (
      <section className="card">
        <h3 className="card__title">Phiên đăng nhập đã hết hạn</h3>
        <p className="card__text">Vui lòng đăng nhập lại bằng Telegram để tiếp tục.</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={async () => {
            await logout().catch(() => undefined);
            window.location.assign("/");
          }}
        >
          Đăng nhập lại
        </button>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="card">
        <h3 className="card__title">Không tải được dữ liệu</h3>
        <div className="alert alert--danger" role="alert">
          {state.message}
        </div>
        <button type="button" className="btn btn--ghost" onClick={reload}>
          Thử lại
        </button>
      </section>
    );
  }

  const { data } = state;

  if (!data.member || editing) {
    return (
      <section className="card">
        <RegisterForm
          key={editing ? "edit" : "new"}
          initialUid={data.member ? String(data.member.uid) : ""}
          initialEmail={data.member?.email ?? ""}
          onSuccess={reload}
          onCancel={data.member ? () => setEditing(false) : undefined}
        />
      </section>
    );
  }

  return <MemberView member={data.member} volume={data.volume} apiError={data.error} onEdit={() => setEditing(true)} />;
}

interface MemberViewProps {
  member: Member;
  volume: VolumeSummary | null;
  apiError?: string;
  onEdit: () => void;
}

function MemberView({ member, volume, apiError, onEdit }: MemberViewProps) {
  const now = useNow();
  const s = getMemberState(member, volume, now);
  const zero14 = volume !== null && volume.total14 <= 0;

  return (
    <section className="card card--dash" aria-labelledby="dash-title">
      <header className="dash__head">
        <div className="dash__uid">
          <span className="label" id="dash-title">
            UID BingX
          </span>
          <span className="dash__uid-value num">{String(member.uid)}</span>
        </div>
        <span className={`pill pill--${s.tone}`}>
          <span className="pill__dot" aria-hidden="true" />
          {s.label}
          {s.deadline && (
            <span className="pill__extra">
              · hạn <time className="num" dateTime={new Date(s.deadline).toISOString()} title={fmtDateTime(s.deadline)}>
                {fmtDateTimeShort(s.deadline)}
              </time>
            </span>
          )}
        </span>
      </header>

      {apiError && (
        <div className="alert alert--warn" role="status">
          Chưa lấy được dữ liệu mới từ BingX: {apiError}
        </div>
      )}

      <div className="stats">
        <div className="stat stat--main">
          <span className="label">Khối lượng 30 ngày</span>
          <Amount className="stat__value stat__value--lg" value={volume?.total30} />
        </div>
        <div className="stat">
          <span className="label">14 ngày gần nhất</span>
          <Amount className={`stat__value${zero14 ? " is-danger" : ""}`} value={volume?.total14} />
        </div>
      </div>

      {volume && volume.daily.length > 0 ? (
        <VolumeChart daily={volume.daily} />
      ) : (
        <div className="chart chart--empty">Biểu đồ sẽ hiển thị khi có dữ liệu khối lượng.</div>
      )}

      <div className={`note note--${s.tone}`}>
        <p className="note__title">{s.noteTitle}</p>
        <p className="note__body">{s.noteBody}</p>
      </div>

      <footer className="dash__foot">
        <span className="dash__email" title={member.email}>
          <MailIcon />
          {member.email}
        </span>
        {volume && <span className="dash__updated">Cập nhật {timeAgo(volume.updatedAt, now)}</span>}
        <button type="button" className="link-btn" onClick={onEdit}>
          Sửa UID / email
        </button>
      </footer>
    </section>
  );
}

function Amount({ value, className }: { value: number | undefined; className: string }) {
  if (value === undefined) return <span className={`${className} num`}>—</span>;
  return (
    <span className={`${className} num`}>
      {fmtAmount(value)}
      <span className="stat__unit"> USDT</span>
    </span>
  );
}

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function CardSkeleton() {
  return (
    <section className="card" aria-busy="true" aria-label="Đang tải dữ liệu tài khoản">
      <div className="dash__head">
        <div className="dash__uid">
          <span className="skeleton" style={{ width: 70, height: 10 }} />
          <span className="skeleton" style={{ width: 140, height: 22 }} />
        </div>
        <span className="skeleton" style={{ width: 120, height: 28, borderRadius: 999 }} />
      </div>
      <div className="stats">
        <span className="skeleton" style={{ height: 92 }} />
        <span className="skeleton" style={{ height: 92 }} />
      </div>
      <span className="skeleton" style={{ height: 200 }} />
      <span className="skeleton" style={{ height: 64 }} />
    </section>
  );
}
