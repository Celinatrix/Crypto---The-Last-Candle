"use client";

import { useState } from "react";
import { DEV_MOCKS } from "@/lib/env";
import { useMember } from "./MemberProvider";

export default function LogoutButton() {
  const [pending, setPending] = useState(false);
  const { signOut } = useMember();

  async function handleClick() {
    setPending(true);
    try {
      await signOut();
    } finally {
      window.location.assign(DEV_MOCKS ? "/?mock=new" : "/");
    }
  }

  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={handleClick} disabled={pending} aria-busy={pending}>
      {pending ? "Đang thoát…" : "Đăng xuất"}
    </button>
  );
}
