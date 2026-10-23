import type { NextRequest } from "next/server";
import { backToChannels, callbackUrl, redirectToProvider } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/rateLimit";
import { twitchEnabled } from "@/lib/server/twitch";

/** GET /api/auth/twitch/start — Twitch のログイン画面へ（フォロー一覧の読み取りだけを許可してもらう） */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "auth", 20);
  if (limited) return limited;
  if (!twitchEnabled()) {
    return backToChannels(request, "twitch", { ok: false, error: "Twitch の API キーが設定されていません" });
  }
  return redirectToProvider(request, "twitch", (state) => {
    const url = new URL("https://id.twitch.tv/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", process.env.TWITCH_CLIENT_ID ?? "");
    url.searchParams.set("redirect_uri", callbackUrl(request, "twitch"));
    url.searchParams.set("scope", "user:read:follows");
    url.searchParams.set("state", state);
    return url.toString();
  });
}
