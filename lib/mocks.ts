/**
 * DEV-ONLY mock backend. Imported dynamically behind `DEV_MOCKS`, so it never ships
 * in a production bundle. Pick a scenario with `?mock=…` in the URL.
 */
import { readLink } from "./linkSession";
import type { MeResponse, NewsPost, NewsResponse, RegisterResult } from "./types";

export type MockScenario = "new" | "fresh" | "active" | "met" | "soon" | "grace" | "kicked" | "error";

const SCENARIOS: readonly MockScenario[] = ["new", "fresh", "active", "met", "soon", "grace", "kicked", "error"];

export function parseScenario(value: string | null | undefined): MockScenario {
  return SCENARIOS.find((s) => s === value) ?? "new";
}

const DAY = 86_400_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scenario = () => parseScenario(new URLSearchParams(window.location.search).get("mock"));

/**
 * Where "today" falls for each scenario, and how much was traded in the cycle so far.
 * prevVolume = total of the previous 14-day cycle (only "grace" misses it).
 */
const PLANS: Record<Exclude<MockScenario, "new" | "error">, { cycle: number; day: number; volume: number; prevVolume: number }> = {
  fresh: { cycle: 1, day: 2, volume: 3_480, prevVolume: 0 },
  active: { cycle: 3, day: 6, volume: 31_960, prevVolume: 68_200 },
  met: { cycle: 2, day: 9, volume: 71_450, prevVolume: 64_900 },
  soon: { cycle: 2, day: 11, volume: 41_830, prevVolume: 62_300 },
  grace: { cycle: 3, day: 1, volume: 0, prevVolume: 52_310 },
  kicked: { cycle: 4, day: 3, volume: 2_150, prevVolume: 18_400 },
};

const isoDay = (dayNumber: number) => new Date(dayNumber * DAY).toISOString().slice(0, 10);
const rand = (i: number, seed: number) => Math.abs(Math.sin(seed * 31.7 + i * 12.9898)) % 1;

/** Spread `total` over `days` consecutive day numbers with uneven, partly-zero weights. */
function spread(total: number, days: number[], seed: number): Map<number, number> {
  const weights = days.map((d) => (rand(d, seed) < 0.15 ? 0 : rand(d, seed + 1) + 0.2));
  const sum = weights.reduce((a, w) => a + w, 0) || 1;
  return new Map(days.map((d, i) => [d, Math.round((total * (weights[i] ?? 0)) / sum * 100) / 100]));
}

export async function mockMe(): Promise<MeResponse> {
  await wait(700);
  // Stand-in for the backend member cookie: the device's saved link.
  const link = readLink();
  if (!link) return { member: null };
  const s = scenario();
  return meFor(s === "new" || s === "error" ? "active" : s, link);
}

function meFor(s: keyof typeof PLANS, link: { uid: string; email: string }): MeResponse {
  const now = Date.now();
  const plan = PLANS[s];
  const today = Math.floor(now / DAY);
  const cycleStart = today - (plan.day - 1);
  const joinDay = cycleStart - (plan.cycle - 1) * 14;

  const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  const volumes = new Map<number, number>([
    ...spread(plan.prevVolume, range(Math.max(joinDay, cycleStart - 14), cycleStart - 1), 7),
    ...spread(plan.volume, range(cycleStart, today), 3),
  ]);
  const daily = range(today - 29, today).map((d) => ({
    day: isoDay(d),
    volume: d < joinDay ? 0 : (volumes.get(d) ?? Math.round((rand(d, 11) * 6_000 + 1_500) * 100) / 100),
  }));
  const total = (n: number) => Math.round(daily.slice(-n).reduce((a, d) => a + d.volume, 0) * 100) / 100;

  return {
    member: {
      uid: link.uid,
      email: link.email,
      status: s === "kicked" ? "kicked" : "active",
      joinedAt: new Date(joinDay * DAY + 3 * 3_600_000).toISOString(),
      warnedAt: null,
    },
    volume: {
      total30: total(30),
      total14: total(14),
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
    text: "📌 Nhắc lại quy định nhóm Premium:\nMỗi 14 ngày cần đạt 60.000$ volume.\nNgày 10 chưa đủ → cảnh báo.\nHết chu kỳ còn thiếu → gia hạn 24 giờ, sau đó rời nhóm.\n\nKiểm tra tiến độ của bạn ngay trên trang thành viên.",
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
