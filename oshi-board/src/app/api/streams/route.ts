import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/rateLimit";
import { compareStreams } from "@/lib/streams";
import { errorMessage } from "@/lib/server/cache";
import { demoStreams } from "@/lib/server/demo";
import { parseList, providerStatus } from "@/lib/server/providers";
import { getTwitchStreams } from "@/lib/server/twitch";
import { getYouTubeStreams } from "@/lib/server/youtube";
import { TWITCH_LOGIN_RE, YOUTUBE_CHANNEL_ID_RE, type ChannelError, type Stream, type StreamsResponse } from "@/lib/types";

/** GET /api/streams?yt=UCxxx,UCyyy&tw=login1,login2 */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "streams", 240);
  if (limited) return limited;
  const params = request.nextUrl.searchParams;
  const yt = parseList(params.get("yt"), 150).filter((id) => YOUTUBE_CHANNEL_ID_RE.test(id));
  const tw = parseList(params.get("tw")?.toLowerCase() ?? null, 100).filter((l) => TWITCH_LOGIN_RE.test(l));
  const providers = providerStatus();

  const streams: Stream[] = [];
  const errors: ChannelError[] = [];

  const run = async (
    enabled: boolean,
    platform: "youtube" | "twitch",
    channels: string[],
    fetcher: (c: string[]) => Promise<{ streams: Stream[]; errors: ChannelError[] }>,
  ) => {
    if (channels.length === 0) return;
    if (!enabled) {
      streams.push(...demoStreams(platform, channels));
      return;
    }
    try {
      const result = await fetcher(channels);
      streams.push(...result.streams);
      errors.push(...result.errors);
    } catch (e) {
      errors.push({ channel: platform, message: errorMessage(e) });
    }
  };

  await Promise.all([
    run(providers.youtube, "youtube", yt, getYouTubeStreams),
    run(providers.twitch, "twitch", tw, getTwitchStreams),
  ]);

  const body: StreamsResponse = {
    streams: streams.sort(compareStreams),
    errors,
    providers,
    fetchedAt: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    headers: {
      // API 全体の失敗（クォータ切れなど）を含む結果は CDN に長く残さない。チャンネル単位の失敗はサーバー側でキャッシュ済み
      "Cache-Control": errors.some((e) => !e.channel.includes(":"))
        ? "public, s-maxage=15"
        : "public, s-maxage=60, stale-while-revalidate=60",
    },
  });
}
