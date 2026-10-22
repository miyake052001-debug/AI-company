import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/cache";
import { demoStreams } from "@/lib/server/demo";
import { parseList, providerStatus } from "@/lib/server/providers";
import { getTwitchStreams } from "@/lib/server/twitch";
import { getYouTubeStreams } from "@/lib/server/youtube";
import { TWITCH_LOGIN_RE, YOUTUBE_CHANNEL_ID_RE, type ChannelError, type Stream, type StreamsResponse } from "@/lib/types";

const STATUS_ORDER = { live: 0, upcoming: 1, ended: 2 } as const;

function compare(a: Stream, b: Stream): number {
  if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (a.status === "live") return (b.viewers ?? 0) - (a.viewers ?? 0);
  if (a.status === "upcoming") return Date.parse(a.startAt ?? "") - Date.parse(b.startAt ?? "");
  return Date.parse(b.endAt ?? b.startAt ?? "") - Date.parse(a.endAt ?? a.startAt ?? "");
}

/** GET /api/streams?yt=UCxxx,UCyyy&tw=login1,login2 */
export async function GET(request: NextRequest) {
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
    streams: streams.sort(compare),
    errors,
    providers,
    fetchedAt: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" },
  });
}
