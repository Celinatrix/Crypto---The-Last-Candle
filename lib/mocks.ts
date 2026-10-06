/**
 * DEV-ONLY mock backend. Imported dynamically behind `DEV_MOCKS`, so it never ships
 * in a production bundle. Pick a scenario with `?mock=…` in the URL.
 */
import { readLink } from "./linkSession";
import type { MeResponse, NewsPost, NewsResponse, RegisterResult } from "./types";

export type MockScenario = "new" | "fresh" | "active" | "soon" | "warned" | "kicked" | "error";

const SCENARIOS: readonly MockScenario[] = ["new", "fresh", "active", "soon", "warned", "kicked", "error"];

export function parseScenario(value: string | null | undefined): MockScenario {
  return SCENARIOS.find((s) => s === value) ?? "new";
}

const DAY = 86_400_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scenario = () => parseScenario(new URLSearchParams(window.location.search).get("mock"));


function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function buildDaily(zeroLast: number, seed: number) {
  const today = Date.now();
  return Array.from({ length: 30 }, (_, i) => {
    const day = isoDay(today - (29 - i) * DAY);
    const r = Math.abs(Math.sin(seed * 31 + i * 12.9898)) % 1;
    const inZeroTail = i >= 30 - zeroLast;
    const volume = inZeroTail || r < 0.18 ? 0 : Math.round((r * 9_000 + 400) * 100) / 100;
    return { day, volume };
  });
}

export async function mockMe(): Promise<MeResponse> {
  await wait(700);
  // Stand-in for the backend member cookie: the device's saved link.
  const link = readLink();
  if (!link) return { member: null };
  const s = scenario();
  return meFor(s === "new" || s === "error" ? "active" : s, link);
}

function meFor(s: MockScenario, link: { uid: string; email: string }): MeResponse {
  const now = Date.now();
  const zeroLast = s === "soon" || s === "warned" || s === "kicked" || s === "fresh" ? 14 : 0;
  const daily = buildDaily(s === "fresh" ? 30 : zeroLast, 3);
  const total30 = daily.reduce((a, d) => a + d.volume, 0);
  const total14 = daily.slice(-14).reduce((a, d) => a + d.volume, 0);
  return {
    member: {
      uid: link.uid,
      email: link.email,
      status: s === "warned" ? "warned" : s === "kicked" ? "kicked" : "active",
      joinedAt: new Date(now - (s === "fresh" ? 5 : 64) * DAY).toISOString(),
      warnedAt: s === "warned" ? new Date(now - 7 * 3_600_000).toISOString() : null,
    },
    volume: {
      total30: Math.round(total30 * 100) / 100,
      total14: Math.round(total14 * 100) / 100,
      daily,
      updatedAt: new Date(now - 12 * 60_000).toISOString(),
    },
  };
}

export async function mockRegister(): Promise<RegisterResult> {
  await wait(1200);
  if (scenario() === "error") {
    return { ok: false, error: "UID này không đăng ký BingX qua link đối tác của cộng đồng." };
  }
  return { ok: true };
}

const BASE_POSTS: Omit<NewsPost, "date">[] = [
  {
    id: 412,
    url: "https://t.me/s/thelastcandle/412",
    text: "📌 Nhắc lại quy định nhóm:\nKhối lượng 14 ngày = 0 → email cảnh báo.\nSau 24 giờ vẫn = 0 → rời nhóm.\n\nKiểm tra trạng thái của bạn ngay trên trang thành viên.",
    views: 1840,
    photo: null,
  },
  {
    id: 411,
    url: "https://t.me/s/thelastcandle/411",
    text: "BTC giữ vùng hỗ trợ 61.2K sau phiên Mỹ. Khung H4 đang nén biên độ, chờ breakout trước khi vào lệnh mới.\nQuản lý vốn: không quá 2% tài khoản mỗi lệnh.",
    views: 2310,
    photo:
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#121821"/><g stroke="#2a3443">${Array.from({ length: 8 }, (_, i) => `<line x1="0" x2="640" y1="${40 + i * 40}" y2="${40 + i * 40}"/>`).join("")}</g>${Array.from({ length: 22 }, (_, i) => { const up = Math.sin(i * 1.7) > -0.2; const h = 20 + Math.abs(Math.sin(i * 2.3)) * 70; const y = 200 - i * 4 - h / 2 + Math.sin(i) * 30; return `<line x1="${30 + i * 27}" x2="${30 + i * 27}" y1="${y - 14}" y2="${y + h + 14}" stroke="${up ? "#3ff0b2" : "#ff5c5c"}"/><rect x="${23 + i * 27}" y="${y}" width="14" height="${h}" fill="${up ? "#3ff0b2" : "#ff5c5c"}"/>`; }).join("")}</svg>`,
      ),
  },
  {
    id: 410,
    url: "https://t.me/s/thelastcandle/410",
    text: "Lịch kinh tế tuần này: CPI Mỹ (thứ Tư), biên bản FOMC (thứ Năm). Biến động có thể tăng mạnh, hãy đặt stop-loss rõ ràng.",
    views: 1975,
    photo: null,
  },
  {
    id: 409,
    url: "https://t.me/s/thelastcandle/409",
    text: "Tổng kết tháng 9: 63% lệnh tín hiệu đạt TP1, 41% đạt TP2. Chi tiết từng lệnh đã ghim trong nhóm.",
    views: 3120,
    photo: null,
  },
  {
    id: 408,
    url: "https://t.me/s/thelastcandle/408",
    text: "Thành viên mới nhớ liên kết UID BingX trong vòng 7 ngày sau khi vào nhóm để được xét duyệt.",
    views: 2688,
    photo: null,
  },
];

let pollCount = 0;

export async function mockNews(): Promise<NewsResponse> {
  await wait(500);
  const now = Date.now();
  const offsets = [5, 48, 3 * 60, 26 * 60, 3 * 24 * 60];
  const posts: NewsPost[] = BASE_POSTS.map((p, i) => ({ ...p, date: new Date(now - (offsets[i] ?? 0) * 60_000).toISOString() }));
  // Every poll after the first adds one new post so the "fresh" highlight can be seen.
  for (let i = 1; i <= pollCount; i++) {
    posts.unshift({
      id: 412 + i,
      url: `https://t.me/s/thelastcandle/${412 + i}`,
      text: `⚡ Cập nhật nhanh #${i}: ETH vượt kháng cự ngắn hạn, theo dõi phản ứng giá ở vùng retest.`,
      date: Math.floor(now / 1000) - 20,
      views: 120 * i,
      photo: null,
    });
  }
  pollCount++;
  return { channel: "thelastcandle", posts };
}
