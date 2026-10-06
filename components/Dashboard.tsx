"use client";

import { useState } from "react";
import { fmtDateTime, fmtDateTimeShort, timeAgo } from "@/lib/format";
import { getMemberState } from "@/lib/status";
import type { Member, VolumeSummary } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { useMember } from "./MemberProvider";
import PremiumProgress from "./PremiumProgress";
import RegisterForm from "./RegisterForm";
import VolumeChart from "./VolumeChart";

export default function Dashboard() {
  const { state, reload, markLinked, expiresAt } = useMember();
  const [editing, setEditing] = useState(false);

  function handleSaved(uid: string, email: string) {
    setEditing(false);
    markLinked(uid, email);
  }

  if (state.kind === "loading") return <CardSkeleton />;

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
          mode={data.member ? "edit" : "new"}
          initialUid={data.member ? String(data.member.uid) : ""}
          initialEmail={data.member?.email ?? ""}
          onSuccess={handleSaved}
          onCancel={data.member ? () => setEditing(false) : undefined}
        />
      </section>
    );
  }

  return (
    <MemberView
      member={data.member}
      volume={data.volume}
      apiError={data.error}
      expiresAt={expiresAt}
      onEdit={() => setEditing(true)}
    />
  );
}

interface MemberViewProps {
  member: Member;
  volume: VolumeSummary | null;
  apiError?: string;
  expiresAt: number | null;
  onEdit: () => void;
}

function MemberView({ member, volume, apiError, expiresAt, onEdit }: MemberViewProps) {
  const now = useNow();
  const s = getMemberState(member, volume, now);

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

      {s.alert && (
        <div className={`alert alert--${s.tone === "danger" ? "danger" : "warn"} alert--strong`} role="alert">
          <span aria-hidden="true">⚠ </span>
          {s.alert}
        </div>
      )}

      {s.progress && <PremiumProgress progress={s.progress} tone={s.tone} now={now} />}

      {volume && volume.daily.length > 0 ? (
        <VolumeChart
          daily={volume.daily}
          bandFrom={s.progress ? (s.progress.grace?.startDay ?? s.progress.startDay) : undefined}
          bandLabel={s.progress ? `Chu kỳ #${s.progress.grace?.index ?? s.progress.index}` : undefined}
        />
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
        {expiresAt !== null && (
          <span className="dash__session" title="Sau thời điểm này, thiết bị sẽ yêu cầu nhập lại UID và Gmail.">
            Lưu trên thiết bị này đến <span className="num">{fmtDateTimeShort(expiresAt)}</span>
          </span>
        )}
        <button type="button" className="link-btn" onClick={onEdit}>
          Sửa UID / email
        </button>
      </footer>
    </section>
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
      <span className="skeleton" style={{ height: 196 }} />
      <span className="skeleton" style={{ height: 200 }} />
      <span className="skeleton" style={{ height: 64 }} />
    </section>
  );
}
