"use client";

import { useEffect, useRef, useState } from "react";

const VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260613_180732_a54afbf6-b30d-470e-861f-669871f09f67.mp4";

export default function Hero({ loggedIn }: { loggedIn: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (video && window.matchMedia("(prefers-reduced-motion: reduce)").matches) video.pause();
  }, []);

  function toggleSound() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted && video.paused) void video.play().catch(() => undefined);
  }

  return (
    <section className="hero" id="top">
      <video
        ref={videoRef}
        className="hero__video"
        src={VIDEO_SRC}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <div className="hero__overlay" aria-hidden="true" />

      <div className="hero__content">
        <p className="hero__eyebrow">Đối tác BingX · Khu vực thành viên</p>
        <h1 className="hero__title font-instrument text-glow">
          <span lang="en">Steady hands. Lasting volume.</span>
        </h1>
        <p className="hero__sub">
          Khối lượng giao dịch <strong>30 ngày</strong> của bạn, trong một nơi yên tĩnh. Đăng nhập Telegram, liên kết
          UID BingX và theo dõi mỗi ngày.
        </p>
        <a className="pill-btn hero__cta" href="#member">
          {loggedIn ? "Xem khối lượng của bạn" : "Đăng nhập với Telegram"}
        </a>
      </div>

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
    </section>
  );
}
