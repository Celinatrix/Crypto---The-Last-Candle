/**
 * Vietnam time (Asia/Ho_Chi_Minh) helpers. Vietnam has no daylight saving,
 * so it is always UTC+7 — a fixed offset keeps server and browser output identical.
 */
export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
export const VN_LABEL = "giờ Việt Nam (GMT+7)";

const WEEKDAYS = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const pad = (n: number) => String(n).padStart(2, "0");

export interface VnParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

export function vnParts(ms: number): VnParts {
  const d = new Date(ms + VN_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: WEEKDAYS[d.getUTCDay()] ?? "",
  };
}

/** "YYYY-MM-DD" of the Vietnam calendar day */
export function vnDayKey(ms: number): string {
  const p = vnParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "19:30" */
export function vnClock(ms: number): string {
  const p = vnParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "07/10" */
export function vnShortDate(ms: number): string {
  const p = vnParts(ms);
  return `${pad(p.day)}/${pad(p.month)}`;
}

/** "Thứ 4, 07/10/2026" */
export function vnLongDate(ms: number): string {
  const p = vnParts(ms);
  return `${p.weekday}, ${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** Start of the Vietnam calendar day containing `ms`, plus `hour` hours (UTC ms). */
export function vnDayAt(ms: number, hour: number): number {
  const p = vnParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, hour) - VN_OFFSET_MS;
}
