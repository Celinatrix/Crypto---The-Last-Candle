"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { registerMember, verifyOtp } from "@/frontend/lib/api";
import Turnstile, { turnstileEnabled, type TurnstileHandle } from "./Turnstile";

/** Wait before "Gửi lại mã" can be pressed again (the server allows 5 codes per hour). */
const RESEND_COOLDOWN_S = 60;

interface Props {
  mode: "new" | "edit";
  initialUid?: string;
  initialEmail?: string;
  onSuccess: (uid: string, email: string) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  titleId?: string;
  autoFocus?: boolean;
  /** False while another form on the page has the bot check, so only one runs at a time. */
  botActive?: boolean;
}

const UID_RE = /^\d{5,20}$/;
const GMAIL_RE = /^[a-z0-9.+_-]+@(gmail|googlemail)\.com$/i;

export default function RegisterForm({
  mode,
  initialUid = "",
  initialEmail = "",
  onSuccess,
  onCancel,
  cancelLabel = "Huỷ",
  titleId,
  autoFocus = false,
  botActive = true,
}: Props) {
  const [uid, setUid] = useState(initialUid);
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  // Step 2: the Gmail the code was sent to (null while still on step 1).
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  // Bot check: a single-use token from Turnstile (always "ready" when Turnstile is off).
  const [botToken, setBotToken] = useState<string | null>(null);
  const [botLoadFailed, setBotLoadFailed] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const botReady = !turnstileEnabled || botToken !== null;
  useEffect(() => {
    if (!botActive) setBotToken(null);
  }, [botActive]);
  // Seconds until the code can be re-sent.
  const [cooldown, setCooldown] = useState(0);
  const ids = useId();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const [botErrorCode, setBotErrorCode] = useState<string | null>(null);
  const onBotToken = useCallback((t: string | null) => {
    setBotToken(t);
    if (t) setBotErrorCode(null);
  }, []);
  const onBotLoadError = useCallback(() => setBotLoadFailed(true), []);
  const onBotError = useCallback((errorCode: string) => setBotErrorCode(errorCode), []);

  /** Ask for a code; the Turnstile token is used up either way, so get a fresh one. */
  async function requestCode(cleanEmail: string) {
    try {
      return await registerMember(uid, cleanEmail, botToken ?? undefined);
    } finally {
      turnstileRef.current?.reset();
    }
  }

  const uidInvalid = touched && !UID_RE.test(uid);
  const emailInvalid = touched && !GMAIL_RE.test(email.trim());
  const editing = mode === "edit";
  // Both fields are required: with only one filled in, the form cannot be submitted.
  const bothFilled = uid.length > 0 && email.trim().length > 0;
  const partial = !bothFilled && (uid.length > 0 || email.trim().length > 0);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!bothFilled || !UID_RE.test(uid) || !GMAIL_RE.test(cleanEmail) || !botReady) return;

    setSubmitting(true);
    try {
      const result = await requestCode(cleanEmail);
      if (result.ok) {
        setCode("");
        setSentTo(cleanEmail);
        setCooldown(RESEND_COOLDOWN_S);
      } else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(value: string) {
    if (!sentTo || !/^\d{6}$/.test(value) || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await verifyOtp(uid, sentTo, value);
      if (result.ok) onSuccess(uid, sentTo);
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void verify(code);
  }

  async function resend() {
    if (!sentTo || cooldown > 0 || !botReady) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestCode(sentTo);
      if (result.ok) {
        setCode("");
        setCooldown(RESEND_COOLDOWN_S);
      } else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  const botNote = botLoadFailed ? (
    <p className="field__hint is-error">
      Không tải được bước xác minh chống bot. Hãy tắt trình chặn quảng cáo cho trang này hoặc tải lại trang.
    </p>
  ) : botErrorCode !== null ? (
    <div className="field__hint is-error" role="alert">
      <p>
        Chưa xác minh được{botErrorCode ? ` (mã ${botErrorCode})` : ""}. Hãy bấm Thử lại. Nếu vẫn lỗi, hãy tắt VPN và tiện
        ích chặn quảng cáo, hoặc đổi trình duyệt hay mạng khác.
      </p>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => {
          setBotErrorCode(null);
          turnstileRef.current?.reset();
        }}
      >
        Thử lại
      </button>
    </div>
  ) : null;

  if (sentTo) {
    return (
      <form className="form" onSubmit={handleVerify} noValidate aria-busy={submitting}>
        <header className="card__head">
          <h3 id={titleId} className="card__title">Nhập mã xác thực</h3>
          <p className="card__text">
            Mã 6 chữ số đã được gửi tới <strong>{sentTo}</strong>. Mã có hiệu lực 10 phút. Không thấy email? Hãy xem
            thư mục Spam hoặc Quảng cáo.
          </p>
        </header>

        <div className="field">
          <label className="label" htmlFor={`${ids}-code`}>
            Mã xác thực
          </label>
          <input
            id={`${ids}-code`}
            className="input input--mono"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(next);
              // Pasting or typing the 6th digit submits right away.
              if (next.length === 6 && next !== code) void verify(next);
            }}
            disabled={submitting}
            autoFocus
            required
          />
        </div>

        {error && (
          <div className="alert alert--danger" role="alert">
            {error}
          </div>
        )}

        {/* Needed only for "Gửi lại mã"; shown once the cooldown is over. */}
        {cooldown === 0 && botActive && (
          <>
            <Turnstile ref={turnstileRef} onToken={onBotToken} onLoadError={onBotLoadError} onError={onBotError} />
            {botNote}
          </>
        )}

        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={submitting || code.length !== 6}>
            {submitting && <span className="spinner" aria-hidden="true" />}
            {submitting ? "Đang xác thực…" : "Xác nhận"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={resend}
            disabled={submitting || cooldown > 0 || !botReady}
            aria-live="polite"
          >
            {cooldown > 0 ? `Gửi lại sau ${cooldown}s` : "Gửi lại mã"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setSentTo(null);
              setError(null);
              setBotToken(null);
            }}
            disabled={submitting}
          >
            Sửa UID / Gmail
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <header className="card__head">
        <h3 id={titleId} className="card__title">{editing ? "Cập nhật UID / email" : "Liên kết tài khoản BingX"}</h3>
        <p className="card__text">
          Nhập UID tài khoản BingX bạn đã đăng ký qua link đối tác và Gmail để nhận thông báo. Hệ thống sẽ kiểm tra
          khối lượng giao dịch 30 ngày của bạn ngay sau đó.
        </p>
      </header>

      <div className="field">
        <label className="label" htmlFor={`${ids}-uid`}>
          UID BingX
        </label>
        <input
          id={`${ids}-uid`}
          className="input input--mono"
          name="uid"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          placeholder="VD: 28471936"
          value={uid}
          onChange={(e) => setUid(e.target.value.replace(/\D/g, ""))}
          aria-invalid={uidInvalid}
          aria-describedby={`${ids}-uid-hint`}
          disabled={submitting}
          autoFocus={autoFocus}
          required
        />
        <p id={`${ids}-uid-hint`} className={`field__hint${uidInvalid ? " is-error" : ""}`}>
          {uidInvalid ? "UID chỉ gồm chữ số (5–20 ký tự). " : ""}Mở app BingX → ảnh đại diện → sao chép UID
        </p>
      </div>

      <div className="field">
        <label className="label" htmlFor={`${ids}-email`}>
          Gmail nhận thông báo
        </label>
        <input
          id={`${ids}-email`}
          className="input"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="ten.ban@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailInvalid}
          aria-describedby={`${ids}-email-hint`}
          disabled={submitting}
          required
        />
        <p id={`${ids}-email-hint`} className={`field__hint${emailInvalid ? " is-error" : ""}`}>
          {emailInvalid ? "Vui lòng nhập địa chỉ @gmail.com hợp lệ." : "Email cảnh báo sẽ được gửi tới địa chỉ này."}
        </p>
      </div>

      {error && (
        <div className="alert alert--danger" role="alert">
          {error}
        </div>
      )}

      <p id={`${ids}-required`} className={`form__required${partial ? " is-warn" : ""}`} aria-live="polite">
        {partial
          ? uid.length === 0
            ? "Còn thiếu UID BingX — cần nhập đủ cả hai để tiếp tục."
            : "Còn thiếu Gmail — cần nhập đủ cả hai để tiếp tục."
          : "Bắt buộc nhập cả UID BingX và Gmail."}
      </p>

      {botActive && (
        <>
          <Turnstile ref={turnstileRef} onToken={onBotToken} onLoadError={onBotLoadError} onError={onBotError} />
          {botNote}
        </>
      )}

      <div className="form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={submitting || !bothFilled || !botReady}
          aria-describedby={`${ids}-required`}
        >
          {submitting && <span className="spinner" aria-hidden="true" />}
          {submitting ? "Đang kiểm tra với BingX…" : "Gửi mã xác thực"}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={submitting}>
            {cancelLabel}
          </button>
        )}
      </div>
    </form>
  );
}
