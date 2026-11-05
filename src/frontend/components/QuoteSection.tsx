/** The community's statement of purpose, lit by candlelight drawn in CSS. */
export default function QuoteSection() {
  return (
    <section className="quote" id="manifesto" aria-labelledby="quote-text">
      <figure className="quote__content">
        <blockquote>
          <p id="quote-text" className="quote__text font-instrument" lang="en">
            “The Last Candle was built on a simple belief: a community stays strong when everyone keeps showing up. We
            ask for steady, honest activity — 68,686 in volume every half month, then rest until the next cycle. Three days out brings a reminder;
            a cycle that closes short gets twenty-four more hours, then the seat passes to someone ready to trade with
            us.”
          </p>
          <p className="quote__vi">
            “The Last Candle được xây dựng trên một niềm tin: cộng đồng vững mạnh khi mỗi người đều hiện diện. Không cần
            lệnh lớn, chỉ cần giao dịch đều đặn: 68.686$ khối lượng mỗi nửa tháng, đạt rồi thì được nghỉ. Còn 3 ngày sẽ có lời nhắc; chu kỳ chưa
            đạt được thêm 24 giờ, sau đó chỗ ngồi sẽ dành cho người sẵn sàng đồng hành.”
          </p>
        </blockquote>
        <figcaption className="quote__by">Ban quản trị — The Last Candle</figcaption>
      </figure>
    </section>
  );
}
