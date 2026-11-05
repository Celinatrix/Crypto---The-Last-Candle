import ContactSection from "@/frontend/components/ContactSection";
import Hero from "@/frontend/components/Hero";
import Journey from "@/frontend/components/Journey";
import LinkModal from "@/frontend/components/LinkModal";
import { MemberProvider } from "@/frontend/components/MemberProvider";
import MembersSection from "@/frontend/components/MembersSection";
import PremiumSection from "@/frontend/components/PremiumSection";
import QuoteSection from "@/frontend/components/QuoteSection";
import SiteNav from "@/frontend/components/SiteNav";

export default function Home() {
  return (
    <MemberProvider>
      <div className="app">
        <SiteNav />
        <LinkModal />
        <main>
          <Hero />
          <Journey members={<MembersSection />} premium={<PremiumSection />} />
          <QuoteSection />
          <ContactSection />
        </main>

        <footer className="site-footer">
          <span className="site-footer__brand">The Last Candle</span>
          <p>Dữ liệu khối lượng lấy từ BingX Agent API, có thể trễ khoảng 1 ngày. Trang không thuộc sở hữu của BingX.</p>
        </footer>
      </div>
    </MemberProvider>
  );
}
