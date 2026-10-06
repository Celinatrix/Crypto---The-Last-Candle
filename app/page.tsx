import Dashboard from "@/components/Dashboard";
import Hero from "@/components/Hero";
import LinkModal from "@/components/LinkModal";
import ContactSection from "@/components/ContactSection";
import { MemberProvider } from "@/components/MemberProvider";
import NewsFeed from "@/components/NewsFeed";
import PremiumSection from "@/components/PremiumSection";
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
              Mỗi chu kỳ bạn có 14 ngày để đạt tối thiểu 60.000$ khối lượng giao dịch. Đạt sớm thì những ngày còn lại
              cùng 3 ngày tiếp theo là thời gian nghỉ, volume không được tính. Từ ngày thứ 10 nếu chưa đủ, bạn sẽ thấy
              cảnh báo; hết 14 ngày còn 24 giờ gia hạn, sau đó sẽ bị xoá khỏi nhóm.
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
                  <h3 className="rule__title">60.000$ trong 14 ngày</h3>
                  <p className="rule__text">
                    Đạt sớm thì phần còn lại của chu kỳ và 3 ngày sau đó là thời gian nghỉ, không tính volume.
                  </p>
                </li>
                <li className="rule">
                  <span className="rule__num num">03</span>
                  <h3 className="rule__title">Ngày 10 &amp; gia hạn 24 giờ</h3>
                  <p className="rule__text">
                    Ngày 10 chưa đủ sẽ có cảnh báo. Hết chu kỳ còn 24 giờ gia hạn, sau đó bị xoá khỏi nhóm.
                  </p>
                </li>
              </ol>
            </div>

            <aside className="sidebar" id="news">
              <NewsFeed />
            </aside>
          </div>
        </section>

        <PremiumSection />
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
