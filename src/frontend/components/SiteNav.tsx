"use client";

import { useEffect, useRef, useState } from "react";
import LogoutButton from "./LogoutButton";
import { useLinkedMember, useMember } from "./MemberProvider";

interface NavLink {
  href: string;
  label: string;
  accent?: boolean;
}

const LINKS: readonly NavLink[] = [
  { href: "#member", label: "Khối lượng" },
  { href: "#premium", label: "Tham gia nhóm Premium - Signal", accent: true },
  { href: "#news", label: "Tin tức" },
  { href: "#rules", label: "Quy định" },
  { href: "#manifesto", label: "Cộng đồng" },
  { href: "#contact", label: "Liên hệ" },
];

export default function SiteNav() {
  const { state, openLink } = useMember();
  const member = useLinkedMember();
  const uid = member ? String(member.uid) : null;
  const notLinked = state.kind === "ready" && !member;
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
    const onResize = () => window.innerWidth >= 1280 && setOpen(false);
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
            <a key={l.href} href={l.href} className={l.accent ? "is-accent" : undefined}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="nav__right">
          {uid && (
            <div className="user">
              <UidChip uid={uid} />
              <LogoutButton />
            </div>
          )}
          {notLinked && (
            <button type="button" className="pill-btn pill-btn--sm" onClick={openLink}>
              Liên kết UID
            </button>
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
              className={l.accent ? "is-accent" : undefined}
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
          {uid && (
            <>
              <UidChip uid={uid} />
              <LogoutButton />
            </>
          )}
          {notLinked && (
            <button
              type="button"
              className="pill-btn"
              onClick={() => {
                close();
                openLink();
              }}
            >
              Liên kết UID BingX
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function UidChip({ uid }: { uid: string }) {
  return (
    <span className="uid-chip">
      <span className="uid-chip__label">UID</span>
      <span className="num">{uid}</span>
    </span>
  );
}
