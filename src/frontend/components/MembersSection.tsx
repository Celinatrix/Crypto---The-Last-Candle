import Dashboard from "./Dashboard";
import NewsPanel from "./NewsPanel";

export default function MembersSection() {
  return (
    <section className="members" id="member" aria-labelledby="members-title">
      <header className="members__intro">
        <p className="eyebrow">Khu vực thành viên</p>
        <h2 id="members-title" className="members__title">
          <span className="font-instrument" lang="en">
            Your <em>cycle</em>, at a glance.
          </span>
          <span className="members__title-vi">Khối lượng giao dịch theo chu kỳ của bạn.</span>
        </h2>
        <p className="members__lead">
          Mỗi tháng có 2 chu kỳ: ngày 1–14 và ngày 15–cuối tháng. Mỗi chu kỳ cần tối thiểu 68.686$ khối lượng. Đạt sớm
          thì được nghỉ đến hết chu kỳ, volume không chuyển sang chu kỳ sau.
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
              <h3 className="rule__title">68.686$ mỗi nửa tháng</h3>
              <p className="rule__text">
                Chu kỳ 1–14 và 15–cuối tháng. Đạt sớm thì phần còn lại của chu kỳ là thời gian nghỉ, volume không
                chuyển sang chu kỳ sau.
              </p>
            </li>
            <li className="rule">
              <span className="rule__num num">03</span>
              <h3 className="rule__title">Cảnh báo &amp; gia hạn 24 giờ</h3>
              <p className="rule__text">
                Còn 3 ngày mà chưa đủ sẽ có email nhắc. Hết chu kỳ còn 24 giờ gia hạn. Sau đó quản trị viên xem xét việc xoá
                khỏi nhóm.
              </p>
            </li>
          </ol>
        </div>

        <div className="sidebar" id="news">
          <NewsPanel />
        </div>
      </div>
    </section>
  );
}
