import { fmtDateTime, fmtDayFull, fmtUSD } from "./format";
import { getCycleProgress, PREMIUM_RULE, type CycleProgress } from "./premium";
import type { Member, VolumeSummary } from "./types";

export type Tone = "ok" | "neutral" | "warn" | "danger";

export interface MemberState {
  label: string;
  tone: Tone;
  noteTitle: string;
  noteBody: string;
  /** Short on-page warning shown at the top of the card (day ≥ 10 or grace). */
  alert?: string;
  /** ms timestamp shown next to the pill (grace deadline) */
  deadline?: number;
  progress: CycleProgress | null;
}

const REQ = fmtUSD(PREMIUM_RULE.requiredUsd);

export function getMemberState(member: Member, volume: VolumeSummary | null, now: number): MemberState {
  const progress = volume ? getCycleProgress(member.joinedAt, volume.daily, now) : null;

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

  if (!progress) {
    return {
      label: "Đang chờ dữ liệu",
      tone: "neutral",
      noteTitle: "Đang chờ dữ liệu từ BingX.",
      noteBody:
        "UID đã được liên kết. Khối lượng giao dịch sẽ hiển thị sau lần đồng bộ tiếp theo, thường trong vòng 24 giờ.",
      progress,
    };
  }

  const p = progress;
  const perDay = fmtUSD(p.perDay);

  const g = p.grace;
  if (g) {
    return {
      label: "Gia hạn 24 giờ",
      tone: "danger",
      deadline: g.deadline,
      alert: `Chu kỳ #${g.index} chưa đạt — cần thêm ${fmtUSD(g.remaining)} trước ${fmtDateTime(g.deadline)}.`,
      noteTitle: `Gia hạn 24 giờ: cần thêm ${fmtUSD(g.remaining)}.`,
      noteBody: `Chu kỳ #${g.index} đã kết thúc với ${fmtUSD(g.volume)} / ${REQ}. Nếu đến ${fmtDateTime(g.deadline)} vẫn chưa đủ, bạn sẽ bị xoá khỏi nhóm Premium.`,
      progress,
    };
  }

  switch (p.phase) {
    case "met":
      return {
        label: "Đã đạt yêu cầu",
        tone: "ok",
        noteTitle: `Bạn đã đạt ${REQ} cho chu kỳ #${p.index}.`,
        noteBody: `Chu kỳ tiếp theo bắt đầu ngày ${fmtDayFull(nextDay(p.endDay))}. Tiếp tục giao dịch đều đặn để giữ chỗ trong nhóm Premium.`,
        progress,
      };
    case "warning":
      return {
        label: "Sắp hết hạn",
        tone: "warn",
        alert: `Còn ${p.daysLeft} ngày — cần thêm ${fmtUSD(p.remaining)} (khoảng ${perDay}/ngày).`,
        noteTitle: `Cảnh báo: còn ${p.daysLeft} ngày, cần thêm ${fmtUSD(p.remaining)}.`,
        noteBody: `Bạn đang ở ngày ${p.dayOfCycle}/${PREMIUM_RULE.cycleDays} và chưa đạt ${REQ}. Hãy giao dịch khoảng ${perDay} mỗi ngày để kịp hạn ${fmtDateTime(p.deadline)}. Quá hạn sẽ có thêm 24 giờ gia hạn, sau đó bị xoá khỏi nhóm.`,
        progress,
      };
    default:
      return {
        label: "Đang hoạt động",
        tone: "ok",
        noteTitle: `Còn ${p.daysLeft} ngày để đạt ${REQ}.`,
        noteBody: `Bạn cần thêm ${fmtUSD(p.remaining)}, trung bình khoảng ${perDay} mỗi ngày. Từ ngày ${PREMIUM_RULE.warnFromDay} của chu kỳ, nếu chưa đủ bạn sẽ nhận cảnh báo.`,
        progress,
      };
  }
}

function nextDay(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
