import type { NextRequest } from "next/server";
import { bytea, rpc } from "./db";
import { extractToken, sha256 } from "./session";

/** True when the request carries a valid member session (any linked UID). */
export async function hasMemberSession(req: NextRequest): Promise<boolean> {
  const token = extractToken(req);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  return rpc<boolean>("member_session_ok", { p_token_hash: bytea(sha256(token)) });
}
