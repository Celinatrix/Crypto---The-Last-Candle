/**
 * Admin report for a finished Premium Crypto cycle, emailed on the 1st and the 15th (by the
 * morning sync, once the last day's volume is in) with an Excel file attached:
 * how many members traded, who reached the target, and who did not (volume + shortfall).
 */
import ExcelJS from "exceljs";
import { calendarCycle, PREMIUM_RULE } from "@/frontend/lib/premium";
import { rpc } from "./db";
import { sendEmail, type EmailMessage } from "./email";

const DAY_MS = 86_400_000;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const isoOf = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const vnDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The most recent finished calendar cycle before `todayIso` (on the 1st / 15th: the one ending yesterday). */
export function lastFinishedCycle(todayIso: string): { start: string; end: string } {
  const current = calendarCycle(dayNum(todayIso));
  const prev = calendarCycle(current.start - 1);
  return { start: isoOf(prev.start), end: isoOf(prev.end) };
}

interface ReportRow {
  uid: number;
  email: string | null;
  member_status: "active" | "warned" | "kicked" | null;
  joined_at: string | null;
  volume: number | string;
  trade_days: number;
}

interface Person {
  uid: number;
  email: string;
  status: string;
  joinedAt: string;
  volume: number;
  tradeDays: number;
}

export interface CycleReport {
  start: string;
  end: string;
  target: number;
  members: Person[];
  met: Person[];
  notMet: Person[];
  /** Partner-link UIDs that traded in the cycle but never linked the website. */
  unlinked: { uid: number; volume: number; tradeDays: number }[];
}

const STATUS_VI: Record<string, string> = { active: "Đang hoạt động", warned: "Đã cảnh báo", kicked: "Đã bị xoá" };

export async function buildCycleReport(start: string, end: string): Promise<CycleReport> {
  const rows = await rpc<ReportRow[]>("cycle_report", { p_start: start, p_end: end });
  const target = PREMIUM_RULE.requiredUsd;
  const members: Person[] = rows
    .filter((r) => r.email !== null)
    .map((r) => ({
      uid: r.uid,
      email: r.email ?? "",
      status: STATUS_VI[r.member_status ?? ""] ?? "—",
      joinedAt: r.joined_at ?? "",
      volume: Number(r.volume) || 0,
      tradeDays: r.trade_days,
    }));
  return {
    start,
    end,
    target,
    members,
    met: members.filter((m) => m.volume >= target),
    notMet: members.filter((m) => m.volume < target).sort((a, b) => b.volume - a.volume),
    unlinked: rows
      .filter((r) => r.email === null)
      .map((r) => ({ uid: r.uid, volume: Number(r.volume) || 0, tradeDays: r.trade_days })),
  };
}

// ---------------------------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------------------------

const MONEY = '"$"#,##0.00';
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A0608" } };

