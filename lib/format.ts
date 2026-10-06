const usdtFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 1234.5 → "1,234.50" */
export function fmtAmount(value: number): string {
  return usdtFormatter.format(Number.isFinite(value) ? value : 0);
}

/** 1234.5 → "1,234.50 USDT" */
export function fmtUSDT(value: number): string {
  return `${fmtAmount(value)} USDT`;
}

/** 12345 → "12.3K" */
export function fmtCompact(value: number): string {
  return compactFormatter.format(Number.isFinite(value) ? value : 0);
}

/** Accepts ISO strings, unix seconds or unix milliseconds. Returns ms, or NaN. */
export function toTime(value: string | number): number {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const trimmed = value.trim();
  if (trimmed !== "" && /^\d+$/.test(trimmed)) return toTime(Number(trimmed));
  return Date.parse(trimmed);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "vừa xong", "5 phút trước", "3 giờ trước", "2 ngày trước", or dd/mm/yyyy beyond 30 days. */
export function timeAgo(value: string | number, now: number = Date.now()): string {
  const t = toTime(value);
  if (!Number.isFinite(t)) return "";
  const seconds = Math.max(0, Math.floor((now - t) / 1000));
  if (seconds < 45) return "vừa xong";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  const d = new Date(t);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "2026-10-07" → "07/10" (string-based, no timezone shift). */
export function fmtDay(day: string): string {
  const [, m, d] = day.split("-");
  return m && d ? `${d}/${m}` : day;
}

/** ms → "14:05 08/10/2026" in the viewer's local time. */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** ms → "14:05 08/10" */
export function fmtDateTimeShort(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

/** ms → "08/10/2026" */
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
