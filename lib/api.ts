import { DEV_MOCKS } from "./env";

import type { MeResponse, NewsResponse, RegisterResult } from "./types";

// Each mock branch repeats the inline NODE_ENV check so webpack can drop the
// dynamic import (and the mock chunk) from production builds.

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorOf(body: unknown): string | undefined {
  return isRecord(body) && typeof body.error === "string" && body.error ? body.error : undefined;
}

export async function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  if (process.env.NODE_ENV === "development" && DEV_MOCKS) return (await import("./mocks")).mockMe();

  const res = await fetch("/api/me", { cache: "no-store", credentials: "same-origin", signal });
  // No member cookie in this browser yet → treat as "not linked".
  if (res.status === 401) return { member: null };
  const body = await readJson(res);
  if (!res.ok || !isRecord(body) || !("member" in body)) {
    throw new Error(errorOf(body) ?? "Không tải được dữ liệu tài khoản. Vui lòng thử lại.");
  }
  return body as unknown as MeResponse;
}

const REGISTER_FALLBACK: Record<number, string> = {
  400: "UID hoặc email không hợp lệ.",
  403: "UID này không đăng ký BingX qua link đối tác của cộng đồng.",
  409: "UID này đã được liên kết với một Gmail khác.",
  429: "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.",
  502: "Không kết nối được tới BingX. Vui lòng thử lại sau.",
};

export async function registerMember(uid: string, email: string): Promise<RegisterResult> {
  if (process.env.NODE_ENV === "development" && DEV_MOCKS) return (await import("./mocks")).mockRegister(uid, email);

  let res: Response;
  try {
    res = await fetch("/api/register", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, email }),
    });
  } catch {
    return { ok: false, error: "Mất kết nối mạng. Vui lòng kiểm tra và thử lại." };
  }
  const body = await readJson(res);
  if (res.ok && isRecord(body) && body.ok === true) return { ok: true };
  return {
    ok: false,
    error: errorOf(body) ?? REGISTER_FALLBACK[res.status] ?? "Đã có lỗi xảy ra. Vui lòng thử lại.",
  };
}

export async function fetchNews(signal?: AbortSignal): Promise<NewsResponse> {
  if (process.env.NODE_ENV === "development" && DEV_MOCKS) return (await import("./mocks")).mockNews();

  const res = await fetch("/api/news", { cache: "no-store", signal });
  const body = await readJson(res);
  if (!isRecord(body) || !Array.isArray(body.posts)) {
    throw new Error(errorOf(body) ?? "Không tải được tin tức.");
  }
  return body as unknown as NewsResponse;
}

/** Clears this browser's member cookie (the UID stays registered on the backend). */
export async function logout(): Promise<void> {
  if (process.env.NODE_ENV === "development" && DEV_MOCKS) return;
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
}
