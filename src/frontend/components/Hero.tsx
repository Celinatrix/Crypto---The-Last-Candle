"use client";

import { useEffect, useRef, useState } from "react";
import { useLinkedMember, useMember } from "./MemberProvider";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260613_180732_a54afbf6-b30d-470e-861f-669871f09f67.mp4";

/** The video is 14 MB: only start it on a large screen with a good connection, after the page has loaded. */
function canPlayVideo(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return (
    window.matchMedia("(min-width: 768px)").matches &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !connection?.saveData &&
    !/2g|3g/.test(connection?.effectiveType ?? "")
  );
}

export default function Hero() {
  const { expiresAt, openLink } = useMember();
  // Known as soon as the page mounts, so the buttons do not change once the member data arrives.
  const returning = useLinkedMember() !== null || expiresAt !== null;
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [videoOn, setVideoOn] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!canPlayVideo()) return;
    const begin = () => setVideoOn(true);
    if (document.readyState === "complete") {
      const id = window.setTimeout(begin, 300);
      return () => window.clearTimeout(id);
    }
    window.addEventListener("load", begin, { once: true });
    return () => window.removeEventListener("load", begin);
  }, []);

  // Nothing decodes a 4K video while the hero is scrolled out of view.
  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;
    if (!videoOn || !section || !video) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, [videoOn]);

  function toggleSound() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted && video.paused) void video.play().catch(() => undefined);
  }

  return (
    <section ref={sectionRef} className="hero" id="top">
      {videoOn && (
        <video
          ref={videoRef}
          className={`hero__video${playing ? " is-playing" : ""}`}
          src={VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          onPlaying={() => setPlaying(true)}
        />
      )}
      <div className="hero__overlay" aria-hidden="true" />

      <div className="hero__content">
        <p className="hero__eyebrow">Đối tác BingX · Khu vực thành viên</p>
        <h1 className="hero__title font-instrument text-glow">
          <span lang="en">Steady hands. Lasting volume.</span>
        </h1>
        <p className="hero__sub">
          Theo dõi khối lượng giao dịch BingX của bạn trong từng chu kỳ nửa tháng và nhận nhắc hạn qua Gmail.
        </p>
        <div className="hero__actions">
          {returning ? (
            <a className="pill-btn" href="#member">
              Xem khối lượng của bạn
            </a>
          ) : (
            <>
              <a className="pill-btn" href="#premium">
                Xem cách tham gia
              </a>
              <button type="button" className="btn btn--ghost hero__link" onClick={openLink}>
                Liên kết UID BingX
              </button>
            </>
          )}
        </div>
      </div>

      {playing && (
        <button
          type="button"
          className={`sound${muted ? "" : " is-on"}`}
          onClick={toggleSound}
          aria-pressed={!muted}
          aria-label={muted ? "Bật âm thanh video nền" : "Tắt âm thanh video nền"}
        >
          <span className="sound__ring" aria-hidden="true">
            <span className="sound__bar" />
          </span>
          <span className="sound__text" aria-hidden="true">
            <span>Experience</span>
            <span>with sound</span>
          </span>
        </button>
      )}
    </section>
  );
}
