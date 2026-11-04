"use client";

import { useEffect, useRef } from "react";
import { useMember } from "./MemberProvider";
import RegisterForm from "./RegisterForm";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function LinkModal() {
  const { linkOpen, closeLink, markLinked } = useMember();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!linkOpen) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeLink();
        return;
      }
      // Keep Tab focus inside the dialog.
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      returnFocusRef.current?.focus({ preventScroll: true });
    };
  }, [linkOpen, closeLink]);

  if (!linkOpen) return null;

  function handleSuccess(uid: string, email: string) {
    closeLink();
    markLinked(uid, email);
    window.setTimeout(() => document.getElementById("member")?.scrollIntoView({ behavior: "smooth" }), 50);
  }

  return (
    <div className="modal" role="presentation">
      <div className="modal__scrim" onClick={closeLink} aria-hidden="true" />
      <div ref={dialogRef} className="modal__dialog liquid-glass" role="dialog" aria-modal="true" aria-labelledby="link-title">
        <button type="button" className="modal__close" onClick={closeLink} aria-label="Đóng">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <p className="modal__eyebrow font-instrument" lang="en">
          Welcome to The Last Candle
        </p>
        <RegisterForm
          titleId="link-title"
          mode="new"
          autoFocus
          onSuccess={handleSuccess}
          onCancel={closeLink}
          cancelLabel="Để sau"
        />
      </div>
    </div>
  );
}
