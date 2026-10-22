import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/server/rateLimit";
import { parseMediaInput } from "@/lib/media";
import { errorMessage } from "@/lib/server/cache";
import { resolveTwitchUser, twitchEnabled } from "@/lib/server/twitch";
import { resolveYouTubeChannel } from "@/lib/server/youtube";
import { TWITCH_LOGIN_RE, type ResolveResponse } from "@/lib/types";

/** Twitch のチャンネルURL（twitch.tv/<login>/...）か、ログイン名そのもの */
function twitchLoginFrom(input: string): string | null {
  const raw = input.trim();
  const bare = /^@?([A-Za-z0-9_]{1,25})$/.exec(raw)?.[1];
  if (bare) return bare.toLowerCase();
  const source = parseMediaInput(raw);
  return source?.kind === "tw" && TWITCH_LOGIN_RE.test(source.id) ? source.id : null;
}

/** GET /api/resolve?platform=youtube|twitch&q=URL・@ハンドル・ID */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request, "resolve", 20);
  if (limited) return limited;
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim().slice(0, 300) ?? "";
  const platform = params.get("platform");
  if (!q) return NextResponse.json({ error: "q を指定してください" }, { status: 400 });

  try {
    if (platform === "twitch") {
      const login = twitchLoginFrom(q);
      if (!login) return NextResponse.json({ error: "Twitch のIDかURLを入力してください" }, { status: 400 });
      if (!twitchEnabled()) {
        return NextResponse.json<ResolveResponse>({ platform: "twitch", id: login, verified: false });
      }
      const user = await resolveTwitchUser(login);
      if (!user) return NextResponse.json({ error: `Twitch ユーザー「${login}」が見つかりません` }, { status: 404 });
      return NextResponse.json<ResolveResponse>({
        platform: "twitch",
        id: user.login,
        name: user.displayName,
        avatarUrl: user.avatarUrl,
        verified: true,
      });
    }

    const channel = await resolveYouTubeChannel(q);
    if (!channel) {
      return NextResponse.json(
        { error: "YouTube チャンネルが見つかりません。チャンネルURL（/channel/UC... か /@ハンドル）を入れてください" },
        { status: 404 },
      );
    }
    return NextResponse.json<ResolveResponse>({
      platform: "youtube",
      id: channel.channelId,
      name: channel.name,
      avatarUrl: channel.avatarUrl,
      verified: !!channel.name,
    });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 502 });
  }
}
