import { fmtDate, fmtDateTime, toTime } from "./format";
import type { Member, VolumeSummary } from "./types";

export type Tone = "ok" | "neutral" | "warn" | "danger";

export interface MemberState {
  label: string;
  tone: Tone;
  noteTitle: string;
  noteBody: string;
  /** ms timestamp; only set for warned members */
  deadline?: number;
}

const DAY = 86_400_000;
const REVIEW_WINDOW_DAYS = 14;

export function getMemberState(member: Member, volume: VolumeSummary | null, now: number): MemberState {
  if (member.status === "kicked") {
    return {
      label: "Đã bị xoá khỏi nhóm",
      tone: "danger",
      noteTitle: "Bạn đã bị xoá khỏi nhóm Telegram.",
      noteBody:
        "Tài khoản không có khối lượng giao dịch trong 14 ngày và đã quá 24 giờ kể từ email cảnh báo. Nếu muốn quay lại, hãy liên hệ quản trị viên cộng đồng.",
    };
  }

  if (member.status === "warned") {
    const warnedAt = member.warnedAt ? toTime(member.warnedAt) : NaN;
    const deadline = Number.isFinite(warnedAt) ? warnedAt + DAY : undefined;
    const tradedSince = (volume?.total14 ?? 0) > 0;
    return {
      label: "Đã gửi cảnh báo",
      tone: "warn",
      deadline,
      noteTitle: tradedSince
        ? "Đã ghi nhận giao dịch mới."
        : deadline
          ? `Hãy giao dịch trước ${fmtDateTime(deadline)}.`
          : "Hãy giao dịch càng sớm càng tốt.",
      noteBody: tradedSince
        ? "Khối lượng 14 ngày của bạn đã lớn hơn 0. Trạng thái cảnh báo sẽ được gỡ ở lần kiểm tra tiếp theo."
        : `Email cảnh báo đã được gửi tới ${member.email}. Nếu khối lượng 14 ngày vẫn bằng 0 sau 24 giờ, bạn sẽ bị xoá khỏi nhóm. Dữ liệu BingX có thể trễ khoảng 1 ngày, vì vậy đừng đợi đến sát hạn.`,
    };
  }

  const joined = toTime(member.joinedAt);
  const reviewStarts = Number.isFinite(joined) ? joined + REVIEW_WINDOW_DAYS * DAY : 0;
  const isNew = now < reviewStarts;

  if (!volume) {
    return {
      label: "Thành viên mới",
      tone: "neutral",
      noteTitle: "Đang chờ dữ liệu từ BingX.",
      noteBody:
        "UID đã được liên kết. Khối lượng giao dịch sẽ hiển thị sau lần đồng bộ tiếp theo, thường trong vòng 24 giờ.",
    };
  }

  if (volume.total14 > 0) {
    return {
      label: "Đang hoạt động",
      tone: "ok",
      noteTitle: "Bạn đang đáp ứng quy định của nhóm.",
      noteBody:
        "Khối lượng 14 ngày gần nhất lớn hơn 0. Chỉ cần duy trì giao dịch đều đặn để giữ chỗ trong cộng đồng.",
    };
  }

  if (isNew) {
    return {
      label: "Thành viên mới",
      tone: "neutral",
      noteTitle: "Chào mừng bạn đến với cộng đồng.",
      noteBody: `Hệ thống bắt đầu xét khối lượng từ ngày ${fmtDate(reviewStarts)}. Hãy thực hiện giao dịch đầu tiên trên BingX trước thời điểm đó.`,
    };
  }

  return {
    label: "Sắp bị cảnh báo",
    tone: "warn",
    noteTitle: "Chưa có giao dịch nào trong 14 ngày gần nhất.",
    noteBody: `Ở lần kiểm tra tới, bạn sẽ nhận email cảnh báo tại ${member.email}. Một lệnh giao dịch bất kỳ trên BingX là đủ để giữ trạng thái hoạt động.`,
  };
}
