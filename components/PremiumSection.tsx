"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { useLinkedMember } from "./MemberProvider";

const BINGX_PARTNER_URL = "https://bingx.com/partner/AKITE3004";
const ADMIN_TELEGRAM_URL = "https://t.me/THANHKIET3004";
const ADMIN_ZALO_URL = "https://zalo.me/0372927303";
const MIN_DEPOSIT_USD = 300;

export default function PremiumSection() {
  const member = useLinkedMember();
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const uid = member ? String(member.uid) : "……";
  const template = `Chào AD, mình muốn tham gia nhóm Premium - Signal.\nUID BingX: ${uid}\nTên Telegram: @……`;

  async function copyTemplate() {
    const ok = await copyText(template);
    setCopyState(ok ? "ok" : "fail");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopyState("idle"), 1800);
  }

  return (
    <section className="premium" id="premium" aria-labelledby="premium-title">
      <header className="premium__intro">
        <p className="eyebrow">Premium · Signal</p>
        <h2 id="premium-title" className="premium__title">
          <span className="font-instrument" lang="en">
            Join the <em>Premium</em> signal room.
          </span>
          <span className="premium__title-vi">Tham gia nhóm Premium - Signal</span>
        </h2>
        <p className="premium__lead">
          <span aria-hidden="true">💎 </span>Để được tham gia nhóm Premium Crypto BingX, hoàn thành 3 bước dưới đây.
        </p>
      </header>

      <ol className="premium__steps">
        <li className="step liquid-glass">
          <StepHead n={1} title="Đăng ký tài khoản BingX" />
          <p className="step__text">Đăng ký tài khoản BingX theo link đối tác của cộng đồng.</p>
          <code className="step__link">bingx.com/partner/AKITE3004</code>
          <div className="step__actions">
            <a className="pill-btn" href={BINGX_PARTNER_URL} target="_blank" rel="noopener noreferrer">
              Đăng ký BingX ↗
            </a>
          </div>
        </li>

        <li className="step liquid-glass">
          <StepHead n={2} title="Nạp tiền trade" />
          <p className="step__text">
            Nạp tối thiểu <strong className="num">{MIN_DEPOSIT_USD}$</strong> vào tài khoản để giao dịch.
          </p>
          <p className="step__note">
            Đây là vốn để anh em tự trade, <strong>không phải phí</strong> vào Premium.
          </p>
          <span className="step__badge">Hoàn toàn miễn phí</span>
        </li>

        <li className="step liquid-glass">
          <StepHead n={3} title="Nhắn tin cho AD" />
          <p className="step__text">
            Gửi <strong>UID BingX</strong> và <strong>tên Telegram</strong> <span aria-hidden="true">✈️</span> cho AD để
            được duyệt vào nhóm <span aria-hidden="true">✅</span>
          </p>
          <div className="step__actions">
            <a className="pill-btn" href={ADMIN_TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Nhắn Telegram ↗
            </a>
            <a className="btn btn--ghost" href={ADMIN_ZALO_URL} target="_blank" rel="noopener noreferrer">
              Zalo ↗
            </a>
          </div>
          <button type="button" className="link-btn step__copy" onClick={() => void copyTemplate()}>
            {copyState === "ok" ? "Đã chép tin nhắn mẫu" : copyState === "fail" ? "Không chép được" : "Sao chép tin nhắn mẫu"}
          </button>
          <span className="sr-only" aria-live="polite">
            {copyState === "ok" ? "Đã sao chép tin nhắn mẫu." : ""}
          </span>
        </li>
      </ol>
    </section>
  );
}

function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="step__head">
      <span className="step__check" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="step__num">Bước {n}</span>
      <h3 className="step__title">{title}</h3>
    </div>
  );
}
