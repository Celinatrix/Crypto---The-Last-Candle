import Dashboard from "@/components/Dashboard";
import Hero from "@/components/Hero";
import NewsFeed from "@/components/NewsFeed";
import QuoteSection from "@/components/QuoteSection";
import SiteNav, { type NavUser } from "@/components/SiteNav";
import TelegramLogin from "@/components/TelegramLogin";
import { DEV_MOCKS } from "@/lib/env";
import { getSession } from "@/lib/session";
import type { SessionUser } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function resolveUser(searchParams: SearchParams): Promise<SessionUser | null> {
  if (process.env.NODE_ENV === "development" && DEV_MOCKS) {
    const { MOCK_USER, parseScenario } = await import("@/lib/mocks");
    const mock = (await searchParams).mock;
    return parseScenario(typeof mock === "string" ? mock : null) === "out" ? null : MOCK_USER;
  }
  return getSession();
}

function toNavUser(user: SessionUser): NavUser {
  return {
    label: user.username ? `@${user.username}` : user.firstName,
    photoUrl: user.photoUrl,
    initial: (user.firstName || user.username || "?").charAt(0).toUpperCase(),
  };
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const user = await resolveUser(searchParams);

  return (
    <div className="app">
      <SiteNav user={user ? toNavUser(user) : null} />
      <Hero loggedIn={user !== null} />

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
            Liên kết UID BingX đã đăng ký qua link đối tác của cộng đồng để theo dõi khối lượng từng ngày. Nếu khối
            lượng 14 ngày gần nhất bằng 0, bạn sẽ nhận email cảnh báo; sau 24 giờ vẫn bằng 0, bạn sẽ bị xoá khỏi nhóm
            Telegram.
          </p>
        </header>

        <div className="layout">
          <div className="primary">
            {user ? (
              <Dashboard />
            ) : (
              <section className="card" aria-labelledby="start-title">
                <header className="card__head">
                  <h3 id="start-title" className="card__title">
                    Bắt đầu
                  </h3>
                  <p className="card__text">
                    Đăng nhập bằng Telegram để liên kết UID BingX và xem khối lượng giao dịch của bạn. Trang chỉ nhận
                    tên, ảnh đại diện và @username công khai của bạn.
                  </p>
                </header>
                <TelegramLogin />
              </section>
            )}

            <ol className="rules" id="rules" aria-label="Quy định thành viên">
              <li className="rule">
                <span className="rule__num num">01</span>
                <h3 className="rule__title">Liên kết UID</h3>
                <p className="rule__text">Đăng nhập Telegram, nhập UID BingX và Gmail để hệ thống nhận diện bạn.</p>
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

      <footer className="site-footer">
        <span className="site-footer__brand">The Last Candle</span>
        <p>Dữ liệu khối lượng lấy từ BingX Agent API, có thể trễ khoảng 1 ngày. Trang không thuộc sở hữu của BingX.</p>
      </footer>
    </div>
  );
}
