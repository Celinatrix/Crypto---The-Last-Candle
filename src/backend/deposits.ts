/**
 * Copies the deposits of every partner-link UID from BingX into public.deposits. BingX has no list
 * for "all invitees", so this asks once per UID, paced well under its limit: 168 UIDs take about
 * 25 seconds. BingX blocks the endpoint for a few minutes when called too fast, so the first
 * "rate limited" answer ends the run instead of making the block last longer.
 *
 * The 90 days BingX keeps are fetched until one such run reads every UID (window_days = 0 marks it
 * as still owed); after that each run only re-reads the last 3 days.
 */
import { DAY_MS, fetchInviteeDeposits } from "./bingx";
import { select, selectAll, upsert } from "./db";

const PARALLEL = 3;
/** Time between two requests to BingX, about 7–8 per second. */
const REQUEST_GAP_MS = 130;
const RECENT_DAYS = 3;
const HISTORY_DAYS = 89;
const RATE_LIMITED = /frequency limit|rate limit/i;

export async function syncDeposits(): Promise<{ uids: number; rows: number; failed: number; days: number }> {
  const [state] = await select<{ window_days: number }>("deposit_sync_state", "select=window_days&id=eq.1");
  const days = state && state.window_days > 0 ? RECENT_DAYS : HISTORY_DAYS;
  const end = Date.now();
  const start = end - days * DAY_MS;

  const uids = (await selectAll<{ uid: number }>("bingx_invitees", "uid")).map((i) => i.uid);
  const rows: object[] = [];
  const syncedAt = new Date(end).toISOString();
  let read = 0;
  let next = 0;
  let stop = false;

  let nextSlot = 0;
  const pace = async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + REQUEST_GAP_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };

  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (!stop && next < uids.length) {
        const uid = uids[next++] as number;
        try {
          const seen = new Map<string, number>();
          for (const d of await fetchInviteeDeposits(uid, start, end, pace)) {
            const key = [d.bizTime, d.assetType, d.currency, d.amount].join("|");
            const seq = seen.get(key) ?? 0;
            seen.set(key, seq + 1);
            rows.push({
              uid,
              biz_time: new Date(d.bizTime).toISOString(),
              asset_type: d.assetType,
              asset_type_name: d.assetTypeName,
              currency: d.currency,
              amount: d.amount,
              seq,
              synced_at: syncedAt,
            });
          }
          read++;
        } catch (err) {
          const message = (err as Error).message;
          console.error("[deposits] one UID failed", message);
          if (RATE_LIMITED.test(message)) stop = true;
        }
      }
    }),
  );

  const failed = uids.length - read;
  await upsert("deposits", rows, "uid,biz_time,asset_type,currency,amount,seq");
  await upsert(
    "deposit_sync_state",
    [{ id: 1, synced_at: syncedAt, window_days: days === HISTORY_DAYS && failed > 0 ? 0 : days, row_count: rows.length, failed_uids: failed }],
    "id",
  );
  return { uids: uids.length, rows: rows.length, failed, days };
}
