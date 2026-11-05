/**
 * Emails sent after the morning sync (cron/sync-volume), once cycles are evaluated:
 *  - members: "3 days left" reminder and the 24h grace-day notice, once per cycle each;
 *  - admin:   digest of kick reviews and new links waiting for a decision (ADMIN_EMAIL, comma-separated).
 * Plus the instant admin email when a new link waits for approval (from /api/verify-otp).
 */
import { rpc, select, upsert } from "./db";
import {
  adminDigest,
  cycleNoticeEmail,
  pendingApprovalEmail,
  sendBatch,
  sendEmail,
  type CycleNotice,
  type PendingApproval,
  type PendingKick,
} from "./email";

const utcToday = () => new Date().toISOString().slice(0, 10);

export const adminEmails = () =>
  (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

export async function sendCycleNotices(siteUrl: string): Promise<{ sent: number; failed: number }> {
  const today = utcToday();
  const notices = await rpc<(CycleNotice & { member_id: number })[]>("cycle_notices", { p_today: today });
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < notices.length; i += 100) {
    const chunk = notices.slice(i, i + 100);
    try {
      const ids = await sendBatch(chunk.map((n) => cycleNoticeEmail(n, today, siteUrl)));
      // Recorded per cycle (send_day = cycle start), so each notice goes out once. A message that
      // failed is left unrecorded and is tried again on the next run.
      const delivered = chunk.flatMap((n, k) =>
        ids[k] === null ? [] : [{ member_id: n.member_id, kind: n.kind, send_day: n.start_day, provider_id: ids[k] || null }],
      );
      await upsert("email_deliveries", delivered, "member_id,kind,send_day");
      sent += delivered.length;
      failed += chunk.length - delivered.length;
    } catch (err) {
      console.error("[notify] cycle notices", err);
      failed += chunk.length;
    }
  }
  return { sent, failed };
}

/** Supabase Table Editor link for this project, derived from SUPABASE_URL. */
function supabaseEditorUrl(): string {
  const ref = new URL(process.env.SUPABASE_URL ?? "https://x.supabase.co").hostname.split(".")[0];
  return `https://supabase.com/dashboard/project/${ref}/editor`;
}

export async function sendAdminDigest(): Promise<{ kicks: number; approvals: number }> {
  const admins = adminEmails();
  if (admins.length === 0) return { kicks: 0, approvals: 0 };
  const [kicks, approvals] = await Promise.all([
    select<PendingKick>("pending_kick_reviews", "select=bingx_uid,email,cycle_index,start_day,end_day,counted_volume,target_usd"),
    select<PendingApproval>("pending_approvals", "select=bingx_uid,email,joined_at"),
  ]);
  if (kicks.length + approvals.length > 0) {
    for (const to of admins) await sendEmail(adminDigest(to, kicks, approvals, supabaseEditorUrl()));
  }
  return { kicks: kicks.length, approvals: approvals.length };
}

/** Instant notice to the admin: a new UID ↔ Gmail link is waiting for approval. Never throws. */
export async function notifyPendingApproval(uid: string, email: string): Promise<void> {
  try {
    const p: PendingApproval = { bingx_uid: Number(uid), email, joined_at: new Date().toISOString() };
    for (const to of adminEmails()) await sendEmail(pendingApprovalEmail(to, p, supabaseEditorUrl()));
  } catch (err) {
    console.error("[notify] pending approval", err);
  }
}
