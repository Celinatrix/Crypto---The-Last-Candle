"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { SignalDraft, SignalImageResult } from "@/backend/signalImage";
import SignalStatsView, { statusOf } from "@/frontend/components/SignalStatsView";
import { fmtDateTimeShort, fmtPrice, fmtR } from "@/frontend/lib/format";
import { vnDayKey, vnShortDate } from "@/shared/vnTime";
import { weekOptions, weekRange } from "@/shared/weeklyReport";
import {
  avgEntry,
  KNOWN_CALLERS,
  ladderError,
  orderEntries,
  plannedRR,
  rAt,
  type Signal,
  type SignalCandlesResponse,
  type SignalOrderType,
  type SignalSide,
  type SignalsResponse,
} from "@/shared/signals";

type Notice = { tone: "ok" | "danger"; text: string } | null;

async function post(body: object): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch("/api/admin/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, status: res.status, error: json.error };
}

/** "73,500.5" or "73500,5" → 73500.5; empty or invalid → NaN */
const parsePrice = (v: string) => {
  const t = v.trim().replace(/\s/g, "");
  if (!t) return NaN;
  const normal = t.includes(",") && !t.includes(".") ? t.replace(",", ".") : t.replace(/,/g, "");
  return /^\d*\.?\d+$/.test(normal) ? Number(normal) : NaN;
};

/** What was typed or pasted → the base coin: "btc", "BTC-USDT", "BTCUSDT", "btc / usdt" → "BTC". */
function toBase(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length > 4 && clean.endsWith("USDT") ? clean.slice(0, -4) : clean;
}

