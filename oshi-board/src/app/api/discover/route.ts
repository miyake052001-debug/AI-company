import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/cache";
import { demoDiscover } from "@/lib/server/demo";
import { getLiveVtubers } from "@/lib/server/holodex";
import { providerStatus } from "@/lib/server/providers";
import { rateLimit } from "@/lib/server/rateLimit";
import { getJapaneseLiveStreams } from "@/lib/server/twitch";
import type { DiscoverResponse, Stream } from "@/lib/types";

/** GET /api/discover — フォローしていなくても見られる「いま配信中」の一覧（全員共通） */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "discover", 60);
  if (limited) return limited;
  const providers = providerStatus();
  const errors: string[] = [];
  const load = async (enabled: boolean, kind: "twitch" | "vtuber", fn: () => Promise<Stream[]>) => {
    if (!enabled) return demoDiscover(kind);
    try {
      return await fn();
    } catch (e) {
      errors.push(errorMessage(e));
      return [];
    }
  };
  const [vtubers, twitch] = await Promise.all([
    load(providers.holodex, "vtuber", getLiveVtubers),
    load(providers.twitch, "twitch", getJapaneseLiveStreams),
  ]);
  const body: DiscoverResponse = { vtubers, twitch, providers, errors };
  return NextResponse.json(body, {
    headers: { "Cache-Control": errors.length > 0 ? "public, s-maxage=15" : "public, s-maxage=60, stale-while-revalidate=60" },
  });
}
