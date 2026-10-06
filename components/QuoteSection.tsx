"use client";

import { useEffect, useRef } from "react";

const RAINBOW = "https://soft-zoom-63098134.figma.site/_assets/v11/8d520a7515d06cbfc403d0125e3d05b1a7ccd29c.png";
const CLOUD = "https://soft-zoom-63098134.figma.site/_assets/v11/0d6dfd3f90b930f21726f2ed56a3320d79b7a797.png";

const CLOUD_OFFSET = 200;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (current: number, target: number, factor: number) => current + (target - current) * factor;

export default function QuoteSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const rainbowRef = useRef<HTMLImageElement>(null);
  const leftRef = useRef<HTMLImageElement>(null);
  const rightRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const rainbow = rainbowRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!section || !rainbow || !left || !right) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cur = { rainbowY: 120, cloudX: CLOUD_OFFSET, cloudY: 0 };
    let raf = 0;
    let running = false;

    const targets = () => {
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight;
      const progress = clamp01((vh - rect.top) / (vh + rect.height));
      const inView = progress > 0.12 && progress < 0.92;
      return {
        rainbowY: 120 + (-160 - 120) * progress,
        cloudX: inView ? 0 : CLOUD_OFFSET,
        cloudY: progress * -50,
      };
    };

    const apply = () => {
      const opacity = clamp01(1 - cur.cloudX / CLOUD_OFFSET);
      rainbow.style.transform = `translate3d(0, ${cur.rainbowY}px, 0)`;
      left.style.transform = `translate3d(${-cur.cloudX}px, ${cur.cloudY}px, 0)`;
      right.style.transform = `translate3d(${cur.cloudX}px, ${cur.cloudY}px, 0) scaleX(-1)`;
      left.style.opacity = right.style.opacity = String(opacity);
    };

    const frame = () => {
      const t = targets();
      if (reduced) Object.assign(cur, t);
      else {
        cur.rainbowY = lerp(cur.rainbowY, t.rainbowY, 0.06);
        cur.cloudX = lerp(cur.cloudX, t.cloudX, 0.04);
        cur.cloudY = lerp(cur.cloudY, t.cloudY, 0.04);
      }
      apply();
      if (running) raf = requestAnimationFrame(frame);
    };

    apply();
    // Only animate while the section is near the viewport.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !running) {
          running = true;
          raf = requestAnimationFrame(frame);
        } else if (!entry?.isIntersecting && running) {
          running = false;
          cancelAnimationFrame(raf);
          Object.assign(cur, targets());
          apply();
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(section);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return (
    <section ref={sectionRef} className="quote" id="manifesto" aria-labelledby="quote-text">
      <img ref={rainbowRef} className="quote__rainbow" src={RAINBOW} alt="" aria-hidden="true" decoding="async" />
      <img ref={leftRef} className="quote__cloud quote__cloud--left" src={CLOUD} alt="" aria-hidden="true" decoding="async" />
      <img ref={rightRef} className="quote__cloud quote__cloud--right" src={CLOUD} alt="" aria-hidden="true" decoding="async" />

      <figure className="quote__content">
        <blockquote>
          <p id="quote-text" className="quote__text font-instrument" lang="en">
            “The Last Candle was built on a simple belief: a community stays strong when everyone keeps showing up. We
            ask for steady, honest activity — sixty thousand in volume every fourteen days. Day ten brings a reminder;
            a cycle that closes short gets twenty-four more hours, then the seat passes to someone ready to trade with
            us.”
          </p>
          <p className="quote__vi">
            “The Last Candle được xây dựng trên một niềm tin: cộng đồng vững mạnh khi mỗi người đều hiện diện. Không cần
            lệnh lớn, chỉ cần giao dịch đều đặn: 60.000$ khối lượng mỗi 14 ngày. Ngày thứ 10 sẽ có lời nhắc; chu kỳ chưa
            đạt được thêm 24 giờ, sau đó chỗ ngồi sẽ dành cho người sẵn sàng đồng hành.”
          </p>
        </blockquote>
        <figcaption className="quote__by">Ban quản trị — The Last Candle</figcaption>
      </figure>
    </section>
  );
}
