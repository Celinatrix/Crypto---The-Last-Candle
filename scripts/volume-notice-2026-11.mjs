// One-off notice to group members still short of volume: the round 1/11 → 25/11/2026 is extended
// and checked at 22:00 (Vietnam time) on 25/11. Reads Supabase (read-only), sends via Gmail with
// the keys in .env.local.
//
//   node scripts/volume-notice-2026-11.mjs --dry               print recipients and one email
//   node scripts/volume-notice-2026-11.mjs --sample=x@gmail.com send one sample (first recipient's data)
//   node scripts/volume-notice-2026-11.mjs --send              send to every recipient
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FROM = "2026-11-01";
const TO = "2026-11-25";
const REQUIRED = 68_686;

// Members currently in the group (20/11/2026).
const GROUP = new Map([
  [36781469, "Bích Thảo"], [33686446, "Đăng Khoa"], [34167303, "Đào Đình Thành"],
  [38260432, "Donk Taxi"], [39758426, "Hà Xinh"], [35270322, "Huỳnh Vũ"],
  [39572737, "Khánh Lâm"], [35752382, "Lê Võ Trí Dũng"], [39551135, "Sơn Thiên"],
  [39519511, "Thanh Lâm"], [39532067, "Thông"], [33791927, "Trần An Kháng"],
  [36908510, "Vũ Ngọc Toàn"],
]);

const args = process.argv.slice(2);
const mode = args.includes("--send") ? "send" : args.find((a) => a.startsWith("--sample=")) ? "sample" : "dry";
const sampleTo = args.find((a) => a.startsWith("--sample="))?.slice(9);
const LOG = join(ROOT, "scripts", "volume-notice-2026-11.log");
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
const dm = (s) => s.split("-").reverse().slice(0, 2).join("/");

