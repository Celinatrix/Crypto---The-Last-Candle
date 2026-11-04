/**
 * Weekly backup (V-10: the Supabase Free plan has no backups). Every Monday the morning sync
 * emails ADMIN_EMAIL a gzipped JSON of the tables that cannot be rebuilt from BingX: members,
 * memberships, cycles, kick decisions, email log and the audit trail. Volumes and invitees are
 * left out on purpose — `/api/cron/sync-volume?days=365` re-downloads them.
 *
 * Restore: gunzip, then insert each table's rows in this order (foreign keys):
 * members → memberships → premium_cycles → kick_reviews → email_deliveries → audit_log.
 */
import { gzipSync } from "node:zlib";
import { selectAll } from "./db";
import { sendEmail } from "./email";
import { adminEmails } from "./notify";

const TABLES = ["members", "memberships", "premium_cycles", "kick_reviews", "email_deliveries", "audit_log"] as const;

export async function sendWeeklyBackup(
  todayIso: string,
  opts: { force?: boolean } = {},
): Promise<{ tables: Record<string, number>; bytes: number; sentTo: number } | null> {
  const admins = adminEmails();
  if (admins.length === 0) return null;

  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await selectAll(t);
  const json = JSON.stringify({ project: "the-last-candle", createdAt: new Date().toISOString(), tables: data });
  const gz = gzipSync(Buffer.from(json), { level: 9 });

  const tables = Object.fromEntries(TABLES.map((t) => [t, data[t]?.length ?? 0]));
  const summary = TABLES.map((t) => `${t}: ${tables[t]}`).join(" · ");
  const filename = `the-last-candle-backup-${todayIso}.json.gz`;
  for (const to of admins) {
    await sendEmail(
      {
        to,
        subject: `🗄️ Backup dữ liệu The Last Candle ${todayIso}`,
        text: [
          `Bản sao lưu hằng tuần (file đính kèm ${filename}).`,
          summary,
          "",
          "Volume không có trong file vì tải lại được từ BingX.",
          "File chứa Gmail của thành viên — không chuyển tiếp cho người khác. Giữ ít nhất 4 bản gần nhất.",
        ].join("\n"),
        html: `<p style="font-family:sans-serif">Bản sao lưu hằng tuần (file đính kèm <strong>${filename}</strong>).</p>
<p style="font-family:sans-serif;color:#555">${summary}</p>
<p style="font-family:sans-serif;color:#555">Volume không có trong file vì tải lại được từ BingX. File chứa Gmail của thành viên — không chuyển tiếp cho người khác. Giữ ít nhất 4 bản gần nhất.</p>`,
        attachments: [{ filename, content: gz }],
      },
      opts.force ? undefined : `backup-${todayIso}-${to}`,
    );
  }
  return { tables, bytes: gz.length, sentTo: admins.length };
}