function addTable(
  wb: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string; width: number; money?: boolean; percent?: boolean }[],
  rows: Record<string, string | number>[],
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.addRows(rows);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle" };
  header.height = 22;
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.money) col.numFmt = MONEY;
    if (c.percent) col.numFmt = "0%";
  });
  if (rows.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export async function cycleReportExcel(r: CycleReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "The Last Candle";
  wb.created = new Date();

  const traded = r.members.filter((m) => m.volume > 0).length;
  const summary = wb.addWorksheet("Tổng quan");
  summary.columns = [
    { header: "Chỉ số", key: "k", width: 44 },
    { header: "Giá trị", key: "v", width: 22 },
  ];
  summary.addRows([
    { k: "Chu kỳ", v: `${vnDay(r.start)} – ${vnDay(r.end)}` },
    { k: "Mục tiêu crypto futures / chu kỳ", v: r.target },
    { k: "Tổng thành viên Premium Crypto (đã liên kết web)", v: r.members.length },
    { k: "Thành viên có giao dịch", v: traded },
    { k: "Đủ điều kiện ở lại", v: r.met.length },
    { k: "Không đủ điều kiện", v: r.notMet.length },
    { k: "Tổng volume của thành viên", v: r.members.reduce((s, m) => s + m.volume, 0) },
    { k: "UID dưới link có giao dịch nhưng chưa liên kết web", v: r.unlinked.length },
    { k: "Tạo lúc (UTC)", v: new Date().toISOString().replace("T", " ").slice(0, 16) },
  ]);
  summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  summary.getRow(1).fill = HEADER_FILL;
  for (const row of [3, 8]) summary.getCell(`B${row}`).numFmt = MONEY;

  addTable(
    wb,
    "Không đủ điều kiện",
    [
      { header: "UID BingX", key: "uid", width: 14 },
      { header: "Gmail", key: "email", width: 30 },
      { header: "Volume đã trade", key: "volume", width: 18, money: true },
      { header: "Còn thiếu", key: "missing", width: 16, money: true },
      { header: "% mục tiêu", key: "pct", width: 12, percent: true },
      { header: "Số ngày có GD", key: "days", width: 14 },
      { header: "Ngày tham gia", key: "joined", width: 14 },
      { header: "Trạng thái", key: "status", width: 16 },
    ],
    r.notMet.map((m) => ({
      uid: m.uid,
      email: m.email,
      volume: m.volume,
      missing: Math.max(0, r.target - m.volume),
      pct: m.volume / r.target,
      days: m.tradeDays,
      joined: m.joinedAt ? vnDay(m.joinedAt) : "",
      status: m.status,
    })),
  );

  addTable(
    wb,
    "Đủ điều kiện",
    [
      { header: "UID BingX", key: "uid", width: 14 },
      { header: "Gmail", key: "email", width: 30 },
      { header: "Volume đã trade", key: "volume", width: 18, money: true },
      { header: "Vượt mục tiêu", key: "over", width: 16, money: true },
      { header: "Số ngày có GD", key: "days", width: 14 },
      { header: "Ngày tham gia", key: "joined", width: 14 },
    ],
    r.met.map((m) => ({
      uid: m.uid,
      email: m.email,
      volume: m.volume,
      over: m.volume - r.target,
      days: m.tradeDays,
      joined: m.joinedAt ? vnDay(m.joinedAt) : "",
    })),
  );

  addTable(
    wb,
    "Chưa liên kết web",
    [
      { header: "UID BingX", key: "uid", width: 14 },
      { header: "Volume đã trade", key: "volume", width: 18, money: true },
      { header: "Số ngày có GD", key: "days", width: 14 },
    ],
    r.unlinked.map((u) => ({ uid: u.uid, volume: u.volume, days: u.tradeDays })),
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------

const MAX_ROWS_IN_EMAIL = 30;

export function cycleReportEmail(to: string, r: CycleReport, excel: Buffer, todayIso: string): EmailMessage {
  // The day after the cycle is the members' 24h grace day.
  const graceToday = dayNum(todayIso) === dayNum(r.end) + 1;
  const period = `${vnDay(r.start)} – ${vnDay(r.end)}`;
  const traded = r.members.filter((m) => m.volume > 0).length;
  const subject = `📊 Báo cáo Premium Crypto ${period}: ${r.met.length} đạt · ${r.notMet.length} không đạt`;

  const cell = "padding:6px 8px;border-bottom:1px solid #2a2a2a;font-size:13px";
  const rows = r.notMet
    .slice(0, MAX_ROWS_IN_EMAIL)
    .map(
      (m) =>
        `<tr><td style="${cell}">${m.uid}</td><td style="${cell}">${escapeHtml(m.email)}</td>` +
        `<td style="${cell};text-align:right">${usd(m.volume)}</td>` +
        `<td style="${cell};text-align:right;color:#f87171">${usd(r.target - m.volume)}</td></tr>`,
    )
    .join("");
  const more = r.notMet.length > MAX_ROWS_IN_EMAIL ? `<p style="color:#a3a3a3;font-size:13px">… và ${r.notMet.length - MAX_ROWS_IN_EMAIL} người nữa trong file Excel.</p>` : "";
  const stat = (label: string, value: string | number, color = "#ffffff") =>
    `<td style="padding:12px;background:#1a1a1a;border-radius:10px;text-align:center"><div style="font-size:22px;font-weight:700;color:${color}">${value}</div><div style="font-size:12px;color:#a3a3a3;margin-top:4px">${label}</div></td>`;

  const html = `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#0a0a0a;color:#e5e5e5;margin:0;padding:32px 16px">
  <div style="max-width:600px;margin:0 auto">
    <p style="font-family:Georgia,serif;font-style:italic;font-size:22px;color:#fff;margin:0 0 6px">The Last Candle</p>
    <h2 style="margin:0 0 4px;font-size:18px;color:#f97316">Báo cáo chu kỳ Premium Crypto</h2>
    <p style="margin:0 0 20px;color:#a3a3a3;font-size:14px">${period} · mục tiêu ${usd(r.target)} crypto futures</p>
    <table role="presentation" width="100%" cellspacing="8" cellpadding="0" style="margin:0 -8px 16px"><tr>
      ${stat("Thành viên", r.members.length)}${stat("Có giao dịch", traded)}${stat("Đủ điều kiện", r.met.length, "#4ade80")}${stat("Không đủ", r.notMet.length, "#f87171")}
    </tr></table>
    ${
      r.notMet.length
        ? `<h3 style="font-size:15px;margin:20px 0 8px">Không đủ điều kiện</h3>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      <tr><th align="left" style="${cell};color:#a3a3a3">UID</th><th align="left" style="${cell};color:#a3a3a3">Gmail</th><th align="right" style="${cell};color:#a3a3a3">Đã trade</th><th align="right" style="${cell};color:#a3a3a3">Còn thiếu</th></tr>
      ${rows}
    </table>${more}
    ${
      graceToday
        ? `<p style="font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:12px">Hôm nay là ngày gia hạn 24 giờ của họ. Ai vẫn chưa đủ sau hôm nay sẽ có đề xuất kick trong <strong>kick_reviews</strong> vào sáng mai.</p>`
        : ""
    }`
        : r.members.length
          ? `<p style="color:#4ade80">Tất cả thành viên đều đạt yêu cầu 🎉</p>`
          : `<p style="color:#a3a3a3">Chưa có thành viên nào liên kết web trong chu kỳ này.</p>`
    }
    <p style="font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:16px">Chi tiết đầy đủ trong file Excel đính kèm (sheet Tổng quan, Không đủ điều kiện, Đủ điều kiện, Chưa liên kết web). Có ${r.unlinked.length} UID dưới link đối tác đã giao dịch nhưng chưa liên kết web.</p>
  </div>
</body>
</html>`;

  const text = [
    `BÁO CÁO PREMIUM CRYPTO ${period} (mục tiêu ${usd(r.target)})`,
    `Thành viên: ${r.members.length} · có giao dịch: ${traded} · đủ điều kiện: ${r.met.length} · không đủ: ${r.notMet.length}`,
    "",
    ...r.notMet.slice(0, MAX_ROWS_IN_EMAIL).map((m) => `${m.uid}  ${m.email}  đã trade ${usd(m.volume)}  thiếu ${usd(r.target - m.volume)}`),
    "",
    "Chi tiết trong file Excel đính kèm.",
  ].join("\n");

  return {
    to,
    subject,
    html,
    text,
    attachments: [{ filename: `premium-crypto-${r.start}_${r.end}.xlsx`, content: excel }],
  };
}

/** Builds and emails the report of the last finished cycle to ADMIN_EMAIL. */
export async function sendCycleReport(
  todayIso: string,
): Promise<{ cycle: string; unlinkedTraders: number; members: number; met: number; notMet: number; sentTo: number } | null> {
  const admins = (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (admins.length === 0) return null;

  const { start, end } = lastFinishedCycle(todayIso);
  const report = await buildCycleReport(start, end);
  const excel = await cycleReportExcel(report);
  for (const to of admins) {
    // Running the morning sync again by hand on a report day sends the report again.
    await sendEmail(cycleReportEmail(to, report, excel, todayIso));
  }
  return {
    cycle: `${start}..${end}`,
    unlinkedTraders: report.unlinked.length,
    members: report.members.length,
    met: report.met.length,
    notMet: report.notMet.length,
    sentTo: admins.length,
  };
}
