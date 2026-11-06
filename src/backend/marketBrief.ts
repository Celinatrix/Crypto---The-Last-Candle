import { createHmac, timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { CalendarEvent } from "@/shared/types";
import { eq, insertOne, select, update } from "./db";
import type { AssetSnapshot } from "./marketData";
import { BRIEF_OUTPUT_SCHEMA, BRIEF_SYSTEM_PROMPT, briefFacts, buildBrief, checkBriefText, type MarketBrief } from "./marketBriefText";

const MODEL = "claude-opus-5-5";

/** Fits inside the job's 60 seconds. A failed draft is reported to the admin instead of retried. */
const client = () => new Anthropic({ timeout: 45_000, maxRetries: 0 });

/** Asks Claude for the two scenarios and refuses anything that fails the checks. */
export async function draftBrief(usdEvents: CalendarEvent[], assets: AssetSnapshot[], now: number): Promise<MarketBrief> {
  const facts = briefFacts(usdEvents, assets);
  const response = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: BRIEF_SYSTEM_PROMPT,
    output_config: { effort: "medium", format: { type: "json_schema", schema: BRIEF_OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: facts }],
  });
  if (response.stop_reason !== "end_turn") throw new Error(`Claude dừng với lý do ${response.stop_reason}`);
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Claude không trả về nội dung");
  const text = JSON.parse(block.text) as { strong: string; weak: string };
  for (const field of ["strong", "weak"] as const) {
    const problem = checkBriefText(text[field], facts);
    if (problem) throw new Error(`Kịch bản ${field}: ${problem}`);
  }
  return buildBrief(text, assets, now);
}

interface BriefRow {
  brief: MarketBrief;
  status: "pending" | "approved";
}

export async function getBrief(day: string): Promise<BriefRow | null> {
  const [row] = await select<BriefRow>("market_briefs", `day=${eq(day)}&select=brief,status`);
  return row ?? null;
}

/** The approved brief for this day. Any problem means the email simply goes out without it. */
export async function getApprovedBrief(day: string): Promise<MarketBrief | null> {
  try {
    const row = await getBrief(day);
    return row?.status === "approved" ? row.brief : null;
  } catch (err) {
    console.error("[market-brief] read failed", err);
    return null;
  }
}

export const saveDraft = (day: string, brief: MarketBrief) => insertOne("market_briefs", { day, brief });

export const approveBrief = (day: string) =>
  update("market_briefs", `day=${eq(day)}&status=eq.pending`, { status: "approved", approved_at: new Date().toISOString() });

// ---------------------------------------------------------------------------------------------
// Approval link in the admin's draft email
// ---------------------------------------------------------------------------------------------

function briefToken(day: string): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET chưa được cấu hình");
  return createHmac("sha256", secret).update(`market-brief:${day}`).digest("base64url");
}

export function checkBriefToken(day: string, token: string): boolean {
  const expected = Buffer.from(briefToken(day));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function briefApprovalUrl(siteUrl: string, day: string): string {
  const qs = new URLSearchParams({ d: day, t: briefToken(day) });
  return `${siteUrl.replace(/\/$/, "")}/api/brief/approve?${qs}`;
}
