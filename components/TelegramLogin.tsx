"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DEV_MOCKS, TELEGRAM_BOT_USERNAME } from "@/lib/env";

type WidgetState = "loading" | "ready" | "failed";

export default function TelegramLogin() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<WidgetState>("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !TELEGRAM_BOT_USERNAME) return;

    container.replaceChildren();
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", TELEGRAM_BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "10");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-auth-url", `${window.location.origin}/api/auth/telegram`);
    script.onload = () => setState("ready");
    script.onerror = () => setState("failed");
    container.appendChild(script);

    return () => container.replaceChildren();
  }, []);

  if (!TELEGRAM_BOT_USERNAME && !DEV_MOCKS) {
    return (
      <p className="alert alert--danger" role="alert">
        Chưa cấu hình bot Telegram (NEXT_PUBLIC_TELEGRAM_BOT_USERNAME).
      </p>
    );
  }

  return (
    <div className="tg-login" aria-busy={state === "loading"}>
      {state === "loading" && TELEGRAM_BOT_USERNAME && (
        <span className="skeleton tg-login__placeholder" aria-hidden="true" />
      )}
      <div ref={containerRef} className="tg-login__widget" />
      {state === "failed" && (
        <p className="alert alert--danger" role="alert">
          Không tải được nút đăng nhập Telegram. Hãy tắt trình chặn quảng cáo hoặc thử lại sau.
        </p>
      )}
      {DEV_MOCKS && (
        <Link className="btn btn--ghost" href="/?mock=new">
          Đăng nhập thử (DEV)
        </Link>
      )}
    </div>
  );
}
