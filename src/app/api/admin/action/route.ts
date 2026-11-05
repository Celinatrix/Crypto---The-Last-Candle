/**
 * POST /api/admin/action — one admin decision. Body: { action, id }
 *   approve: let a waiting member in           reject: remove a waiting link (the UID is freed)
 *   kick:    confirm removal from the group    keep:   let them stay, from the current cycle
 * Signed-in admins only; each decision is recorded in audit_log with the admin's address.
 */
import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/backend/admin";
import { rpc } from "@/backend/db";
import { sameOrigin } from "@/backend/guard";

export const dynamic = "force-dynamic";

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Yêu cầu không hợp lệ.", 403);

  try {
    const admin = await currentAdmin(req);
    if (!admin) return fail("Chưa đăng nhập.", 401);

    const body = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
    const id = body?.id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return fail("Dữ liệu không hợp lệ.", 400);

    let done: boolean;
    switch (body?.action) {
      case "approve":
        done = await rpc<boolean>("admin_approve_member", { p_member_id: id, p_by: admin });
        break;
      case "reject":
        done = await rpc<boolean>("admin_reject_member", { p_member_id: id });
        break;
      case "kick":
        done = await rpc<boolean>("admin_decide_kick", { p_review_id: id, p_decision: "approved", p_by: admin });
        break;
      case "keep":
        done = await rpc<boolean>("admin_decide_kick", { p_review_id: id, p_decision: "rejected", p_by: admin });
        break;
      default:
        return fail("Dữ liệu không hợp lệ.", 400);
    }
    if (!done) return fail("Mục này đã được xử lý trước đó. Hãy tải lại danh sách.", 409);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[/api/admin/action]", err);
    return fail("Lỗi máy chủ. Vui lòng thử lại sau.", 500);
  }
}
