"use client";

import { useId, useState, type FormEvent } from "react";
import { registerMember } from "@/lib/api";

interface Props {
  initialUid?: string;
  initialEmail?: string;
  onSuccess: () => void;
  onCancel?: () => void;
}

const UID_RE = /^\d{5,20}$/;
const GMAIL_RE = /^[a-z0-9.+_-]+@(gmail|googlemail)\.com$/i;

export default function RegisterForm({ initialUid = "", initialEmail = "", onSuccess, onCancel }: Props) {
  const [uid, setUid] = useState(initialUid);
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const ids = useId();

  const uidInvalid = touched && !UID_RE.test(uid);
  const emailInvalid = touched && !GMAIL_RE.test(email.trim());
  const editing = Boolean(onCancel);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!UID_RE.test(uid) || !GMAIL_RE.test(cleanEmail)) return;

    setSubmitting(true);
    try {
      const result = await registerMember(uid, cleanEmail);
      if (result.ok) onSuccess();
      else setError(result.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      <header className="card__head">
        <h3 className="card__title">{editing ? "Cập nhật UID / email" : "Liên kết tài khoản BingX"}</h3>
        <p className="card__text">
          Nhập UID của tài khoản BingX bạn đã đăng ký qua link đối tác và Gmail để nhận thông báo từ cộng đồng.
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

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={submitting}>
          {submitting && <span className="spinner" aria-hidden="true" />}
          {submitting ? "Đang kiểm tra với BingX…" : "Kiểm tra khối lượng"}
        </button>
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={submitting}>
            Huỷ
          </button>
        )}
      </div>
    </form>
  );
}
