import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/cache";
import { fetchTwitchFollows, revokeTwitchToken } from "@/lib/server/imports";
import { clearToken, readToken } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/rateLimit";

/** POST /api/import/twitch — ログイン直後に一度だけ呼ぶ。フォロー一覧を返し、トークンは失効させる */
export async function POST(request: NextRequest) {
  const token = readToken(request, "twitch");
  const limited = rateLimit(request, "import", 10);
  if (limited) {
    // 取り込めないトークンを残さない（もう一度ログインからやり直してもらう）
    if (token) await revokeTwitchToken(token);
    return clearToken(limited, "twitch");
  }
  if (!token) {
    return NextResponse.json({ error: "Twitch へのログインからやり直してください" }, { status: 401 });
  }
  try {
    const result = await fetchTwitchFollows(token);
    return clearToken(NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }), "twitch");
  } catch (e) {
    return clearToken(
      NextResponse.json({ error: errorMessage(e) }, { status: 502, headers: { "Cache-Control": "no-store" } }),
      "twitch",
    );
  } finally {
    await revokeTwitchToken(token);
  }
}