function buildEmail(p, lastDay, daysLeft) {
  const perDay = p.short / Math.max(1, daysLeft);
  const subject = "Gia hạn đợt volume: chốt lúc 22:00 ngày 25/11";
  const text = `Chào ${p.name},

BQT The Last Candle thông báo: đợt tính volume hiện tại được GIA HẠN.

- Thời gian tính: từ 01/11/2026 đến 22:00 ngày 25/11/2026 (giờ Việt Nam)
- Mốc cần đạt: ${fmt(REQUIRED)} volume crypto-futures trên BingX (không tính TradFi)

Volume của bạn (UID ${p.uid}), tính đến hết ${dm(lastDay)}: ${fmt(p.volume)}
Còn thiếu: ${fmt(p.short)}, trung bình khoảng ${fmt(perDay)}/ngày trong ${daysLeft} ngày còn lại.

Sau 22:00 ngày 25/11, BQT sẽ kiểm tra volume. Thành viên chưa đạt mốc sẽ bị mời rời nhóm Premium.

Lưu ý: trang web vẫn đang hiển thị chu kỳ 15–30/11. Riêng đợt này, hạn chốt là 22:00 ngày 25/11.

Chúc bạn giao dịch thuận lợi,
BQT The Last Candle`;

  const row = (k, v, strong) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#555">${k}</td><td style="padding:6px 0"${strong ? ' align="right"' : ""}><b>${v}</b></td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;color:#222;font-size:15px;line-height:1.55;max-width:560px">
  <p>Chào <b>${esc(p.name)}</b>,</p>
  <p>BQT The Last Candle thông báo: đợt tính volume hiện tại được <b>gia hạn</b>.</p>
  <table style="border-collapse:collapse;margin:4px 0 12px">
    ${row("Thời gian tính", "01/11/2026 → 22:00 ngày 25/11/2026 (giờ Việt Nam)")}
    ${row("Mốc cần đạt", `${fmt(REQUIRED)} volume crypto-futures (không tính TradFi)`)}
  </table>
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 14px;margin:0 0 14px">
    Volume của bạn (UID ${p.uid}), tính đến hết ${dm(lastDay)}: <b>${fmt(p.volume)}</b><br>
    Còn thiếu: <b style="color:#b45309">${fmt(p.short)}</b>, trung bình khoảng <b>${fmt(perDay)}/ngày</b> trong ${daysLeft} ngày còn lại.
  </div>
  <p>Sau <b>22:00 ngày 25/11</b>, BQT sẽ kiểm tra volume. Thành viên chưa đạt mốc sẽ bị mời rời nhóm Premium.</p>
  <p style="color:#555;font-size:14px">Lưu ý: trang web vẫn đang hiển thị chu kỳ 15–30/11. Riêng đợt này, hạn chốt là 22:00 ngày 25/11.</p>
  <p>Chúc bạn giao dịch thuận lợi,<br>BQT The Last Candle</p>
</div>`;
  return { subject, text, html };
}

async function main() {
  const env = loadEnv();
  const base = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const uids = [...GROUP.keys()].join(",");

  const vr = await fetch(`${base}/rest/v1/daily_volumes?select=bingx_uid,day,crypto_futures_volume` +
    `&bingx_uid=in.(${uids})&day=gte.${FROM}&day=lte.${TO}&limit=10000`, { headers });
  if (!vr.ok) throw new Error(`daily_volumes ${vr.status}: ${await vr.text()}`);
  const mr = await fetch(`${base}/rest/v1/members?select=bingx_uid,email&bingx_uid=in.(${uids})`, { headers });
  if (!mr.ok) throw new Error(`members ${mr.status}: ${await mr.text()}`);
  const lr = await fetch(`${base}/rest/v1/daily_volumes?select=day&order=day.desc&limit=1`, { headers });
  const lastDay = (await lr.json())[0]?.day ?? FROM;

  const sum = new Map();
  for (const r of await vr.json()) sum.set(r.bingx_uid, (sum.get(r.bingx_uid) ?? 0) + Number(r.crypto_futures_volume));
  const email = new Map((await mr.json()).map((m) => [m.bingx_uid, m.email]));

  // Days from today (Vietnam date) through 25/11, inclusive.
  const todayVN = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const daysLeft = Math.max(1, Math.round((Date.parse(TO) - Date.parse(todayVN)) / 86_400_000) + 1);

  const short = [...GROUP].map(([uid, name]) => ({ uid, name, volume: sum.get(uid) ?? 0, email: email.get(uid) }))
    .map((p) => ({ ...p, short: Math.max(0, REQUIRED - p.volume) }))
    .filter((p) => p.short > 0)
    .sort((a, b) => a.short - b.short);
  const recipients = short.filter((p) => p.email);
  const noEmail = short.filter((p) => !p.email);

  console.log(`Data through ${lastDay}, ${daysLeft} day(s) left.`);
  console.log(`Recipients (${recipients.length}): ${recipients.map((p) => `${p.name} ${p.uid}`).join(", ")}`);
  console.log(`Short but no linked Gmail (${noEmail.length}): ${noEmail.map((p) => `${p.name} ${p.uid}`).join(", ")}`);

  if (mode === "dry") { console.log("\n" + buildEmail(recipients[0], lastDay, daysLeft).text); return; }

  const user = env.GMAIL_USER, pass = (env.GMAIL_APP_PASSWORD || "").replace(/\s/g, "");
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  const from = { name: "The Last Candle", address: user };
  const replyTo = env.EMAIL_REPLY_TO || undefined;

  if (mode === "sample") {
    const m = buildEmail(recipients[0], lastDay, daysLeft);
    const list = recipients.map((p) => `${p.name} (UID ${p.uid}) – thiếu ${fmt(p.short)}`);
    const note = `[BẢN MẪU – chưa gửi cho thành viên]\nSẽ gửi cho ${recipients.length} người:\n${list.join("\n")}\n` +
      (noEmail.length ? `Không gửi được (chưa liên kết Gmail): ${noEmail.map((p) => p.name).join(", ")}\n` : "") +
      `Dưới đây là email mẫu với số liệu của ${recipients[0].name}.\n\n`;
    const noteHtml = `<div style="font-family:Arial,sans-serif;background:#eef2ff;border:1px dashed #6366f1;padding:10px 14px;margin-bottom:18px;font-size:14px">
      <b>BẢN MẪU – chưa gửi cho thành viên.</b><br>Sẽ gửi cho ${recipients.length} người:<br>${list.map(esc).join("<br>")}
      ${noEmail.length ? `<br><br>Không gửi được (chưa liên kết Gmail): ${esc(noEmail.map((p) => p.name).join(", "))}` : ""}
      <br><br>Dưới đây là email mẫu với số liệu của ${esc(recipients[0].name)}.</div>`;
    const info = await transport.sendMail({ from, to: sampleTo, replyTo, subject: `[MẪU] ${m.subject}`, text: note + m.text, html: noteHtml + m.html });
    log(`sample sent to ${sampleTo} (${info.messageId})`);
    return;
  }

  for (const p of recipients) {
    const m = buildEmail(p, lastDay, daysLeft);
    try {
      const info = await transport.sendMail({ from, to: p.email, replyTo, ...m });
      log(`sent ${p.name} ${p.uid} (${info.messageId})`);
    } catch (e) {
      log(`FAILED ${p.name} ${p.uid}: ${e?.message || e}`);
    }
  }
}

main().catch((e) => { log(`FAILED: ${e?.stack || e}`); process.exit(1); });
