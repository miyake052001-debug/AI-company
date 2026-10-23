import type { NextRequest } from "next/server";
import { backToChannels, callbackUrl, redirectToProvider } from "@/lib/server/oauth";
import { googleLoginEnabled } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rateLimit";

/** GET /api/auth/google/start — Google のログイン画面へ（YouTube の読み取りだけを許可してもらう） */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "auth", 20);
  if (limited) return limited;
  if (!googleLoginEnabled()) {
    return backToChannels(request, "google", { ok: false, error: "Google ログインが設定されていません" });
  }
  return redirectToProvider(request, "google", (state) => {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
    url.searchParams.set("redirect_uri", callbackUrl(request, "google"));
    url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.readonly");
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("state", state);
    return url.toString();
  });
}
