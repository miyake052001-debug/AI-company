import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/cache";
import { fetchYouTubeSubscriptions, revokeGoogleToken } from "@/lib/server/imports";
import { clearToken, readToken } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/rateLimit";

/** POST /api/import/google — ログイン直後に一度だけ呼ぶ。YouTube の登録チャンネルを返し、トークンは失効させる */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request, "import", 10);
  if (limited) return limited;
  const token = readToken(request, "google");
  if (!token) {
    return NextResponse.json({ error: "Google へのログインからやり直してください" }, { status: 401 });
  }
  try {
    const result = await fetchYouTubeSubscriptions(token);
    return clearToken(NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }), "google");
  } catch (e) {
    return clearToken(
      NextResponse.json({ error: errorMessage(e) }, { status: 502, headers: { "Cache-Control": "no-store" } }),
      "google",
    );
  } finally {
    await revokeGoogleToken(token);
  }
}
