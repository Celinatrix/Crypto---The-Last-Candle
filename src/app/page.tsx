import ContactSection from "@/frontend/components/ContactSection";
import Hero from "@/frontend/components/Hero";
import Journey from "@/frontend/components/Journey";
import LinkModal from "@/frontend/components/LinkModal";
import { MemberProvider } from "@/frontend/components/MemberProvider";
import MembersSection from "@/frontend/components/MembersSection";
import PremiumSection from "@/frontend/components/PremiumSection";
import QuoteSection from "@/frontend/components/QuoteSection";
import SignalsSection from "@/frontend/components/SignalsSection";
import SiteNav from "@/frontend/components/SiteNav";
import Wordmark from "@/frontend/components/Wordmark";

export default function Home() {
  return (
    <MemberProvider>
      <div className="app">
        <SiteNav />
        <LinkModal />
        <main>
          <Hero />
          <Journey members={<MembersSection />} premium={<PremiumSection />} />
          <SignalsSection />
          <QuoteSection />
          <ContactSection />
        </main>

        <footer className="site-footer">
          <span className="site-footer__brand">
            <Wordmark />
          </span>
          <p>Dữ liệu khối lượng lấy từ BingX Agent API, có thể trễ khoảng 1 ngày. Trang không thuộc sở hữu của BingX.</p>
          <p className="site-footer__legal">
            Giao dịch tiền mã hoá, nhất là có đòn bẩy, có rủi ro cao và có thể mất toàn bộ vốn. Nội dung trên trang, kể cả tín
            hiệu trong nhóm Premium, không phải lời khuyên đầu tư.
          </p>
          <p className="site-footer__legal">
            The Last Candle là đối tác giới thiệu của BingX và có thể nhận hoa hồng khi bạn đăng ký qua link đối tác.
          </p>
        </footer>
      </div>
    </MemberProvider>
  );
}
