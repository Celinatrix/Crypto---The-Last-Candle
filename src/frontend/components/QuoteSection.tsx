/** The community's statement of purpose, lit by candlelight drawn in CSS. */
export default function QuoteSection() {
  return (
    <section className="quote" id="manifesto" aria-labelledby="quote-text">
      <figure className="quote__content">
        <blockquote>
          <p id="quote-text" className="quote__text font-instrument" lang="en">
            “The Last Candle was built on a simple belief: a community stays strong when everyone keeps showing up.”
          </p>
          <p className="quote__vi">
            “The Last Candle được xây dựng trên một niềm tin: cộng đồng vững mạnh khi mỗi người đều hiện diện.”
          </p>
        </blockquote>
        <figcaption className="quote__by">Ban quản trị — The Last Candle</figcaption>
      </figure>
    </section>
  );
}
