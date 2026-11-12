/**
 * Draws the weekly signal report as an A4 PDF (pdf-lib, with Be Vietnam Pro embedded for Vietnamese).
 * Server-only: the fonts are read from src/backend/fonts (traced into the route by next.config.ts).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { fmtPct, fmtPrice, fmtR } from "@/frontend/lib/format";
import { plannedRR, statusOf, type Signal } from "@/shared/signals";
import { vnClock, vnParts, vnShortDate } from "@/shared/vnTime";
import type { WeekSummary } from "@/shared/weeklyReport";

export interface ReportFonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

const FONT_DIR = path.join(process.cwd(), "src", "backend", "fonts");

export async function loadReportFonts(): Promise<ReportFonts> {
  const [regular, bold] = await Promise.all([
    readFile(path.join(FONT_DIR, "BeVietnamPro-Regular.ttf")),
    readFile(path.join(FONT_DIR, "BeVietnamPro-SemiBold.ttf")),
  ]);
  return { regular, bold };
}

// A4 landscape in points (the signal table needs the width), with a 40pt margin.
const W = 841.89;
const H = 595.28;
const M = 40;
const CONTENT = W - 2 * M;

const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.42, 0.43, 0.47);
const FAINT = rgb(0.62, 0.63, 0.66);
const LINE = rgb(0.86, 0.87, 0.89);
const PANEL = rgb(0.965, 0.968, 0.975);
const WIN = rgb(0.07, 0.48, 0.33);
const LOSS = rgb(0.76, 0.24, 0.12);
const ACCENT = rgb(0.22, 0.53, 0.9);

const pad = (n: number) => String(n).padStart(2, "0");
const vnDate = (ms: number) => {
  const p = vnParts(ms);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
};

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
}

interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: RGB;
  /** Right edge instead of left. */
  alignRight?: boolean;
  maxWidth?: number;
}

