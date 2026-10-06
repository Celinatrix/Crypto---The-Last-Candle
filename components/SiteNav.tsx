"use client";

import { useEffect, useRef, useState } from "react";
import LogoutButton from "./LogoutButton";

export interface NavUser {
  label: string;
  photoUrl: string | null;
  initial: string;
}

const LINKS = [
  { href: "#member", label: "Khối lượng" },
  { href: "#news", label: "Tin tức" },
  { href: "#rules", label: "Quy định" },
  { href: "#manifesto", label: "Cộng đồng" },
] as const;

export default function SiteNav({ user }: { user: NavUser | null }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstLinkRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onResize = () => window.innerWidth >= 768 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <header className={`nav${scrolled ? " nav--scrolled" : ""}${open ? " nav--open" : ""}`}>
        <a className="nav__brand" href="#top" onClick={close}>
          The Last Candle
        </a>

        <nav className="nav__links" aria-label="Điều hướng chính">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="nav__right">
          {user ? <UserChip user={user} /> : (
            <a className="pill-btn pill-btn--sm" href="#member">
              Đăng nhập
            </a>
          )}
        </div>

        <button
          ref={toggleRef}
          type="button"
          className={`burger${open ? " is-open" : ""}`}
          aria-label={open ? "Đóng menu" : "Mở menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <div className={`menu-scrim${open ? " is-open" : ""}`} onClick={close} aria-hidden="true" />
      <div
        id="mobile-menu"
        className={`menu${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        inert={!open}
      >
        <nav className="menu__links" aria-label="Điều hướng">
          {LINKS.map((l, i) => (
            <a
              key={l.href}
              ref={i === 0 ? firstLinkRef : undefined}
              href={l.href}
              onClick={close}
              style={{ transitionDelay: open ? `${150 + i * 75}ms` : "0ms" }}
            >
              {l.label}
            </a>
          ))}
        </nav>
        <div className="menu__foot" style={{ transitionDelay: open ? "450ms" : "0ms" }}>
          {user ? (
            <>
              <UserChip user={user} withLogout={false} />
              <LogoutButton />
            </>
          ) : (
            <a className="pill-btn" href="#member" onClick={close}>
              Đăng nhập với Telegram
            </a>
          )}
        </div>
      </div>
    </>
  );
}

function UserChip({ user, withLogout = true }: { user: NavUser; withLogout?: boolean }) {
  return (
    <div className="user">
      {user.photoUrl ? (
        <img
          className="avatar"
          src={user.photoUrl}
          alt={`Ảnh đại diện Telegram của ${user.label}`}
          width={32}
          height={32}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="avatar avatar--fallback" aria-hidden="true">
          {user.initial}
        </span>
      )}
      <span className="user__name">{user.label}</span>
      {withLogout && <LogoutButton />}
    </div>
  );
}
