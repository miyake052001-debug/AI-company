import "server-only";
import type { ProviderStatus } from "@/lib/types";
import { holodexEnabled } from "./holodex";
import { twitchEnabled } from "./twitch";
import { youtubeEnabled } from "./youtube";

export function googleLoginEnabled(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function providerStatus(): ProviderStatus {
  return {
    youtube: youtubeEnabled(),
    twitch: twitchEnabled(),
    holodex: holodexEnabled(),
    googleLogin: googleLoginEnabled(),
  };
}

export function parseList(value: string | null, max: number): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, max);
}
