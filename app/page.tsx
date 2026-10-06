import Dashboard from "@/components/Dashboard";
import Hero from "@/components/Hero";
import LinkModal from "@/components/LinkModal";
import ContactSection from "@/components/ContactSection";
import { MemberProvider } from "@/components/MemberProvider";
import NewsFeed from "@/components/NewsFeed";
import QuoteSection from "@/components/QuoteSection";
import SiteNav from "@/components/SiteNav";

export default function Home() {
  return (
    <MemberProvider>
      <div className="app">
        <SiteNav />
        <Hero />
        <LinkModal />

        <section className="members" id="member" aria-labelledby="members-title">
          <header className="members__intro">
            <p className="eyebrow">Khu vực thành viên</p>
            <h2 id="members-title" className="members__title">
              <span className="font-instrument" lang="en">
                Your <em>thirty days</em>, at a glance.
              </span>
              <span className="members__title-vi">Khối lượng giao dịch 30 ngày của bạn.</span>
            </h2>
            <p className="members__lead">
              Nhập UID BingX đã đăng ký qua link đối tác của cộng đồng cùng Gmail nhận thông báo để theo dõi khối lượng
              từng ngày. Nếu khối
              lượng 14 ngày gần nhất bằng 0, bạn sẽ nhận email cảnh báo; sau 24 giờ vẫn bằng 0, bạn sẽ bị xoá khỏi nhóm
              Telegram.
            </p>
          </header>

          <div className="layout">
            <div className="primary">
              <Dashboard />

              <ol className="rules" id="rules" aria-label="Quy định thành viên">
                <li className="rule">
                  <span className="rule__num num">01</span>
                  <h3 className="rule__title">Liên kết UID</h3>
                  <p className="rule__text">Nhập UID BingX và Gmail nhận thông báo để hệ thống nhận diện bạn.</p>
                </li>
                <li className="rule">
                  <span className="rule__num num">02</span>
                  <h3 className="rule__title">Kiểm tra hằng ngày</h3>
                  <p className="rule__text">Khối lượng 14 ngày gần nhất bằng 0 sẽ kích hoạt email cảnh báo.</p>
                </li>
                <li className="rule">
                  <span className="rule__num num">03</span>
                  <h3 className="rule__title">Sau 24 giờ</h3>
                  <p className="rule__text">Vẫn không có giao dịch sau cảnh báo, bạn sẽ bị xoá khỏi nhóm Telegram.</p>
                </li>
              </ol>
            </div>

            <aside className="sidebar" id="news">
              <NewsFeed />
            </aside>
          </div>
        </section>

        <QuoteSection />
        <ContactSection />

        <footer className="site-footer">
          <span className="site-footer__brand">The Last Candle</span>
          <p>Dữ liệu khối lượng lấy từ BingX Agent API, có thể trễ khoảng 1 ngày. Trang không thuộc sở hữu của BingX.</p>
        </footer>
      </div>
    </MemberProvider>
  );
}