async function loadAdminCandles(id: number): Promise<SignalCandlesResponse> {
  const res = await fetch(`/api/admin/signals?candles=${id}`, { credentials: "same-origin", cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as SignalCandlesResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Không tải được giá từ BingX.");
  return body;
}

export default function AdminSignals({ onSignedOut }: { onSignedOut: () => void }) {
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/signals", { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) return onSignedOut();
      if (!res.ok) throw new Error();
      setData((await res.json()) as SignalsResponse);
      setLoadError(null);
    } catch {
      setLoadError("Không tải được danh sách tín hiệu. Vui lòng thử lại.");
    }
  }, [onSignedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => (data?.signals ?? []).filter((s) => s.status === "pending" || s.status === "open"), [data]);
  // A draft read from a screenshot, loaded into the form; the key remounts the form with it.
  const [formDraft, setFormDraft] = useState<{ key: number; draft: SignalDraft } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  return (
    <div className="admin__stats-page">
      <section className="stats__section" aria-label="Đăng tín hiệu">
        <div className="stats__head">
          <div>
            <h2 className="stats__title">Đăng tín hiệu mới</h2>
            <p className="admin__hint">
              Hệ thống tự chấm kết quả theo nến 1 phút BingX. Lệnh nhiều TP chốt đều từng phần, SL giữ nguyên trừ khi bạn dời.
              Lệnh Limit tự huỷ nếu giá chạm SL hoặc TP1 trước khi khớp.
            </p>
          </div>
        </div>
        <SignalImageReader
          active={active}
          onNotice={setNotice}
          reload={load}
          onSignedOut={onSignedOut}
          onEdit={(draft) => {
            setFormDraft({ key: Date.now(), draft });
            formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        <div ref={formRef}>
          <SignalForm
            key={formDraft?.key ?? 0}
            draft={formDraft?.draft ?? null}
            onDone={async (text) => {
              setFormDraft(null);
              setNotice({ tone: "ok", text });
              await load();
            }}
            onSignedOut={onSignedOut}
          />
        </div>
      </section>

      {notice && (
        <div className={`alert alert--${notice.tone}`} role="status">
          {notice.text}
        </div>
      )}

      {data && <WeeklyReport signals={data.signals} onSignedOut={onSignedOut} />}

      <section className="stats__section" aria-label="Lệnh đang chạy">
        <h2 className="stats__title">Đang chạy và chờ khớp ({active.length})</h2>
        {loadError && <div className="alert alert--danger" role="alert">{loadError}</div>}
        {!data ? (
          <p className="admin__empty" role="status">Đang tải…</p>
        ) : active.length === 0 ? (
          <p className="admin__empty">Không có lệnh nào đang chạy.</p>
        ) : (
          <ul className="admin__cards">
            {active.map((s) => (
              <ActiveCard key={s.id} s={s} onNotice={setNotice} reload={load} onSignedOut={onSignedOut} />
            ))}
          </ul>
        )}
      </section>

      {data && data.signals.length > 0 && (
        <section className="stats__section signals--admin" aria-label="Thống kê">
          <h2 className="stats__title">Thống kê (thành viên thấy giống hệt phần này)</h2>
          <SignalStatsView signals={data.signals} updatedAt={data.updatedAt} loadCandles={loadAdminCandles} />
        </section>
      )}
    </div>
  );
}

/** Pick a week (Monday–Sunday, Vietnam time) and download its PDF report. */
function WeeklyReport({ signals, onSignedOut }: { signals: Signal[]; onSignedOut: () => void }) {
  const options = useMemo(() => weekOptions(signals), [signals]);
  const [week, setWeek] = useState(options[0]?.week ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (w: string) => {
    const { start, end } = weekRange(w);
    return `${vnShortDate(start)} – ${vnShortDate(end - 1)}/${vnDayKey(end - 1).slice(0, 4)}`;
  };

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/signals/report?week=${week}`, { credentials: "same-origin", cache: "no-store" });
      if (res.status === 401) return onSignedOut();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return setError(body.error ?? "Không tạo được báo cáo.");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `bao-cao-tin-hieu-tuan-${week}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stats__section" aria-label="Báo cáo tuần">
      <div className="stats__head">
        <div>
          <h2 className="stats__title">Báo cáo tuần (PDF)</h2>
          <p className="admin__hint">
            Tổng lệnh đăng trong tuần (thứ Hai – Chủ nhật, giờ Việt Nam): đã khớp, chưa khớp, đã huỷ, số lệnh chạm TP / SL,
            winrate, lợi nhuận R, R:R và bảng chi tiết từng lệnh.
          </p>
        </div>
        <div className="stats__controls">
          <select className="input sig__select" aria-label="Chọn tuần" value={week} onChange={(e) => setWeek(e.target.value)}>
            {options.map((o) => (
              <option key={o.week} value={o.week}>
                {label(o.week)} · {o.count} lệnh
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void download()} disabled={busy || !week}>
            {busy ? "Đang tạo…" : "Tải PDF"}
          </button>
        </div>
      </div>
      {error && <div className="alert alert--danger" role="alert">{error}</div>}
    </section>
  );
}

const priceText = (n: number | null | undefined) => (n == null ? "" : String(n));

const VN_OFFSET_MS = 7 * 3_600_000;
/** ISO time → "YYYY-MM-DDTHH:mm" in Vietnam time, for a datetime-local input. */
const toVnInput = (iso: string | null | undefined) => (iso ? new Date(Date.parse(iso) + VN_OFFSET_MS).toISOString().slice(0, 16) : "");
/** "YYYY-MM-DDTHH:mm" read as Vietnam time → ISO, or null when empty/invalid. */
function fromVnInput(v: string): string | null {
  const t = Date.parse(`${v}:00Z`);
  return v && Number.isFinite(t) ? new Date(t - VN_OFFSET_MS).toISOString() : null;
}
/** "08:09 16/11" in Vietnam time. */
const vnLabel = (iso: string) => {
  const v = toVnInput(iso);
  return `${v.slice(11, 16)} ${v.slice(8, 10)}/${v.slice(5, 7)}`;
};

function SignalForm({
  draft,
  onDone,
  onSignedOut,
}: {
  draft: SignalDraft | null;
  onDone: (text: string) => Promise<void>;
  onSignedOut: () => void;
}) {
  // Only the base coin is typed; the quote is always USDT (BingX USDT-M perpetuals).
  const [base, setBase] = useState(draft?.base || "BTC");
  const symbol = `${base}-USDT`;
  const [side, setSide] = useState<SignalSide>(draft?.side ?? "long");
  const [orderType, setOrderType] = useState<SignalOrderType>(draft?.orderType ?? "market");
  const [entry, setEntry] = useState(priceText(draft ? draft.entry ?? (draft.orderType === "market" ? draft.refPrice : null) : null));
  // Limit only: an optional second entry. Either order is accepted; the deeper one becomes ET2.
  const [entry2, setEntry2] = useState(priceText(draft?.entry2));
  const [sl, setSl] = useState(priceText(draft?.sl));
  const [tps, setTps] = useState([0, 1, 2].map((i) => priceText(draft?.tps[i])));
  const [note, setNote] = useState(draft?.note ?? "");
  const [caller, setCaller] = useState(draft?.caller ?? "");
  // Vietnam time of the chat message; empty = the signal counts from now.
  const [postedAt, setPostedAt] = useState(toVnInput(draft?.postedAt));
  const [live, setLive] = useState<{ symbol: string; price: number } | null>(
    draft?.refPrice && !draft.postedAt ? { symbol: `${draft.base}-USDT`, price: draft.refPrice } : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = orderType === "limit";
  const twoEntries = limit && entry2.trim() !== "";
  const nums = {
    entry: parsePrice(entry),
    entry2: twoEntries ? parsePrice(entry2) : null,
    sl: parsePrice(sl),
    tps: tps.map(parsePrice).filter((n) => !Number.isNaN(n)),
  };
  const filledTps = tps.filter((t) => t.trim() !== "");
  const ready =
    !Number.isNaN(nums.entry) &&
    !(nums.entry2 !== null && Number.isNaN(nums.entry2)) &&
    !Number.isNaN(nums.sl) &&
    nums.tps.length > 0 &&
    nums.tps.length === filledTps.length;
  const [et1, et2] = orderEntries(side, nums.entry, nums.entry2);
  const ladder = ready ? ladderError(side, et1, nums.sl, nums.tps, et2) : null;
  const preview = ready && !ladder ? { side, entry: et1, entry2: et2, sl: nums.sl, tps: nums.tps } : null;

  async function fetchLive() {
    setError(null);
    if (!base) return setError("Nhập tên coin, ví dụ BTC.");
    const s = symbol;
    const res = await fetch(`/api/admin/signals?price=${encodeURIComponent(s)}`, { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) return onSignedOut();
    const body = (await res.json().catch(() => ({}))) as { price?: number; error?: string };
    if (!res.ok || !body.price) return setError(body.error ?? "Không lấy được giá.");
    setLive({ symbol: s, price: body.price });
    if (orderType === "market" || !entry) setEntry(String(body.price));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post({
        action: "create",
        symbol,
        side,
        orderType,
        entry: preview.entry,
        entry2: preview.entry2,
        sl: nums.sl,
        tps: nums.tps,
        note,
        caller: caller.trim() || null,
        postedAt: fromVnInput(postedAt),
      });
      if (r.status === 401) return onSignedOut();
      if (!r.ok) return setError(r.error ?? "Không đăng được tín hiệu.");
      setEntry("");
      setEntry2("");
      setSl("");
      setTps(["", "", ""]);
      setNote("");
      setPostedAt("");
      await onDone(`Đã đăng ${side === "long" ? "Long" : "Short"} ${base} | USDT.`);
    } catch {
      setError("Không kết nối được máy chủ. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  const seg = <T extends string>(value: T, set: (v: T) => void, options: [T, string][], label: string) => (
    <div className="sig__seg" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" className={`admin__tab${value === id ? " is-active" : ""}`} aria-pressed={value === id} onClick={() => set(id)}>
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <form className="form sig-form liquid-glass" noValidate onSubmit={submit}>
      {draft && (
        <p className="sig-read__hint">
          Đã điền từ ảnh{draft.missing.length > 0 && <> · còn thiếu <b>{draft.missing.join(", ")}</b></>}. Kiểm tra rồi bấm Đăng tín hiệu.
        </p>
      )}
      <div className="sig-form__row">
        <div className="field">
          <label className="label" htmlFor="sig-symbol">Cặp coin (BingX)</label>
          <div className="sig-form__inline">
            <div className="input sig-pair">
              <input
                id="sig-symbol"
                className="sig-pair__base"
                value={base}
                onChange={(e) => setBase(toBase(e.target.value))}
                placeholder="BTC"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={20}
                aria-describedby="sig-symbol-quote"
              />
              <span className="sig-pair__sep" aria-hidden="true" />
              <span id="sig-symbol-quote" className="sig-pair__quote">USDT</span>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void fetchLive()} disabled={busy}>
              Lấy giá
            </button>
          </div>
          {live && <p className="field__hint num">Giá {live.symbol.replace("-", " | ")} lúc vừa lấy: {fmtPrice(live.price)}</p>}
        </div>
        <div className="field">
          <span className="label">Hướng</span>
          {seg(side, setSide, [["long", "Long"], ["short", "Short"]], "Hướng lệnh")}
        </div>
        <div className="field">
          <span className="label">Loại lệnh</span>
          {seg(orderType, setOrderType, [["market", "Market"], ["limit", "Limit"]], "Loại lệnh")}
        </div>
      </div>

      <div className="sig-form__row">
        {(
          [
            ["sig-entry", limit ? "ET1" : "Entry", entry, setEntry, false],
            ...(limit ? ([["sig-entry2", "ET2", entry2, setEntry2, true]] as const) : []),
            ["sig-sl", "SL", sl, setSl, false],
          ] as const
        ).map(([id, label, value, set, optional]) => (
          <div className="field" key={id}>
            <label className="label" htmlFor={id}>
              {label}
              {optional && <span className="sig__optional"> (tuỳ chọn)</span>}
            </label>
            <input id={id} className="input input--mono" inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} autoComplete="off" />
          </div>
        ))}
        {tps.map((t, i) => (
          <div className="field" key={i}>
            <label className="label" htmlFor={`sig-tp${i}`}>TP{i + 1}{i > 0 && <span className="sig__optional"> (tuỳ chọn)</span>}</label>
            <input
              id={`sig-tp${i}`}
              className="input input--mono"
              inputMode="decimal"
              value={t}
              onChange={(e) => setTps((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      <div className="sig-form__row">
        <div className="field">
          <label className="label" htmlFor="sig-caller">Người gọi lệnh</label>
          <input
            id="sig-caller"
            className="input"
            list="sig-callers"
            maxLength={60}
            value={caller}
            onChange={(e) => setCaller(e.target.value)}
            placeholder={KNOWN_CALLERS.join(" / ")}
            autoComplete="off"
          />
          <datalist id="sig-callers">
            {KNOWN_CALLERS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="field">
          <label className="label" htmlFor="sig-posted">
            Giờ gọi lệnh<span className="sig__optional"> (giờ VN, để trống = bây giờ)</span>
          </label>
          <input id="sig-posted" className="input input--mono" type="datetime-local" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} />
          {postedAt && (
            <p className="field__hint">Kết quả được chấm từ phút này. Lệnh Market cần Entry là giá lúc gọi, lệch quá 3% sẽ bị từ chối.</p>
          )}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="sig-note">Ghi chú (tuỳ chọn, thành viên sẽ thấy)</label>
        <input id="sig-note" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {ladder && <p className="field__hint is-error" role="alert">{ladder}</p>}
      {preview && (
        <p className="sig-form__preview num">
          {preview.entry2 !== null &&
            `ET1 ${fmtPrice(preview.entry)} · ET2 ${fmtPrice(preview.entry2)} (mỗi ET ½ vị thế) · Giá TB ${fmtPrice(avgEntry(preview))} · `}
          1R = {fmtPrice(Math.abs(avgEntry(preview) - preview.sl))} ({((Math.abs(avgEntry(preview) - preview.sl) / avgEntry(preview)) * 100).toFixed(2)}%) ·{" "}
          {preview.tps.map((tp, i) => `TP${i + 1} ${fmtR(rAt(preview, tp), 2)}`).join(" · ")} · R:R kế hoạch 1 : {plannedRR(preview).toFixed(2)} · mỗi TP
          chốt {preview.tps.length === 1 ? "100%" : `1/${preview.tps.length}`}
        </p>
      )}
      {error && <div className="alert alert--danger" role="alert">{error}</div>}
      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || !preview}>
          {busy ? "Đang đăng…" : "Đăng tín hiệu"}
        </button>
      </div>
    </form>
  );
}

function ActiveCard({
  s,
  onNotice,
  reload,
  onSignedOut,
}: {
  s: Signal;
  onNotice: (n: Notice) => void;
  reload: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const [slInput, setSlInput] = useState("");
  const [closeInput, setCloseInput] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = statusOf(s);

  async function run(body: object, done: string) {
    setBusy(true);
    onNotice(null);
    try {
      const r = await post(body);
      if (r.status === 401) return onSignedOut();
      onNotice(r.ok ? { tone: "ok", text: done } : { tone: "danger", text: r.error ?? "Đã có lỗi xảy ra." });
      if (r.ok) {
        setSlInput("");
        setCloseInput("");
      }
      await reload();
    } catch {
      onNotice({ tone: "danger", text: "Không kết nối được máy chủ. Vui lòng thử lại." });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  const slPrice = parsePrice(slInput);
  const closePrice = parsePrice(closeInput);
  const pending = s.status === "pending";

  return (
    <li className="admin__card sig-card">
      <div className="admin__card-body">
        <p className="admin__uid num">
          #{s.id} {s.symbol} <span className={`sig__side is-${s.side}`}>{s.side === "long" ? "Long" : "Short"}</span>{" "}
          <span className="sig__type">{s.orderType === "market" ? "Market" : "Limit"}</span>
        </p>
        <p className="admin__sub num">
          {s.entry2 === null ? `Entry ${fmtPrice(s.entry)}` : `ET ${fmtPrice(s.entry)} / ${fmtPrice(s.entry2)} (khớp ${s.entriesFilled}/2)`} · SL{" "}
          {fmtPrice(s.currentSl)}
          {s.currentSl !== s.sl && ` (gốc ${fmtPrice(s.sl)})`} · TP {s.tps.map(fmtPrice).join(" / ")}
        </p>
        <p className="admin__sub num">
          <span className={`admin__badge is-${status.tone}`}>{status.label}</span> · {s.caller ? `${s.caller} gọi` : "Gọi"} {fmtDateTimeShort(Date.parse(s.createdAt))}
          {!pending && ` · Đã chốt ${fmtR(s.realizedR)}`}
        </p>
      </div>
      <div className="sig-card__actions">
        <div className="sig-form__inline">
          <input className="input input--mono" inputMode="decimal" placeholder="SL mới" aria-label={`SL mới cho #${s.id}`} value={slInput} onChange={(e) => setSlInput(e.target.value)} />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy || Number.isNaN(slPrice)}
            onClick={() => void run({ action: "move_sl", id: s.id, price: slPrice }, `Đã dời SL #${s.id} về ${fmtPrice(slPrice)}.`)}
          >
            Dời SL
          </button>
        </div>
        <div className="sig-form__inline">
          {!pending && (
            <input
              className="input input--mono"
              inputMode="decimal"
              placeholder="Giá đóng"
              aria-label={`Giá đóng tay cho #${s.id}`}
              value={closeInput}
              onChange={(e) => setCloseInput(e.target.value)}
            />
          )}
          <button
            type="button"
            className={`btn btn--sm ${confirm ? "admin__btn-danger" : "btn--ghost"}`}
            disabled={busy || (!pending && Number.isNaN(closePrice))}
            onBlur={() => setConfirm(false)}
            onClick={() => {
              if (!confirm) return setConfirm(true);
              void run(
                { action: "close", id: s.id, price: pending ? null : closePrice },
                pending ? `Đã huỷ lệnh chờ #${s.id}.` : `Đã đóng tay #${s.id} tại ${fmtPrice(closePrice)}.`,
              );
            }}
          >
            {confirm ? "Bấm lần nữa để xác nhận" : pending ? "Huỷ lệnh" : "Đóng tay"}
          </button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Signals from a screenshot: paste (Ctrl+V), drop or pick images; Claude reads them into drafts.
// ---------------------------------------------------------------------------------------------

const MAX_IMAGES = 4;
/** Longest side sent to the server; enough to read chat text, small enough for the request limit. */
const MAX_SIDE = 1600;

/** Shrinks an image file to a JPEG and returns its base64. */
async function toJpegBase64(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88).split(",")[1] ?? "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

type DraftState = "new" | "busy" | "done";

function SignalImageReader({
  active,
  onNotice,
  reload,
  onSignedOut,
  onEdit,
}: {
  active: Signal[];
  onNotice: (n: Notice) => void;
  reload: () => Promise<void>;
  onSignedOut: () => void;
  onEdit: (d: SignalDraft) => void;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignalImageResult | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, DraftState>>({});
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const read = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX_IMAGES);
      if (images.length === 0) return;
      setReading(true);
      setError(null);
      setResult(null);
      setStates({});
      setPreviews(images.map((f) => URL.createObjectURL(f)));
      try {
        const payload = await Promise.all(images.map(async (f) => ({ mediaType: "image/jpeg", data: await toJpegBase64(f) })));
        const res = await fetch("/api/admin/signals/read-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ images: payload }),
        });
        if (res.status === 401) return onSignedOut();
        const body = (await res.json().catch(() => ({}))) as Partial<SignalImageResult> & { error?: string };
        if (!res.ok) return setError(body.error ?? "Không đọc được ảnh.");
        const r: SignalImageResult = { signals: body.signals ?? [], slMoves: body.slMoves ?? [], unreadable: body.unreadable ?? null };
        setResult(r);
        if (r.signals.length === 0 && r.slMoves.length === 0) setError(r.unreadable ?? "Không thấy tín hiệu nào trong ảnh.");
      } catch {
        setError("Không đọc được ảnh. Vui lòng thử lại.");
      } finally {
        setReading(false);
      }
    },
    [onSignedOut],
  );

  // Ctrl+V anywhere on the page; a paste without an image (normal text) is left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      void read(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [read]);

  // Free the thumbnails when they are replaced or the tab closes.
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  async function act(key: string, body: object, done: string) {
    setStates((s) => ({ ...s, [key]: "busy" }));
    onNotice(null);
    try {
      const r = await post(body);
      if (r.status === 401) return onSignedOut();
      if (!r.ok) {
        setStates((s) => ({ ...s, [key]: "new" }));
        return onNotice({ tone: "danger", text: r.error ?? "Đã có lỗi xảy ra." });
      }
      setStates((s) => ({ ...s, [key]: "done" }));
      onNotice({ tone: "ok", text: done });
      await reload();
    } catch {
      setStates((s) => ({ ...s, [key]: "new" }));
      onNotice({ tone: "danger", text: "Không kết nối được máy chủ. Vui lòng thử lại." });
    }
  }

  const found = result && (result.signals.length > 0 || result.slMoves.length > 0);

  return (
    <div className="sig-read">
      <div
        className={`sig-read__drop${dragging ? " is-over" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Dán, kéo thả hoặc chọn ảnh tín hiệu"
        aria-busy={reading}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInput.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void read(Array.from(e.dataTransfer.files));
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void read(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <p className="sig-read__title">{reading ? "Đang đọc ảnh…" : "Đăng nhanh từ ảnh"}</p>
        {!reading && (
          <p className="sig-read__sub">Ctrl+V để dán ảnh chụp tin nhắn, hoặc kéo thả / bấm để chọn (tối đa {MAX_IMAGES} ảnh).</p>
        )}
        {previews.length > 0 && (
          <div className="sig-read__thumbs">
            {previews.map((u) => (
              <img key={u} src={u} alt="" />
            ))}
          </div>
        )}
      </div>

      {error && <div className="alert alert--danger" role="alert">{error}</div>}

      {found && (
        <ul className="sig-read__list">
          {result.signals.map((d, i) => {
            const key = `s${i}`;
            const state = states[key] ?? "new";
            const entry = d.entry ?? (d.orderType === "market" ? d.refPrice : null);
            const [et1, et2] = entry === null ? [NaN, null] : orderEntries(d.side, entry, d.entry2);
            const ladder = d.missing.length === 0 && d.sl !== null ? ladderError(d.side, et1, d.sl, d.tps, et2) : null;
            const canPost = d.missing.length === 0 && !ladder && state === "new";
            return (
              <li key={key} className={`sig-read__item${state === "done" ? " is-done" : ""}`}>
                <div className="sig-read__body">
                  <p className="admin__uid num">
                    {d.base} | USDT <span className={`sig__side is-${d.side}`}>{d.side === "long" ? "Long" : "Short"}</span>{" "}
                    <span className="sig__type">{d.orderType === "market" ? "Market" : "Limit"}</span>
                  </p>
                  <p className="admin__sub">
                    {d.caller ?? "Chưa rõ người gọi"} · {d.postedAt ? `gọi lúc ${vnLabel(d.postedAt)}` : "tính từ lúc đăng"}
                  </p>
                  <p className="admin__sub num">
                    {d.entry === null && d.orderType === "market"
                      ? `Entry: giá ${d.postedAt ? "lúc gọi" : "lúc đăng"}${d.refPrice ? ` (${d.postedAt ? "" : "~"}${fmtPrice(d.refPrice)})` : ""}`
                      : `Entry ${entry === null ? "—" : fmtPrice(entry)}${d.entry2 !== null ? ` / ${fmtPrice(d.entry2)}` : ""}`}
                    {" · "}SL {d.sl === null ? "—" : fmtPrice(d.sl)}
                    {" · "}TP {d.tps.length ? d.tps.map(fmtPrice).join(" / ") : "—"}
                  </p>
                  {d.note && <p className="admin__sub">Ghi chú: {d.note}</p>}
                  {d.missing.length > 0 && <p className="sig-read__warn is-error">Thiếu {d.missing.join(", ")}: bấm “Sửa trong form” để điền.</p>}
                  {ladder && <p className="sig-read__warn is-error">{ladder}</p>}
                  {d.warnings.map((w) => (
                    <p key={w} className="sig-read__warn">{w}</p>
                  ))}
                </div>
                <div className="sig-read__actions">
                  {state === "done" ? (
                    <span className="admin__badge is-ok">Đã đăng</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={!canPost}
                        onClick={() =>
                          void act(
                            key,
                            {
                              action: "create",
                              symbol: `${d.base}-USDT`,
                              side: d.side,
                              orderType: d.orderType,
                              entry: et1,
                              entry2: et2,
                              sl: d.sl,
                              tps: d.tps,
                              note: d.note,
                              caller: d.caller,
                              postedAt: d.postedAt,
                            },
                            `Đã đăng ${d.side === "long" ? "Long" : "Short"} ${d.base} | USDT.`,
                          )
                        }
                      >
                        {state === "busy" ? "Đang đăng…" : "Đăng"}
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" disabled={state === "busy"} onClick={() => onEdit(d)}>
                        Sửa trong form
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}

          {result.slMoves.map((m, i) => {
            const matches = active.filter((s) => s.symbol === `${m.base}-USDT`);
            return (
              <li key={`m${i}`} className="sig-read__item">
                <div className="sig-read__body">
                  <p className="admin__uid num">Dời SL {m.base} | USDT → {fmtPrice(m.price)}</p>
                  {matches.length === 0 && <p className="sig-read__warn is-error">Không có lệnh {m.base} nào đang chạy hoặc chờ khớp.</p>}
                  {m.warnings.map((w) => (
                    <p key={w} className="sig-read__warn">{w}</p>
                  ))}
                </div>
                <div className="sig-read__actions">
                  {matches.map((s) => {
                    const key = `m${i}-${s.id}`;
                    const state = states[key] ?? "new";
                    return state === "done" ? (
                      <span key={key} className="admin__badge is-ok">Đã dời #{s.id}</span>
                    ) : (
                      <button
                        key={key}
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={state === "busy"}
                        onClick={() => void act(key, { action: "move_sl", id: s.id, price: m.price }, `Đã dời SL #${s.id} về ${fmtPrice(m.price)}.`)}
                      >
                        {state === "busy" ? "Đang dời…" : `Dời SL #${s.id} (${s.side === "long" ? "Long" : "Short"})`}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {found && result.unreadable && <p className="admin__hint">{result.unreadable}</p>}
    </div>
  );
}
