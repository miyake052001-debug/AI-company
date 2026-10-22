import { NextResponse, type NextRequest } from "next/server";
import { parseSourceKey } from "@/lib/media";
import { videoMeta } from "@/lib/server/youtube";

/** GET /api/meta?src=yt:VIDEO_ID — 貼り付けたURLのタイトル表示用 */
export async function GET(request: NextRequest) {
  const source = parseSourceKey(request.nextUrl.searchParams.get("src") ?? "");
  if (!source || source.kind !== "yt") return NextResponse.json({ error: "unsupported" }, { status: 400 });
  const meta = await videoMeta(source.id).catch(() => null);
  if (!meta) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(meta, { headers: { "Cache-Control": "public, s-maxage=3600" } });
}
