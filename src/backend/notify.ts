/**
 * Emails sent after the morning sync (cron/sync-volume), once cycles are evaluated:
 *  - members: "5 days left" warning and the 24h grace-day notice, once per cycle each;
 *  - admin:   digest of kick reviews waiting for a decision (ADMIN_EMAIL, comma-separated).
 */
import { rpc, select, upsert } from "./db";
import { adminKickDigest, cycleNoticeEmail, sendBatch, sendEmail, type CycleNotice, type PendingKick } from "./email";

const utcToday = () => new Date().toISOString().slice(0, 10);

export async function sendCycleNotices(siteUrl: string): Promise<{ sent: number; failed: number }> {
  const today = utcToday();
  const notices = await rpc<(CycleNotice & { member_id: number })[]>("cycle_notices", { p_today: today });
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < notices.length; i += 100) {
    const chunk = notices.slice(i, i + 100);
    try {
      const ids = await sendBatch(
        chunk.map((n) => cycleNoticeEmail(n, today, siteUrl)),
        `cycle-notices-${today}-${i / 100}`,
      );
      // Recorded per cycle (send_day = cycle start), so each notice goes out once.
      await upsert(
        "email_deliveries",
        chunk.map((n, k) => ({ member_id: n.member_id, kind: n.kind, send_day: n.start_day, provider_id: ids[k] ?? null })),
        "member_id,kind,send_day",
      );
      sent += chunk.length;
    } catch (err) {
      console.error("[notify] cycle notices", err);
      failed += chunk.length;
    }
  }
  return { sent, failed };
}

/** Supabase Table Editor link for this project, derived from SUPABASE_URL. */
function kickReviewsUrl(): string {
  const ref = new URL(process.env.SUPABASE_URL ?? "https://x.supabase.co").hostname.split(".")[0];
  return `https://supabase.com/dashboard/project/${ref}/editor`;
}

export async function sendAdminDigest(): Promise<number> {
  const admins = (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (admins.length === 0) return 0;
  const pending = await select<PendingKick>(
    "pending_kick_reviews",
    "select=bingx_uid,email,cycle_index,start_day,end_day,counted_volume,target_usd",
  );
  if (pending.length === 0) return 0;
  for (const to of admins) await sendEmail(adminKickDigest(to, pending, kickReviewsUrl()));
  return pending.length;
}
