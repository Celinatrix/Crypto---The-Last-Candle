import { fmtDateTime, fmtDayFull, fmtUSD } from "./format";
import { getCycleProgress, PREMIUM_RULE, type CycleProgress } from "./premium";
import type { Member, VolumeSummary } from "./types";

export type Tone = "ok" | "neutral" | "warn" | "danger";

export interface MemberState {
  label: string;
  tone: Tone;
  noteTitle: string;
  noteBody: string;
  /** Short on-page message at the top of the card (reached, day ≥ 10, grace, failed). */
  alert?: string;
  /** ms timestamp shown next to the pill */
  deadline?: number;
  progress: CycleProgress | null;
}

const REQ = fmtUSD(PREMIUM_RULE.requiredUsd);

export function getMemberState(member: Member, volume: VolumeSummary | null, now: number): MemberState {
  if (member.status === "kicked") {
    return {
      label: "Đã bị xoá khỏi nhóm",
      tone: "danger",
      noteTitle: "Bạn đã bị xoá khỏi nhóm Premium.",
      noteBody: `Chu kỳ trước không đạt ${REQ} và đã quá 24 giờ gia hạn. Nếu muốn quay lại, hãy liên hệ quản trị viên.`,
      // No live target any more, so the progress card is hidden.
      progress: null,
    };
  }

  const p = volume ? getCycleProgress(member.joinedAt, volume, now) : null;
  if (!p) {
    return {
      label: "Đang chờ dữ liệu",
      tone: "neutral",
      noteTitle: "Đang chờ dữ liệu từ BingX.",
      noteBody:
        "UID đã được liên kết. Khối lượng giao dịch sẽ hiển thị sau lần đồng bộ tiếp theo, thường trong vòng 24 giờ.",
      progress: null,
    };
  }

  const perDay = fmtUSD(p.perDay);

  switch (p.phase) {
    case "rest": {
      const resume = p.nextStartDay ? fmtDayFull(p.nextStartDay) : "";
      const restUntil = p.restUntil ? fmtDayFull(p.restUntil) : "";
      return {
        label: "Đã đạt · đang nghỉ",
        tone: "ok",
        deadline: p.resumesAt,
        alert: `Đã đạt ${REQ} cho chu kỳ #${p.index}${p.metDay ? ` vào ngày ${fmtDayFull(p.metDay)}` : ""}. Bạn đang nghỉ — volume sẽ được tính lại từ ${resume}.`,
        noteTitle: `Đang nghỉ đến hết ngày ${restUntil}.`,
        noteBody: `Volume giao dịch trong thời gian nghỉ không được tính. Chu kỳ #${p.index + 1} bắt đầu ngày ${resume}, khi đó bạn lại có ${PREMIUM_RULE.cycleDays} ngày để đạt ${REQ}.`,
        progress: p,
      };
    }
    case "grace":
      return {
        label: "Gia hạn 24 giờ",
        tone: "danger",
        deadline: p.graceDeadline,
        alert: `Chu kỳ #${p.index} chưa đạt — cần thêm ${fmtUSD(p.remaining)} trước ${fmtDateTime(p.graceDeadline)}.`,
        noteTitle: `Gia hạn 24 giờ: cần thêm ${fmtUSD(p.remaining)}.`,
        noteBody: `Hết 14 ngày bạn đạt ${fmtUSD(p.volume)} / ${REQ}. Đạt đủ trong 24 giờ gia hạn thì vẫn được nghỉ 3 ngày; nếu đến ${fmtDateTime(p.graceDeadline)} vẫn chưa đủ, bạn sẽ bị xoá khỏi nhóm Premium.`,
        progress: p,
      };
    case "failed":
      return {
        label: "Không đạt yêu cầu",
        tone: "danger",
        alert: `Chu kỳ #${p.index} không đạt ${REQ} và đã hết 24 giờ gia hạn.`,
        noteTitle: "Bạn sẽ bị xoá khỏi nhóm Premium theo quy định.",
        noteBody: `Chu kỳ #${p.index} kết thúc với ${fmtUSD(p.volume)} / ${REQ}. Nếu bạn nghĩ có nhầm lẫn (dữ liệu BingX có thể trễ khoảng 1 ngày), hãy liên hệ quản trị viên.`,
        progress: p,
      };
    case "warning":
      return {
        label: "Sắp hết hạn",
        tone: "warn",
        alert: `Còn ${p.daysLeft} ngày — cần thêm ${fmtUSD(p.remaining)} (khoảng ${perDay}/ngày).`,
        noteTitle: `Cảnh báo: còn ${p.daysLeft} ngày, cần thêm ${fmtUSD(p.remaining)}.`,
        noteBody: `Bạn đang ở ngày ${p.dayOfCycle}/${PREMIUM_RULE.cycleDays} và chưa đạt ${REQ}. Hãy giao dịch khoảng ${perDay} mỗi ngày để kịp hạn ${fmtDateTime(p.deadline)}. Quá hạn sẽ có thêm 24 giờ gia hạn, sau đó bị xoá khỏi nhóm.`,
        progress: p,
      };
    default:
      return {
        label: "Đang hoạt động",
        tone: "ok",
        noteTitle: `Còn ${p.daysLeft} ngày để đạt ${REQ}.`,
        noteBody: `Bạn cần thêm ${fmtUSD(p.remaining)}, trung bình khoảng ${perDay} mỗi ngày. Đạt sớm thì những ngày còn lại cộng thêm 3 ngày sẽ là thời gian nghỉ. Từ ngày ${PREMIUM_RULE.warnFromDay}, nếu chưa đủ bạn sẽ nhận cảnh báo.`,
        progress: p,
      };
  }
}
