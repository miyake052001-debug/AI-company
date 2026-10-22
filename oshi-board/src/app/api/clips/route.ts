import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/cache";
import { demoClips } from "@/lib/server/demo";
import { getHolodexClips } from "@/lib/server/holodex";
import { providerStatus } from "@/lib/server/providers";
import { getTwitchClips } from "@/lib/server/twitch";
import { searchYouTubeClips, videoViewCounts } from "@/lib/server/youtube";
import {
  CLIP_PERIOD_MS,
  isClipPeriod,
  TWITCH_LOGIN_RE,
  YOUTUBE_CHANNEL_ID_RE,
  type ChannelError,
  type Clip,
  type ClipRow,
  type ClipsResponse,
  type ProviderStatus,
} from "@/lib/types";

/** YouTube の切り抜き: Holodex → YouTube 検索 の順に使えるものを使う */
async function youtubeClips(
  providers: ProviderStatus,
  talent: { name: string; youtubeChannelId: string },
): Promise<ClipRow[]> {
  let holodexError: unknown;
  if (providers.holodex) {
    try {
      const rows = await getHolodexClips(talent.youtubeChannelId);
      // Holodex は再生数を持っていないので、YouTube のキーがあれば付ける（50本で1ユニット）
      if (rows.length > 0 && providers.youtube) {
        const views = await videoViewCounts(rows.map((r) => r.source.slice(3)));
        return rows.map((r) => ({ ...r, viewCount: views.get(r.source.slice(3)) }));
      }
      // Holodex が追跡していないチャンネルは空になるので、YouTube 検索に回す
      if (rows.length > 0 || !providers.youtube) return rows;
    } catch (e) {
      if (!providers.youtube) throw e;
      holodexError = e;
    }
  }
  try {
    return await searchYouTubeClips(talent);
  } catch (e) {
    throw holodexError ? new Error(`${errorMessage(holodexError)} / ${errorMessage(e)}`) : e;
  }
}

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

  const rows: ClipRow[] = [];
  const errors: ChannelError[] = [];
  const attempt = async (channel: string, fn: () => Promise<ClipRow[]>) => {
    try {
      rows.push(...(await fn()));
    } catch (e) {
      errors.push({ channel, message: errorMessage(e) });
    }
  };

  const tasks: Promise<void>[] = [];
  if (youtubeChannelId) {
    if (providers.holodex || providers.youtube) {
      tasks.push(attempt(`yt:${youtubeChannelId}`, () => youtubeClips(providers, { name, youtubeChannelId })));
    } else {
      rows.push(...demoClips({ id, name }, "youtube", CLIP_PERIOD_MS[period]));
    }
  }
  if (twitchLogin) {
    if (providers.twitch) tasks.push(attempt(`tw:${twitchLogin}`, () => getTwitchClips(twitchLogin, period)));
    else rows.push(...demoClips({ id, name }, "twitch", CLIP_PERIOD_MS[period]));
  }
  await Promise.all(tasks);

  // プロバイダのキャッシュは全員で共有しているので、タレントIDはここで付ける
  const clips: Clip[] = rows
    .filter((c) => Date.parse(c.publishedAt) >= cutoff)
    .map((c) => ({ ...c, talentId: id }));

  const body: ClipsResponse = { clips, errors, providers };
  return NextResponse.json(body, {
    headers: {
      // 失敗を含む結果を CDN に長く残さない
      "Cache-Control":
        errors.length > 0 ? "public, s-maxage=30" : "public, s-maxage=600, stale-while-revalidate=1800",
    },
  });
}
