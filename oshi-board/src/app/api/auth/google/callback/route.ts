import type { NextRequest } from "next/server";
import { exchangeGoogleCode } from "@/lib/server/imports";
import { backToChannels, callbackUrl, verifyState } from "@/lib/server/oauth";
import { rateLimit } from "@/lib/server/rateLimit";

/** GET /api/auth/google/callback — 認可コードをトークンに交換して、取り込み用に一時保存する */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "auth", 20);
  if (limited) return limited;
  const params = request.nextUrl.searchParams;
  if (params.get("error")) {
    return backToChannels(request, "google", { ok: false, error: "cancelled" });
  }
  const code = params.get("code");
  if (!code || !verifyState(request, "google")) {
    return backToChannels(request, "google", { ok: false, error: "state" });
  }
  try {
    const token = await exchangeGoogleCode(code, callbackUrl(request, "google"));
    return backToChannels(request, "google", { ok: true, token });
  } catch (e) {
    console.error("[oshi-board] Google token exchange failed:", e);
    return backToChannels(request, "google", { ok: false, error: "exchange" });
  }
}