function fit(font: PDFFont, text: string, size: number, maxWidth?: number): string {
  if (!maxWidth || font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function text(c: Ctx, x: number, y: number, value: string, o: TextOpts = {}) {
  const font = o.bold ? c.bold : c.regular;
  const size = o.size ?? 9.5;
  const s = fit(font, value, size, o.maxWidth);
  const dx = o.alignRight ? -font.widthOfTextAtSize(s, size) : 0;
  c.page.drawText(s, { x: x + dx, y, size, font, color: o.color ?? INK });
}

function newPage(c: Ctx) {
  c.page = c.doc.addPage([W, H]);
  c.y = H - M;
}

/** Starts a new page when fewer than `needed` points are left above the footer. */
function ensure(c: Ctx, needed: number) {
  if (c.y - needed < M + 36) newPage(c);
}

function heading(c: Ctx, label: string) {
  ensure(c, 90);
  c.y -= 26;
  text(c, M, c.y, label, { size: 12, bold: true });
  c.y -= 10;
}

interface Tile {
  label: string;
  value: string;
  sub?: string;
  color?: RGB;
}

function tiles(c: Ctx, list: Tile[]) {
  const gap = 8;
  const h = 62;
  const w = (CONTENT - gap * (list.length - 1)) / list.length;
  ensure(c, h + 4);
  const top = c.y;
  list.forEach((t, i) => {
    const x = M + i * (w + gap);
    c.page.drawRectangle({ x, y: top - h, width: w, height: h, color: PANEL, borderColor: LINE, borderWidth: 0.75 });
    text(c, x + 10, top - 24, t.value, { size: 16, bold: true, color: t.color ?? INK, maxWidth: w - 20 });
    text(c, x + 10, top - 38, t.label, { size: 8.5, color: MUTED, maxWidth: w - 20 });
    if (t.sub) text(c, x + 10, top - 51, t.sub, { size: 7, color: FAINT, maxWidth: w - 20 });
  });
  c.y = top - h;
}

const rColor = (r: number) => (r > 1e-9 ? WIN : r < -1e-9 ? LOSS : INK);

interface Column {
  label: string;
  width: number;
  right?: boolean;
  value: (s: Signal) => string;
  color?: (s: Signal) => RGB;
}

const COLUMNS: Column[] = [
  { label: "#", width: 30, value: (s) => `#${s.id}` },
  { label: "Đăng lúc", width: 66, value: (s) => `${vnClock(Date.parse(s.createdAt))} ${vnShortDate(Date.parse(s.createdAt))}` },
  { label: "Cặp", width: 66, value: (s) => s.symbol.replace("-", " | ") },
  { label: "Lệnh", width: 72, value: (s) => `${s.side === "long" ? "Long" : "Short"} · ${s.orderType === "market" ? "Market" : "Limit"}` },
  {
    label: "Entry",
    width: 118,
    right: true,
    value: (s) => (s.entry2 === null ? fmtPrice(s.entry) : `${fmtPrice(s.entry)} · ${fmtPrice(s.entry2)}`),
  },
  { label: "SL", width: 62, right: true, value: (s) => fmtPrice(s.sl) },
  { label: "TP", width: 160, right: true, value: (s) => s.tps.map(fmtPrice).join(" · ") },
  { label: "R:R", width: 36, right: true, value: (s) => plannedRR(s).toFixed(2) },
  { label: "Trạng thái", width: 104, value: (s) => statusOf(s).label },
  {
    label: "Kết quả",
    width: 48,
    right: true,
    value: (s) => (s.status === "closed" || (s.status === "open" && s.tpHits > 0) ? fmtR(s.realizedR) : "—"),
    color: (s) => (s.status === "closed" ? rColor(s.realizedR) : MUTED),
  },
];

function table(c: Ctx, rows: Signal[]) {
  const total = COLUMNS.reduce((sum, col) => sum + col.width, 0);
  const scale = CONTENT / total;
  const cols = COLUMNS.map((col) => ({ ...col, width: col.width * scale }));
  const rowH = 17;

  const header = () => {
    c.page.drawRectangle({ x: M, y: c.y - rowH, width: CONTENT, height: rowH, color: PANEL });
    let x = M;
    for (const col of cols) {
      const tx = col.right ? x + col.width - 4 : x + 4;
      text(c, tx, c.y - 11.5, col.label, { size: 7.5, bold: true, color: MUTED, alignRight: col.right, maxWidth: col.width - 8 });
      x += col.width;
    }
    c.y -= rowH;
  };

  // Do not leave a header with one or two rows at the bottom of a page: start fresh unless ~6 rows fit.
  ensure(c, rowH * Math.min(rows.length + 1, 7));
  header();
  rows.forEach((s) => {
    if (c.y - rowH < M + 36) {
      newPage(c);
      header();
    }
    let x = M;
    for (const col of cols) {
      const tx = col.right ? x + col.width - 4 : x + 4;
      text(c, tx, c.y - 11.5, col.value(s), {
        size: 7.5,
        color: col.color ? col.color(s) : INK,
        alignRight: col.right,
        maxWidth: col.width - 8,
      });
      x += col.width;
    }
    c.page.drawLine({ start: { x: M, y: c.y - rowH }, end: { x: M + CONTENT, y: c.y - rowH }, thickness: 0.5, color: LINE });
    c.y -= rowH;
  });
}

function footers(c: Ctx, label: string) {
  const pages = c.doc.getPages();
  pages.forEach((page, i) => {
    c.page = page;
    page.drawLine({ start: { x: M, y: M + 20 }, end: { x: W - M, y: M + 20 }, thickness: 0.5, color: LINE });
    text(c, M, M + 8, label, { size: 7.5, color: MUTED });
    text(c, W - M, M + 8, `Trang ${i + 1}/${pages.length}`, { size: 7.5, color: MUTED, alignRight: true });
    text(c, M, M - 4, "Kết quả quá khứ không đảm bảo kết quả tương lai. Không phải lời khuyên đầu tư.", { size: 6.5, color: FAINT });
  });
}

export async function buildWeeklyReportPdf(sum: WeekSummary, fonts: ReportFonts, generatedAt = Date.now()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const range = `${vnShortDate(sum.start)} – ${vnDate(sum.end - 1)}`;
  doc.setTitle(`Báo cáo tín hiệu tuần ${range}`);
  doc.setAuthor("The Last Candle");
  doc.setCreator("The Last Candle");
  doc.setCreationDate(new Date(generatedAt));

  const c: Ctx = { doc, page: doc.addPage([W, H]), y: H - M, regular, bold };
  const st = sum.stats;

  // Title block
  text(c, M, c.y - 8, "THE LAST CANDLE", { size: 8, bold: true, color: ACCENT });
  text(c, M, c.y - 32, "Báo cáo tín hiệu tuần", { size: 20, bold: true });
  text(c, M, c.y - 50, `Tuần ${range} · giờ Việt Nam (GMT+7)`, { size: 10.5, color: INK });
  text(
    c,
    M,
    c.y - 65,
    `Tạo lúc ${vnClock(generatedAt)} ${vnDate(generatedAt)} · Kết quả chấm tự động theo nến 1 phút BingX`,
    { size: 8.5, color: MUTED },
  );
  c.y -= 65;
  if (sum.inProgress) {
    c.y -= 14;
    text(c, M, c.y, "Tuần chưa kết thúc: số liệu tính đến thời điểm tạo báo cáo.", { size: 8.5, color: LOSS });
  }

  heading(c, "1. Lệnh đã đưa ra");
  tiles(c, [
    { label: "Tổng lệnh", value: String(sum.total), sub: `Long ${sum.long} · Short ${sum.short}` },
    { label: "Đã khớp", value: String(sum.filled), sub: `${sum.open} đang chạy · ${sum.closed} đã đóng` },
    { label: "Chưa khớp", value: String(sum.pending), sub: "Lệnh Limit đang chờ giá" },
    {
      label: "Đã huỷ",
      value: String(sum.cancelled),
      sub: `SL trước ${sum.cancelledBy.sl} · TP1 trước ${sum.cancelledBy.tp} · admin ${sum.cancelledBy.admin}`,
    },
  ]);

  heading(c, "2. Kết quả TP / SL");
  tiles(c, [
    { label: "Chạm TP", value: String(sum.anyTp), sub: `${sum.allTp} lệnh chạm hết TP`, color: sum.anyTp ? WIN : INK },
    { label: "Chạm SL", value: String(sum.sl), sub: `${sum.slAfterTp} lệnh đã chạm TP trước đó`, color: sum.sl ? LOSS : INK },
    { label: "Đóng tay", value: String(sum.manual), sub: "Admin chốt theo thông báo" },
    { label: "Đã đóng", value: String(sum.closed), sub: "Tính vào winrate và R" },
  ]);

  heading(c, "3. Hiệu quả");
  tiles(c, [
    {
      label: "Winrate",
      value: st.winrate === null ? "—" : fmtPct(st.winrate),
      sub: `${st.wins} thắng · ${st.losses} thua · ${st.breakeven} hoà`,
    },
    {
      label: "Lợi nhuận",
      value: fmtR(st.totalR),
      sub: st.avgR === null ? "Chưa có lệnh đóng" : `Kỳ vọng ${fmtR(st.avgR)} mỗi lệnh`,
      color: rColor(st.totalR),
    },
    {
      label: "R:R thực tế",
      value: st.realizedRR === null ? "—" : `1 : ${st.realizedRR.toFixed(2)}`,
      sub: st.avgWinR !== null && st.avgLossR !== null ? `TB thắng ${fmtR(st.avgWinR)} · thua ${fmtR(-st.avgLossR)}` : "Cần cả lệnh thắng và thua",
    },
    { label: "R:R kế hoạch", value: st.plannedRR === null ? "—" : `1 : ${st.plannedRR.toFixed(2)}`, sub: "TB các TP lúc đăng" },
    { label: "Profit factor", value: st.profitFactor === null ? "—" : st.profitFactor.toFixed(2), sub: "R thắng ÷ R thua" },
  ]);
  c.y -= 14;
  text(
    c,
    M,
    c.y,
    "1R = khoảng cách từ Entry (hoặc giá trung bình nếu có 2 ET) đến SL ban đầu. Winrate = thắng ÷ (thắng + thua), chỉ tính lệnh đã đóng.",
    { size: 7.5, color: MUTED, maxWidth: CONTENT },
  );
  c.y -= 11;
  text(c, M, c.y, "Lệnh huỷ và lệnh chưa khớp không tính vào winrate hay lợi nhuận. Lệnh nhiều TP chốt đều từng phần.", {
    size: 7.5,
    color: MUTED,
    maxWidth: CONTENT,
  });

  // The table heading moves with the table when the table starts on a new page.
  ensure(c, 26 + 10 + 4 + 17 * Math.min(sum.signals.length + 1, 7));
  heading(c, "4. Chi tiết từng lệnh");
  if (sum.signals.length === 0) {
    c.y -= 14;
    text(c, M, c.y, "Không có lệnh nào được đăng trong tuần này.", { size: 9.5, color: MUTED });
  } else {
    c.y -= 4;
    table(c, sum.signals);
  }

  footers(c, `The Last Candle · Báo cáo tín hiệu tuần ${range}`);
  return doc.save();
}
