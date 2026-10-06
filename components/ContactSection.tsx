"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { copyText } from "@/lib/clipboard";

interface Contact {
  key: string;
  label: string;
  value: string;
  href: string;
  /** Text copied to the clipboard */
  copy: string;
  icon: ReactNode;
  external: boolean;
}

const CONTACTS: Contact[] = [
  {
    key: "zalo",
    label: "Zalo",
    value: "0372 927 303",
    href: "https://zalo.me/0372927303",
    copy: "0372927303",
    external: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5A8.5 8.5 0 1 1 21 11.5Z" strokeLinejoin="round" />
        <path d="M8.5 9h4l-4 5h4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M15.5 9v5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "telegram",
    label: "Telegram",
    value: "@THANHKIET3004",
    href: "https://t.me/THANHKIET3004",
    copy: "@THANHKIET3004",
    external: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="m21.5 4.5-3.2 15.1c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.1 13.4 1.4 11.9c-1-.3-1-1 .2-1.5L20 3.3c.8-.3 1.6.2 1.5 1.2Z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    key: "gmail",
    label: "Gmail",
    value: "bqtkietag123@gmail.com",
    href: "mailto:bqtkietag123@gmail.com",
    copy: "bqtkietag123@gmail.com",
    external: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m3.5 7 8.5 6 8.5-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export default function ContactSection() {
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(c: Contact) {
    const ok = await copyText(c.copy);
    setCopied({ key: c.key, ok });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <section className="contact" id="contact" aria-labelledby="contact-title">
      <header className="contact__intro">
        <p className="eyebrow">Liên hệ</p>
        <h2 id="contact-title" className="contact__title">
          <span className="font-instrument" lang="en">
            Get in <em>touch</em>.
          </span>
          <span className="contact__title-vi">Liên hệ trực tiếp quản trị viên The Last Candle.</span>
        </h2>
      </header>

      <ul className="contact__list">
        {CONTACTS.map((c) => (
          <li key={c.key} className="contact__card liquid-glass">
            <a
              className="contact__link"
              href={c.href}
              {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            >
              <span className="contact__icon">{c.icon}</span>
              <span className="contact__text">
                <span className="label">{c.label}</span>
                <span className="contact__value">{c.value}</span>
              </span>
              <span className="contact__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
            <button
              type="button"
              className="contact__copy"
              onClick={() => void copy(c)}
              aria-label={`Sao chép ${c.label}: ${c.copy}`}
            >
              {copied?.key === c.key ? (copied.ok ? "Đã chép" : "Không chép được") : "Sao chép"}
            </button>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">
        {copied ? (copied.ok ? "Đã sao chép vào bộ nhớ tạm." : "Không sao chép được, hãy chép thủ công.") : ""}
      </p>
    </section>
  );
}
