"use client";

import { useState } from "react";
import { logout } from "@/lib/api";
import { DEV_MOCKS } from "@/lib/env";

export default function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await logout();
    } finally {
      window.location.assign(DEV_MOCKS ? "/?mock=out" : "/");
    }
  }

  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={handleClick} disabled={pending} aria-busy={pending}>
      {pending ? "Đang thoát…" : "Đăng xuất"}
    </button>
  );
}
