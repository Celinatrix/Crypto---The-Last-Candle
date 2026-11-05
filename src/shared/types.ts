/** "pending": linked, waiting for the admin to approve the UID ↔ Gmail link (no volume shown). */
export type MemberStatus = "pending" | "active" | "warned" | "kicked";

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

export type RegisterResult = { ok: true } | { ok: false; error: string };

/** A linked member as the admin page sees them, with this cycle's volume. */
export interface AdminMember {
  memberId: number;
  uid: string;
  email: string;
  status: MemberStatus;
  joinedAt: string | null;
  volume: number;
  tradeDays: number;
  shortfall: number;
  /** For someone out of the group: volume traded since the kick, towards coming back. */
  rejoin: { volume: number; target: number; ready: boolean } | null;
}

export interface AdminOverview {
  admin: string;
  cycle: { start: string; end: string; target: number };
  lastSync: { status: string; at: string } | null;
  /** Highest volume first. */
  members: AdminMember[];
  kickReviews: {
    reviewId: number;
    uid: string;
    email: string;
    startDay: string;
    endDay: string;
    volume: number;
    target: number;
  }[];
  /** Partner-link UIDs that traded this cycle but never linked the site. */
  unlinked: { uid: string; volume: number; tradeDays: number }[];
}

/** The admin page's charts: see /api/admin/stats for which days each list covers. */
export interface AdminStats {
  today: string;
  lastVolumeDay: string;
  depositDay: string;
  volumeDay: string;
  /** Last time deposits were read from BingX; null until the first time. */
  syncedAt: string | null;
  failedUids: number;
  volumeDaily: { day: string; linked: number; other: number; traders: number }[];
  depositDaily: {
    day: string;
    onchain: number;
    p2p: number;
    transfer: number;
    events: number;
    uids: number;
    otherCurrency: number;
  }[];
  deposits: {
    uid: string;
    email: string | null;
    time: string;
    assetType: number;
    typeName: string;
    currency: string;
    amount: number;
  }[];
  dayVolumes: { uid: string; email: string | null; volume: number }[];
}

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
