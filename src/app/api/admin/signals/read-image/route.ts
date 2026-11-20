/**
 * POST /api/admin/signals/read-image  { images: [{ mediaType, data }] }   (data: base64, ≤ 4 images)
 * Reads signal screenshots with Claude and returns drafts; nothing is posted.
 * Signed-in admins only, same-origin requests only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { currentAdmin } from "@/backend/admin";
import { sameOrigin } from "@/backend/guard";
import { IMAGE_TYPES, readSignalImages, type SignalImage } from "@/backend/signalImage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGES = 4;
/** Base64 characters, about 3 MB of image in total (Vercel caps request bodies at 4.5 MB). */
const MAX_TOTAL_CHARS = 4_000_000;

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return fail("Yêu cầu không hợp lệ.", 403);
  try {
    if (!(await currentAdmin(req))) return fail("Chưa đăng nhập.", 401);
    if (!process.env.ANTHROPIC_API_KEY) return fail("Chưa cấu hình ANTHROPIC_API_KEY nên chưa đọc được ảnh.", 503);

    const b = (await req.json().catch(() => null)) as { images?: unknown } | null;
    const list = Array.isArray(b?.images) ? b.images : [];
    if (list.length === 0 || list.length > MAX_IMAGES) return fail(`Gửi từ 1 đến ${MAX_IMAGES} ảnh.`, 400);
    const images: SignalImage[] = [];
    let total = 0;
    for (const item of list as Record<string, unknown>[]) {
      const mediaType = item?.mediaType;
      const data = item?.data;
      if (typeof data !== "string" || !(IMAGE_TYPES as readonly unknown[]).includes(mediaType) || !/^[A-Za-z0-9+/=]+$/.test(data)) {
        return fail("Ảnh không hợp lệ.", 400);
      }
      total += data.length;
      images.push({ mediaType: mediaType as SignalImage["mediaType"], data });
    }
    if (total > MAX_TOTAL_CHARS) return fail("Ảnh quá lớn. Hãy cắt bớt hoặc gửi ít ảnh hơn.", 413);

    return NextResponse.json({ ok: true, ...(await readSignalImages(images)) });
  } catch (err) {
    console.error("[/api/admin/signals/read-image]", err);
    return fail("Không đọc được ảnh. Vui lòng thử lại hoặc nhập tay.", 502);
  }
}
