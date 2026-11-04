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
  /**
   * Optional: first day ("YYYY-MM-DD", UTC) of the member's current — or most recent —
   * Premium cycle, as tracked by the backend. Needed once a member's history is longer
   * than `daily`; without it the page walks the cycles from `joinedAt`.
   */
  cycleStart?: string;
  /** Optional: number of the cycle that starts on `cycleStart` (defaults to 1). */
  cycleIndex?: number;
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

/** A high-impact ("red folder") economic calendar event. */
export interface CalendarEvent {
  id: string;
  title: string;
  /** Currency code as listed by ForexFactory, e.g. "USD" ("All" for global events) */
  currency: string;
  /** ISO timestamp (UTC) */
  time: string;
  forecast: string | null;
  previous: string | null;
}

export interface CalendarResponse {
  source: "ForexFactory";
  events: CalendarEvent[];
  fetchedAt: string;
  error?: string;
}
