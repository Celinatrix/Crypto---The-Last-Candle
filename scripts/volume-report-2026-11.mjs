// One-off report for the special round 1/11 → 25/11/2026: who reached 68,686$ of crypto-futures
// volume and who did not, emailed to the admin. Reads Supabase (read-only) and sends via Gmail,
// using the keys in .env.local. Run by Windows Task Scheduler; see the end of this file.
//
//   node scripts/volume-report-2026-11.mjs            send the email
//   node scripts/volume-report-2026-11.mjs --dry      print only, send nothing
//   node scripts/volume-report-2026-11.mjs --to=x@gmail.com
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FROM = "2026-11-01";
const TO = "2026-11-25";
const REQUIRED = 68_686;
const ADMIN_TO = "bqtkietag123@gmail.com";

// Group members as of 20/11/2026, plus UIDs still linked on the site after leaving the group.
const PEOPLE = [
  ["Bích Thảo", 36781469], ["Đăng Khoa", 33686446], ["Đào Đình Thành", 34167303],
  ["Donk Taxi", 38260432], ["Hà Xinh", 39758426], ["Huỳnh Vũ", 35270322],
  ["Khánh Lâm", 39572737], ["Lê Võ Trí Dũng", 35752382], ["Sơn Thiên", 39551135],
  ["Thanh Lâm", 39519511], ["Thông", 39532067], ["Trần An Kháng", 33791927],
  ["Vũ Ngọc Toàn", 36908510],
  ["(đã rời nhóm)", 34592111], ["(đã rời nhóm)", 37022169],
  ["(đã rời nhóm)", 38795066], ["(đã rời nhóm)", 39594289],
].map(([name, uid]) => ({ name, uid, inGroup: !name.startsWith("(") }));

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const to = args.find((a) => a.startsWith("--to="))?.slice(5) || ADMIN_TO;
const LOG = join(ROOT, "scripts", "volume-report-2026-11.log");
const log = (s) => {
  const line = `[${new Date().toISOString()}] ${s}`;
  console.log(line);
  try { appendFileSync(LOG, line + "\n"); } catch {}
};

function loadEnv() {
  const env = {};
  for (const raw of readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
    const m = raw.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const fmt = (n) => Math.round(n).toLocaleString("en-US") + "$";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function main() {
  const env = loadEnv();
  const base = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const uids = PEOPLE.map((p) => p.uid).join(",");

  const q = `${base}/rest/v1/daily_volumes?select=bingx_uid,day,crypto_futures_volume` +
    `&bingx_uid=in.(${uids})&day=gte.${FROM}&day=lte.${TO}&limit=10000`;
  const res = await fetch(q, { headers });
  if (!res.ok) throw new Error(`Supabase daily_volumes ${res.status}: ${await res.text()}`);
  const rows = await res.json();

  // Last day BingX data has been synced for (any invitee), to say how complete the numbers are.
  const r2 = await fetch(`${base}/rest/v1/daily_volumes?select=day&order=day.desc&limit=1`, { headers });
  const latest = r2.ok ? (await r2.json())[0]?.day ?? "?" : "?";
  const lastCounted = latest > TO ? TO : latest;
  const complete = latest >= TO;

  const sum = new Map();
  for (const r of rows) sum.set(r.bingx_uid, (sum.get(r.bingx_uid) ?? 0) + Number(r.crypto_futures_volume));
  const list = PEOPLE.map((p) => ({ ...p, volume: sum.get(p.uid) ?? 0 }))
    .map((p) => ({ ...p, met: p.volume >= REQUIRED, short: Math.max(0, REQUIRED - p.volume) }))
    .sort((a, b) => b.volume - a.volume);

  const groups = [
    ["ĐẠT volume", list.filter((p) => p.inGroup && p.met)],
    ["KHÔNG ĐỦ volume", list.filter((p) => p.inGroup && !p.met)],
    ["Đã rời nhóm (vẫn còn liên kết trên web)", list.filter((p) => !p.inGroup)],
  ];
  const d = (s) => s.split("-").reverse().slice(0, 2).join("/");
  const status = complete
    ? `Số liệu đầy đủ từ ${d(FROM)} đến hết ${d(TO)}.`
    : `CHƯA ĐỦ SỐ LIỆU: BingX mới đồng bộ đến hết ${d(lastCounted)}, thiếu các ngày sau đó đến ${d(TO)}.`;
  const subject = `${complete ? "Chốt" : "Tạm tính"} volume đợt ${d(FROM)}–${d(TO)}: ` +
    `${groups[0][1].length} đạt, ${groups[1][1].length} không đủ`;

  const text = [
    subject, status, `Mốc: ${fmt(REQUIRED)} crypto-futures (perpetual − TradFi), ngày UTC.`, "",
    ...groups.flatMap(([title, ps]) => [
      `== ${title} (${ps.length})`,
      ...ps.map((p) => `- ${p.name} · UID ${p.uid} · ${fmt(p.volume)}${p.met ? "" : ` · thiếu ${fmt(p.short)}`}`),
      "",
    ]),
  ].join("\n");

  const table = (title, ps) => `
    <h3 style="margin:20px 0 8px">${esc(title)} (${ps.length})</h3>
    ${ps.length === 0 ? "<p>—</p>" : `<table cellpadding="6" style="border-collapse:collapse;font-size:14px">
      <tr style="background:#f2f2f2"><th align="left">Thành viên</th><th align="left">UID</th><th align="right">Volume</th><th align="right">Còn thiếu</th></tr>
      ${ps.map((p) => `<tr style="border-top:1px solid #ddd"><td>${esc(p.name)}</td><td>${p.uid}</td>
        <td align="right">${fmt(p.volume)}</td><td align="right">${p.met ? "✅" : fmt(p.short)}</td></tr>`).join("")}
    </table>`}`;
  const html = `<div style="font-family:Arial,sans-serif;color:#222">
    <h2 style="margin:0 0 8px">${esc(subject)}</h2>
    <p style="margin:0 0 4px"><b${complete ? "" : ' style="color:#b45309"'}>${esc(status)}</b></p>
    <p style="margin:0">Mốc: ${fmt(REQUIRED)} crypto-futures (perpetual − TradFi), tính theo ngày UTC.</p>
    ${groups.map(([t, ps]) => table(t, ps)).join("")}
  </div>`;

  if (dry) { console.log(text); log(`dry run, latest synced day ${latest}`); return; }

  const user = env.GMAIL_USER, pass = (env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  if (!user || !pass) throw new Error("Thiếu GMAIL_USER / GMAIL_APP_PASSWORD trong .env.local");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  const info = await transport.sendMail({ from: { name: "The Last Candle", address: user }, to, subject, text, html });
  log(`sent to ${to}: "${subject}" (${info.messageId})`);
}

main().catch((e) => { log(`FAILED: ${e?.stack || e}`); process.exit(1); });

// Scheduled with Windows Task Scheduler (tasks "TLC volume report preview" and "TLC volume report final").
