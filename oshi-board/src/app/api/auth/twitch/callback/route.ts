import type { NextRequest } from "next/server";
import { exchangeTwitchCode } from "@/lib/server/imports";
import { backToChannels, callbackUrl, verifyState } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/rateLimit";

/** GET /api/auth/twitch/callback — 認可コードをトークンに交換して、取り込み用に一時保存する */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "auth", 20);
  if (limited) return limited;
  const params = request.nextUrl.searchParams;
  if (params.get("error")) {
    return backToChannels(request, "twitch", { ok: false, error: "cancelled" });
  }
  const code = params.get("code");
  if (!code || !verifyState(request, "twitch")) {
    return backToChannels(request, "twitch", { ok: false, error: "state" });
  }
  try {
    const token = await exchangeTwitchCode(code, callbackUrl(request, "twitch"));
    return backToChannels(request, "twitch", { ok: true, token });
  } catch (e) {
    console.error("[oshi-board] Twitch token exchange failed:", e);
    return backToChannels(request, "twitch", { ok: false, error: "exchange" });
  }
}
