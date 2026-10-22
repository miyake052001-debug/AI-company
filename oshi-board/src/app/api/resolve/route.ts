import { NextResponse, type NextRequest } from "next/server";
import { errorMessage } from "@/lib/server/cache";
import { resolveTwitchUser, twitchEnabled } from "@/lib/server/twitch";
import { resolveYouTubeChannel } from "@/lib/server/youtube";
import { TWITCH_LOGIN_RE, type ResolveResponse } from "@/lib/types";

function twitchLoginFrom(input: string): string | null {
  const m = /(?:twitch\.tv\/)?([A-Za-z0-9_]{1,25})\/?$/.exec(input.trim());
  const login = m?.[1]?.toLowerCase();
  return login && TWITCH_LOGIN_RE.test(login) ? login : null;
}

/** GET /api/resolve?platform=youtube|twitch&q=URL・@ハンドル・ID */
export async function GET(request: NextRequest) {
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
