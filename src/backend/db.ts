/**
 * Minimal Supabase (PostgREST) client for server code, using the service_role key.
 * Never import this from frontend/: the key bypasses row level security.
 */

/**
 * Auth headers for a Supabase server key. New secret keys (`sb_secret_…`) go only in
 * `apikey`; legacy service_role JWTs (`eyJ…`) are also sent as a Bearer token.
 */
export function supabaseAuth(key: string): Record<string, string> {
  return key.startsWith("eyJ") ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY chưa được cấu hình");
  return { url: url.replace(/\/$/, ""), key };
}

async function request<T>(path: string, init: { method: string; body?: unknown; prefer?: string }): Promise<T> {
  const { url, key } = config();
  const send = () =>
    fetch(`${url}/rest/v1/${path}`, {
      method: init.method,
      headers: {
        ...supabaseAuth(key),
        "Content-Type": "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      // A healthy call takes well under 1s; a stalled connection is retried instead of awaited.
      signal: AbortSignal.timeout(8_000),
    });

  // Retry dropped connections and gateway errors (the request never reached Postgres, or
  // failed before committing). Writes here are upserts/inserts guarded by unique keys.
  let res: Response | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await send();
      if (![502, 503, 504].includes(res.status) || attempt === 3) break;
    } catch (err) {
      if (attempt === 3) throw new Error(`Supabase ${init.method} ${path.split("?")[0]}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${init.method} ${path.split("?")[0]}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** PostgREST filter value, URL-encoded: `eq(x)` → "eq.<x>". */
export const eq = (v: string | number) => `eq.${encodeURIComponent(String(v))}`;

/** A hex digest as a Postgres bytea literal (how PostgREST reads and writes bytea). */
export const bytea = (hex: string) => `\\x${hex}`;

/** GET rows: `select("members", "bingx_uid=eq.1&select=id")`. */
export async function select<T>(table: string, query: string): Promise<T[]> {
  return request<T[]>(`${table}?${query}`, { method: "GET" });
}

/**
 * Every row of a table, 1,000 at a time (PostgREST caps one response at 1,000 rows).
 * `order` must be a unique column so pages never overlap.
 */
export async function selectAll<T>(table: string, order = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await select<T>(table, `select=*&order=${order}.asc&limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** Insert or update on the given unique columns, in chunks. */
export async function upsert(table: string, rows: object[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    await request(`${table}?on_conflict=${onConflict}`, {
      method: "POST",
      body: rows.slice(i, i + 500),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
}

export async function insertOne<T>(table: string, row: object): Promise<T> {
  const rows = await request<T[]>(table, { method: "POST", body: row, prefer: "return=representation" });
  const first = rows[0];
  if (!first) throw new Error(`insertOne(${table}): server returned no rows`);
  return first;
}

export async function update(table: string, filter: string, patch: object): Promise<void> {
  await request(`${table}?${filter}`, { method: "PATCH", body: patch, prefer: "return=minimal" });
}

export async function rpc<T>(fn: string, args: object = {}): Promise<T> {
  return request<T>(`rpc/${fn}`, { method: "POST", body: args });
}
