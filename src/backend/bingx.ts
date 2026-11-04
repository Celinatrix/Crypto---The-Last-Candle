import { createHmac } from "node:crypto";

/** BingX Agent (affiliate) API, read-only key. Docs: bingx-api.github.io/docs-v3 → Agent. */
const BASE_URL = "https://open-api.bingx.com";
const DAY_MS = 86_400_000;
/** commissionDataList rejects windows longer than 7 days. */
const MAX_WINDOW_MS = 7 * DAY_MS - 1;

interface BingxEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}

async function signedGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const apiKey = process.env.BINGX_API_KEY;
  const secret = process.env.BINGX_SECRET_KEY;
  if (!apiKey || !secret) throw new Error("BINGX_API_KEY / BINGX_SECRET_KEY chưa được cấu hình");

  // A request occasionally hangs or drops: time out after 10s and retry (fresh timestamp/signature).
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const all: Record<string, string | number> = { ...params, recvWindow: 5000, timestamp: Date.now() };
    const query = Object.keys(all)
      .sort()
      .map((k) => `${k}=${all[k]}`)
      .join("&");
    const signature = createHmac("sha256", secret).update(query).digest("hex");

    try {
      const res = await fetch(`${BASE_URL}${path}?${query}&signature=${signature}`, {
        headers: { "X-BX-APIKEY": apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`BingX ${path}: HTTP ${res.status}`);
      if (!res.ok) throw new FatalError(`BingX ${path}: HTTP ${res.status}`);
      const body = (await res.json()) as BingxEnvelope<T>;
      if (body.code !== 0) throw new FatalError(`BingX ${path}: code ${body.code} ${body.msg ?? ""}`.trim());
      return body.data as T;
    } catch (err) {
      if (err instanceof FatalError) throw err;
      lastError = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`BingX ${path}: ${reason} (sau 3 lần thử)`);
}

/** An error retrying cannot fix (bad key, bad params). */
class FatalError extends Error {}

export interface Invitee {
  uid: number;
  directInvitation: boolean;
  registeredAt: string | null;
}

interface InviteePage {
  total: number;
  list: { uid: string | number; directInvitation: boolean; registerTime?: number; registerDateTime?: number }[];
}

/** Every UID registered under the partner link (direct and indirect). */
export async function fetchInvitees(): Promise<Invitee[]> {
  const pageSize = 200;
  const out: Invitee[] = [];
  for (let pageIndex = 1; ; pageIndex++) {
    const page = await signedGet<InviteePage>("/openApi/agent/v1/account/inviteAccountList", { pageIndex, pageSize });
    for (const u of page.list) {
      const registered = u.registerTime ?? u.registerDateTime;
      out.push({
        uid: Number(u.uid),
        directInvitation: Boolean(u.directInvitation),
        registeredAt: registered ? new Date(registered).toISOString() : null,
      });
    }
    if (page.list.length < pageSize || out.length >= page.total) return out;
  }
}

/**
 * Looks one UID up live (inviteRelationCheck), for people who registered on BingX after the
 * last daily sync. Returns the invitee, or null when the UID is not under the partner link.
 * Network problems throw.
 */
export async function checkInvitee(uid: number): Promise<Invitee | null> {
  let data: { inviteResult?: boolean; directInvitation?: boolean; registerDateTime?: number; registerTime?: number };
  try {
    data = (await signedGet<typeof data | undefined>("/openApi/agent/v1/account/inviteRelationCheck", { uid })) ?? {};
  } catch (err) {
    // BingX answers an unknown / unrelated UID with a non-zero code.
    if (err instanceof FatalError) return null;
    throw err;
  }
  if (data.inviteResult !== true) return null;
  const registered = data.registerDateTime ?? data.registerTime;
  return {
    uid,
    directInvitation: Boolean(data.directInvitation),
    registeredAt: registered ? new Date(registered).toISOString() : null,
  };
}

export interface DailyVolumeRow {
  uid: number;
  /** UTC day, "YYYY-MM-DD" */
  day: string;
  /** Decimal strings as sent by BingX, so no float rounding before Postgres */
  perpetual: string;
  tradfi: string;
}

interface CommissionPage {
  total: number;
  list?: { uid: number; commissionTime: number; tradingVolume: string }[];
}

async function fetchCommissionRows(businessType: string, startTime: number, endTime: number) {
  const pageSize = 100;
  const rows: NonNullable<CommissionPage["list"]> = [];
  for (let pageIndex = 1; ; pageIndex++) {
    const page = await signedGet<CommissionPage | undefined>("/openApi/agent/v2/reward/commissionDataList", {
      businessType,
      startTime,
      endTime,
      pageIndex,
      pageSize,
    });
    // A business type with no activity comes back without `data` at all.
    const list = page?.list ?? [];
    rows.push(...list);
    if (list.length < pageSize || rows.length >= (page?.total ?? 0)) return rows;
  }
}

/**
 * Perpetual-futures and TradFi volume per UID per UTC day between two instants.
 * Queried per business type because the unfiltered query was seen dropping rows, and
 * TradFi is reported inside perpetualFutures (crypto futures = perpetual − tradFi).
 * BingX may return days just outside the window; callers upsert them all.
 */
export async function fetchDailyFuturesVolume(from: number, to: number): Promise<DailyVolumeRow[]> {
  const byKey = new Map<string, DailyVolumeRow>();
  for (let start = from; start < to; start += MAX_WINDOW_MS + 1) {
    const end = Math.min(start + MAX_WINDOW_MS, to);
    for (const type of ["perpetualFutures", "tradFi"] as const) {
      for (const r of await fetchCommissionRows(type, start, end)) {
        const day = new Date(r.commissionTime).toISOString().slice(0, 10);
        const key = `${r.uid}|${day}`;
        const row = byKey.get(key) ?? { uid: Number(r.uid), day, perpetual: "0", tradfi: "0" };
        if (type === "perpetualFutures") row.perpetual = r.tradingVolume;
        else row.tradfi = r.tradingVolume;
        byKey.set(key, row);
      }
    }
  }
  return [...byKey.values()];
}

export const startOfUtcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
export { DAY_MS };
