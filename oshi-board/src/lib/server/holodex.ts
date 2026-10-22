import "server-only";
import { CLIP_PERIOD_MS, type ClipRow } from "@/lib/types";
import { cached } from "./cache";

/*
 * Holodex（https://holodex.net）は VTuber の切り抜きを元配信者に紐づけて管理しているので、
 * 「このVTuberの切り抜き」を YouTube 検索よりずっと正確に取れる。APIキーは無料（アカウント設定から発行）。
 */

const HOLODEX = "https://holodex.net/api/v2";
const PAGE_SIZE = 50;
/** 直近30日分を最大このページ数まで取る（人気の人は1ヶ月で数百本ある） */
const MAX_PAGES = 4;

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

function toRow(v: HolodexVideo): ClipRow {
  return {
    id: `yt:${v.id}`,
    source: `yt:${v.id}`,
    platform: "youtube",
    title: v.title,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    channelName: v.channel?.name ?? "",
    publishedAt: v.published_at ?? v.available_at ?? new Date().toISOString(),
    durationSec: v.duration,
    via: "holodex",
  };
}

/** 直近30日の切り抜き（新しい順）。期間の絞り込みは呼び出し側で行う */
export async function getHolodexClips(youtubeChannelId: string): Promise<ClipRow[]> {
  return cached<ClipRow[]>(
    `hd:clips:${youtubeChannelId}`,
    { ttl: 30 * 60_000, errorTtl: 5 * 60_000, staleOnError: true },
    async () => {
      const cutoff = Date.now() - CLIP_PERIOD_MS["30d"];
      const rows: ClipRow[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL(`${HOLODEX}/channels/${youtubeChannelId}/clips`);
        url.searchParams.set("limit", String(PAGE_SIZE));
        url.searchParams.set("offset", String(page * PAGE_SIZE));
        url.searchParams.set("lang", process.env.HOLODEX_CLIP_LANG ?? "ja");
        const res = await fetch(url, {
          cache: "no-store",
          headers: { "X-APIKEY": process.env.HOLODEX_API_KEY ?? "" },
        });
        if (!res.ok) throw new Error(`Holodex: ${res.status} ${res.statusText}`);
        const videos = (await res.json()) as HolodexVideo[];
        // 予約中のプレミア公開・配信中・削除済みは再生できる切り抜きではない
        rows.push(...videos.filter((v) => v.status !== "upcoming" && v.status !== "live" && v.status !== "missing").map(toRow));
        const oldest = videos.at(-1);
        const oldestAt = Date.parse(oldest?.available_at ?? oldest?.published_at ?? "");
        if (videos.length < PAGE_SIZE || Number.isNaN(oldestAt) || oldestAt < cutoff) break;
      }
      return rows;
    },
  );
}
