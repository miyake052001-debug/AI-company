import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/cache";
import { demoClips } from "@/lib/server/demo";
import { getHolodexClips } from "@/lib/server/holodex";
import { providerStatus } from "@/lib/server/providers";
import { getTwitchClips } from "@/lib/server/twitch";
import { searchYouTubeClips } from "@/lib/server/youtube";
import {
  CLIP_PERIOD_MS,
  isClipPeriod,
  TWITCH_LOGIN_RE,
  YOUTUBE_CHANNEL_ID_RE,
  type ChannelError,
  type Clip,
  type ClipsResponse,
} from "@/lib/types";

/** GET /api/clips?id=talentId&name=名前&yt=UCxxx&tw=login&period=7d */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const id = params.get("id")?.slice(0, 80) ?? "";
  const name = params.get("name")?.trim().slice(0, 60) ?? "";
  const yt = params.get("yt") ?? "";
  const tw = params.get("tw")?.toLowerCase() ?? "";
  const periodParam = params.get("period");
  const period = isClipPeriod(periodParam) ? periodParam : "7d";
  if (!id || !name) return NextResponse.json({ error: "id と name は必須です" }, { status: 400 });

  const youtubeChannelId = YOUTUBE_CHANNEL_ID_RE.test(yt) ? yt : undefined;
  const twitchLogin = TWITCH_LOGIN_RE.test(tw) ? tw : undefined;
  const providers = providerStatus();
  const cutoff = Date.now() - CLIP_PERIOD_MS[period];

  const clips: Clip[] = [];
  const errors: ChannelError[] = [];
  const attempt = async (channel: string, fn: () => Promise<Clip[]>) => {
    try {
      clips.push(...(await fn()));
    } catch (e) {
      errors.push({ channel, message: errorMessage(e) });
    }
  };

  const tasks: Promise<void>[] = [];

  // YouTube の切り抜き: Holodex → YouTube 検索 → デモ の順に使えるものを使う
  if (youtubeChannelId && providers.holodex) {
    tasks.push(attempt(`yt:${youtubeChannelId}`, () => getHolodexClips({ id, youtubeChannelId })));
  } else if (providers.youtube) {
    tasks.push(attempt("youtube", () => searchYouTubeClips({ id, name, youtubeChannelId }, period)));
  } else {
    clips.push(...demoClips({ id, name }, "youtube", CLIP_PERIOD_MS[period]));
  }

  if (twitchLogin) {
    if (providers.twitch) tasks.push(attempt(`tw:${twitchLogin}`, () => getTwitchClips({ id, twitchLogin }, period)));
    else clips.push(...demoClips({ id, name }, "twitch", CLIP_PERIOD_MS[period]));
  }

  await Promise.all(tasks);

  const body: ClipsResponse = {
    clips: clips.filter((c) => Date.parse(c.publishedAt) >= cutoff),
    errors,
    providers,
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" },
  });
}
