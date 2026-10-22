import "server-only";
import type { Clip } from "@/lib/types";
import { cached } from "./cache";

/*
 * Holodex（https://holodex.net）は VTuber の切り抜きを元配信者に紐づけて管理しているので、
 * 「このVTuberの切り抜き」を YouTube 検索よりずっと正確に取れる。APIキーは無料（アカウント設定から発行）。
 */

const HOLODEX = "https://holodex.net/api/v2";

export function holodexEnabled(): boolean {
  return !!process.env.HOLODEX_API_KEY;
}

interface HolodexVideo {
  id: string;
  title: string;
  type: string;
  published_at?: string;
  available_at?: string;
  duration?: number;
  status?: string;
  channel?: { id: string; name: string; english_name?: string };
}

export async function getHolodexClips(talent: { id: string; youtubeChannelId: string }): Promise<Clip[]> {
  return cached(`hd:clips:${talent.youtubeChannelId}`, 30 * 60_000, async () => {
    const url = new URL(`${HOLODEX}/channels/${talent.youtubeChannelId}/clips`);
    url.searchParams.set("limit", "50");
    url.searchParams.set("lang", process.env.HOLODEX_CLIP_LANG ?? "ja");
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "X-APIKEY": process.env.HOLODEX_API_KEY ?? "" },
    });
    if (!res.ok) throw new Error(`Holodex: ${res.status} ${res.statusText}`);
    const videos = (await res.json()) as HolodexVideo[];
    return videos
      .filter((v) => v.status !== "missing")
      .map(
        (v): Clip => ({
          id: `yt:${v.id}`,
          source: `yt:${v.id}`,
          platform: "youtube",
          title: v.title,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnailUrl: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
          channelName: v.channel?.name ?? "",
          talentId: talent.id,
          publishedAt: v.published_at ?? v.available_at ?? new Date().toISOString(),
          durationSec: v.duration,
          via: "holodex",
        }),
      );
  });
}
