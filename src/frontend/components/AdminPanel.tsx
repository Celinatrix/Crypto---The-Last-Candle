"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import AdminStats from "@/frontend/components/AdminStats";
import Turnstile, { turnstileEnabled, type TurnstileHandle } from "@/frontend/components/Turnstile";
import { fmtDateTime, fmtDayFull, fmtUSD } from "@/frontend/lib/format";
import type { AdminMember, AdminOverview, MemberStatus } from "@/shared/types";

async function post(path: string, body: object = {}): Promise<{ ok: boolean; error?: string; status: number }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: json.error, status: res.status };
}

const STATUS: Record<MemberStatus, { label: string; tone: string }> = {
  pending: { label: "Chờ duyệt", tone: "warn" },
  active: { label: "Hoạt động", tone: "ok" },
  warned: { label: "Chờ xét xoá", tone: "danger" },
  kicked: { label: "Đã xoá", tone: "muted" },
};

const joined = (m: AdminMember) => (m.joinedAt ? fmtDayFull(m.joinedAt.slice(0, 10)) : "—");

/** Step 1: email + bot check. Step 2: the 6-digit code. */
function AdminLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [botToken, setBotToken] = useState<string | null>(null);
  const [botError, setBotError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);
  const botReady = !turnstileEnabled || botToken !== null;

  const onToken = useCallback((t: string | null) => {
    setBotToken(t);
    if (t) setBotError(null);
  }, []);
  const onBotError = useCallback((c: string) => setBotError(c), []);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const clean = email.trim().toLowerCase();
      const r = await post("/api/admin/auth/start", { email: clean, turnstileToken: botToken ?? undefined });
      if (r.ok) {
        setCode("");
        setSentTo(clean);
      } else setError(r.error ?? "Đã có lỗi xảy ra.");
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
    } finally {
      setBusy(false);
      turnstile.current?.reset();
    }
  }

  async function verify(value: string) {
    if (!sentTo || !/^\d{6}$/.test(value)) return;
    setError(null);
    setBusy(true);
    try {
      const r = await post("/api/admin/auth/verify", { email: sentTo, code: value });
      if (r.ok) onSignedIn();
      else setError(r.error ?? "Đã có lỗi xảy ra.");
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin admin--login">
      <div className="admin__login-card liquid-glass">
        <p className="admin__brand">The Last Candle</p>
        <h1 className="card__title">Trang quản trị</h1>
        <Link className="admin__home" href="/">
          ← Về trang chủ
        </Link>

        {sentTo ? (
          <form
            className="form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void verify(code);
            }}
          >
            <p className="card__text">
              Nếu <strong>{sentTo}</strong> là địa chỉ quản trị, mã 6 chữ số đã được gửi tới đó. Mã có hiệu lực 10 phút.
            </p>
            <div className="field">
              <label className="label" htmlFor="admin-code">Mã xác thực</label>
              <input
                id="admin-code"
                className="input input--mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => {
                  const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(next);
                  if (next.length === 6 && next !== code) void verify(next);
                }}
                disabled={busy}
                autoFocus
              />
            </div>
            {error && <div className="alert alert--danger" role="alert">{error}</div>}
            <div className="form__actions">
              <button type="submit" className="btn btn--primary" disabled={busy || code.length !== 6}>
                {busy ? "Đang kiểm tra…" : "Đăng nhập"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => {
                  setSentTo(null);
                  setBotToken(null);
                  setError(null);
                }}
              >
                Yêu cầu mã mới
              </button>
            </div>
          </form>
        ) : (
          <form className="form" noValidate onSubmit={requestCode}>
            <p className="card__text">Chỉ dành cho quản trị viên. Mã đăng nhập sẽ được gửi về email quản trị.</p>
            <div className="field">
              <label className="label" htmlFor="admin-email">Email quản trị</label>
              <input
                id="admin-email"
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>
            <Turnstile ref={turnstile} onToken={onToken} onError={onBotError} />
            {botError !== null && (
              <div className="field__hint is-error" role="alert">
                <p>Chưa xác minh được{botError ? ` (mã ${botError})` : ""}. Hãy thử lại, hoặc tắt VPN và đổi trình duyệt.</p>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setBotError(null);
                    turnstile.current?.reset();
                  }}
                >
                  Thử lại
                </button>
              </div>
            )}
            {error && <div className="alert alert--danger" role="alert">{error}</div>}
            <button type="submit" className="btn btn--primary" disabled={busy || !email.trim() || !botReady}>
              {busy ? "Đang gửi…" : "Gửi mã đăng nhập"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

type Tab = "stats" | "pending" | "members" | "kicks" | "unlinked";
type Filter = "all" | "met" | "short";

function Dashboard({ data, reload, onSignedOut }: { data: AdminOverview; reload: () => Promise<void>; onSignedOut: () => void }) {
  const { cycle, members, kickReviews, unlinked } = data;
  const pending = useMemo(() => members.filter((m) => m.status === "pending"), [members]);
  const inGroup = useMemo(() => members.filter((m) => m.status === "active" || m.status === "warned"), [members]);
  const metCount = inGroup.filter((m) => m.shortfall === 0).length;

  const [tab, setTab] = useState<Tab>(pending.length > 0 ? "pending" : kickReviews.length > 0 ? "kicks" : "stats");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // Removing someone takes a second click on the same button.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (q && !m.uid.includes(q) && !m.email.toLowerCase().includes(q)) return false;
      if (filter === "met") return m.shortfall === 0;
      if (filter === "short") return m.shortfall > 0 && m.status !== "kicked";
      return true;
    });
  }, [members, query, filter]);

  async function act(action: "approve" | "reject" | "kick" | "keep", id: number, doneText: string) {
    const key = `${action}:${id}`;
    if ((action === "reject" || action === "kick") && confirmKey !== key) {
      setConfirmKey(key);
      return;
    }
    setConfirmKey(null);
    setBusyKey(key);
    setNotice(null);
    try {
      const r = await post("/api/admin/action", { action, id });
      if (r.status === 401) return onSignedOut();
      setNotice(r.ok ? { tone: "ok", text: doneText } : { tone: "danger", text: r.error ?? "Đã có lỗi xảy ra." });
      await reload();
    } catch {
      setNotice({ tone: "danger", text: "Không kết nối được máy chủ. Vui lòng thử lại." });
    } finally {
      setBusyKey(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    await reload().finally(() => setRefreshing(false));
  }

  async function signOut() {
    await post("/api/admin/auth/logout").catch(() => undefined);
    onSignedOut();
  }

  const stats = [
    { label: "Thành viên trong nhóm", value: inGroup.length },
    { label: "Đã đạt mục tiêu", value: metCount, tone: "ok" },
    { label: "Chưa đạt", value: inGroup.length - metCount },
    { label: "Chờ duyệt", value: pending.length, tone: pending.length > 0 ? "warn" : undefined },
    { label: "Chờ xét xoá", value: kickReviews.length, tone: kickReviews.length > 0 ? "danger" : undefined },
    { label: "Chưa liên kết web", value: unlinked.length },
  ];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "stats", label: "Thống kê" },
    { id: "pending", label: "Chờ duyệt", count: pending.length },
    { id: "members", label: "Thành viên", count: members.length },
    { id: "kicks", label: "Chờ xét xoá", count: kickReviews.length },
    { id: "unlinked", label: "Chưa liên kết", count: unlinked.length },
  ];

  return (
    <main className="admin">
      <header className="admin__top">
        <div>
          <p className="admin__brand">The Last Candle</p>
          <h1 className="admin__title">Trang quản trị</h1>
          <p className="admin__meta num">
            Chu kỳ {fmtDayFull(cycle.start)} – {fmtDayFull(cycle.end)} · Mục tiêu {fmtUSD(cycle.target)}
            {data.lastSync && (
              <>
                {" "}· Đồng bộ {fmtDateTime(Date.parse(data.lastSync.at))}
                {data.lastSync.status === "failed" && <span className="admin__sync-bad"> (lỗi)</span>}
              </>
            )}
          </p>
        </div>
        <div className="admin__top-actions">
          <Link className="btn btn--ghost btn--sm" href="/">
            Về trang chủ
          </Link>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Đang tải…" : "Tải lại"}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void signOut()}>
            Đăng xuất
          </button>
        </div>
      </header>

      <ul className="admin__stats">
        {stats.map((s) => (
          <li key={s.label} className="admin__stat">
            <span className={`admin__stat-value num${s.tone ? ` is-${s.tone}` : ""}`}>{s.value}</span>
            <span className="admin__stat-label">{s.label}</span>
          </li>
        ))}
      </ul>

      {notice && (
        <div className={`alert alert--${notice.tone}`} role="status">
          {notice.text}
        </div>
      )}

      <div className="admin__tabs" role="tablist" aria-label="Danh sách">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`admin__tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label} {t.count !== undefined && <span className="admin__tab-count num">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === "stats" && <AdminStats overview={data} onSignedOut={onSignedOut} />}

      {tab === "pending" && (
        <section aria-label="Chờ duyệt">
          <p className="admin__hint">
            Web không tự xác minh được ai là chủ UID. Hãy đối chiếu đúng người trước khi duyệt. Từ chối sẽ xoá liên kết để
            chủ thật của UID có thể đăng ký.
          </p>
          {pending.length === 0 ? (
            <p className="admin__empty">Không có ai đang chờ duyệt.</p>
          ) : (
            <ul className="admin__cards">
              {pending.map((m) => (
                <li key={m.memberId} className="admin__card">
                  <div className="admin__card-body">
                    <p className="admin__uid num">{m.uid}</p>
                    <p className="admin__email">{m.email}</p>
                    <p className="admin__sub num">Đăng ký {joined(m)} · Volume chu kỳ này {fmtUSD(m.volume)}</p>
                  </div>
                  <div className="admin__card-actions">
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={busyKey !== null}
                      onClick={() => void act("approve", m.memberId, `Đã duyệt UID ${m.uid}.`)}
                    >
                      Duyệt
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm ${confirmKey === `reject:${m.memberId}` ? "admin__btn-danger" : "btn--ghost"}`}
                      disabled={busyKey !== null}
                      onClick={() => void act("reject", m.memberId, `Đã từ chối và xoá liên kết UID ${m.uid}.`)}
                    >
                      {confirmKey === `reject:${m.memberId}` ? "Bấm lần nữa để xoá" : "Từ chối"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "members" && (
        <section aria-label="Thành viên">
          <div className="admin__tools">
            <input
              id="admin-search"
              className="input"
              type="search"
              placeholder="Tìm theo UID hoặc Gmail"
              aria-label="Tìm theo UID hoặc Gmail"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="admin__filters">
              {(
                [
                  ["all", "Tất cả"],
                  ["met", "Đã đạt"],
                  ["short", "Chưa đạt"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`admin__tab${filter === id ? " is-active" : ""}`}
                  aria-pressed={filter === id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="admin__empty">Không có thành viên phù hợp.</p>
          ) : (
            <table className="admin__table">
              <thead>
                <tr>
                  <th>UID</th>
                  <th>Gmail</th>
                  <th>Trạng thái</th>
                  <th className="is-num">Volume</th>
                  <th className="is-num">Còn thiếu</th>
                  <th className="is-num">Ngày GD</th>
                  <th>Tham gia</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.memberId}>
                    <td data-label="UID" className="num">{m.uid}</td>
                    <td data-label="Gmail" className="admin__cell-email">{m.email}</td>
                    <td data-label="Trạng thái">
                      <span className={`admin__badge is-${STATUS[m.status].tone}`}>{STATUS[m.status].label}</span>
                    </td>
                    <td data-label="Volume" className="is-num num">{fmtUSD(m.volume)}</td>
                    <td data-label="Còn thiếu" className={`is-num num${m.shortfall === 0 ? " is-ok" : ""}`}>
                      {m.shortfall === 0 ? "Đã đạt" : fmtUSD(m.shortfall)}
                    </td>
                    <td data-label="Ngày GD" className="is-num num">{m.tradeDays}</td>
                    <td data-label="Tham gia" className="num">{joined(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "kicks" && (
        <section aria-label="Chờ xét xoá">
          <p className="admin__hint">
            Những người này hết chu kỳ và hết 24 giờ gia hạn mà chưa đủ volume. Hệ thống không tự xoá khỏi nhóm: Xoá chỉ
            cập nhật trên web, bạn vẫn cần tự xoá họ khỏi nhóm chat.
          </p>
          {kickReviews.length === 0 ? (
            <p className="admin__empty">Không có ai đang chờ xét.</p>
          ) : (
            <ul className="admin__cards">
              {kickReviews.map((k) => (
                <li key={k.reviewId} className="admin__card">
                  <div className="admin__card-body">
                    <p className="admin__uid num">{k.uid}</p>
                    <p className="admin__email">{k.email}</p>
                    <p className="admin__sub num">
                      {fmtDayFull(k.startDay)} – {fmtDayFull(k.endDay)}: {fmtUSD(k.volume)} / {fmtUSD(k.target)}
                    </p>
                  </div>
                  <div className="admin__card-actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={busyKey !== null}
                      onClick={() => void act("keep", k.reviewId, `Đã giữ lại UID ${k.uid}.`)}
                    >
                      Giữ lại
                    </button>
                    <button
                      type="button"
                      className={`btn btn--sm ${confirmKey === `kick:${k.reviewId}` ? "admin__btn-danger" : "btn--ghost"}`}
                      disabled={busyKey !== null}
                      onClick={() => void act("kick", k.reviewId, `Đã đánh dấu xoá UID ${k.uid}.`)}
                    >
                      {confirmKey === `kick:${k.reviewId}` ? "Bấm lần nữa để xoá" : "Xoá"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "unlinked" && (
        <section aria-label="Chưa liên kết web">
          <p className="admin__hint">UID dưới link đối tác có giao dịch trong chu kỳ này nhưng chưa liên kết web.</p>
          {unlinked.length === 0 ? (
            <p className="admin__empty">Không có UID nào.</p>
          ) : (
            <table className="admin__table">
              <thead>
                <tr>
                  <th>UID</th>
                  <th className="is-num">Volume</th>
                  <th className="is-num">Ngày GD</th>
                </tr>
              </thead>
              <tbody>
                {unlinked.map((u) => (
                  <tr key={u.uid}>
                    <td data-label="UID" className="num">{u.uid}</td>
                    <td data-label="Volume" className="is-num num">{fmtUSD(u.volume)}</td>
                    <td data-label="Ngày GD" className="is-num num">{u.tradeDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}

export default function AdminPanel() {
  const [state, setState] = useState<"loading" | "login" | "error" | AdminOverview>("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/overview", { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) return setState("login");
      if (!res.ok) return setState("error");
      setState((await res.json()) as AdminOverview);
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") {
    return (
      <main className="admin admin--login">
        <p className="admin__empty" role="status">Đang tải…</p>
      </main>
    );
  }
  if (state === "error") {
    return (
      <main className="admin admin--login">
        <div className="admin__login-card liquid-glass">
          <div className="alert alert--danger" role="alert">Không tải được dữ liệu. Vui lòng thử lại.</div>
          <button type="button" className="btn btn--ghost" onClick={() => void load()}>Thử lại</button>
        </div>
      </main>
    );
  }
  if (state === "login") return <AdminLogin onSignedIn={() => void load()} />;
  return <Dashboard data={state} reload={load} onSignedOut={() => setState("login")} />;
}
