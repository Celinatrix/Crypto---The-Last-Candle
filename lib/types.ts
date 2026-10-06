export type MemberStatus = "active" | "warned" | "kicked";

export interface Member {
  uid: string;
  email: string;
  status: MemberStatus;
  joinedAt: string;
  warnedAt: string | null;
}

export interface DailyVolume {
  /** YYYY-MM-DD */
  day: string;
  volume: number;
}

export interface VolumeSummary {
  total30: number;
  total14: number;
  /** 30 items, oldest → newest */
  daily: DailyVolume[];
  updatedAt: string;
}

export type MeResponse =
  | { member: null; volume?: null; error?: string }
  | { member: Member; volume: VolumeSummary | null; error?: string };

export interface NewsPost {
  id: number | string;
  url: string;
  text: string;
  /** ISO string or unix timestamp (seconds or ms) */
  date: string | number;
  views: number | null;
  photo: string | null;
}

export interface NewsResponse {
  channel: string;
  posts: NewsPost[];
  error?: string;
}

export type RegisterResult = { ok: true } | { ok: false; error: string };

export interface SessionUser {
  id: number;
  username: string | null;
  firstName: string;
  photoUrl: string | null;
}
