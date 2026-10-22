import "server-only";
import { CLIP_PERIOD_MS, type ClipPeriod, type ClipRow } from "@/lib/types";
import { cached, peek } from "./cache";
import { videoViewCounts, youtubeEnabled, youtubeQuotaExhausted } from "./youtube";

/*
 * Holodex（https://holodex.net）は VTuber の切り抜きを元配信者に紐づけて管理しているので、
 * 「このVTuberの切り抜き」を YouTube 検索よりずっと正確に取れる。APIキーは無料（アカウント設定から発行）。
 */

const HOLODEX = "https://holodex.net/api/v2";
const PAGE_SIZE = 50;

/** 期間ごとに何ページまで遡るか（人気の人は1日に数十本あるので、長い期間ほど多く）とキャッシュ時間 */
const PLAN: Record<ClipPeriod, { maxPages: number; ttl: number }> = {
  "24h": { maxPages: 4, ttl: 30 * 60_000 },
  "7d": { maxPages: 10, ttl: 60 * 60_000 },
  "30d": { maxPages: 20, ttl: 3 * 60 * 60_000 },
};

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

export interface HolodexClips {
  rows: ClipRow[];
  /** 上限ページまで取っても期間の最初まで届かなかった */
  truncated: boolean;
  /** Holodex がこのチャンネルを追跡しているか（期間内が0件でも、過去の切り抜きがあれば true） */
  tracked: boolean;
}

interface CachedHolodexClips extends HolodexClips {
  /** 再生数を全部付けられたか（一時的な失敗で欠けたら短くキャッシュする） */
  viewsComplete: boolean;
}

/** 期間内の切り抜き（新しい順）。YouTube のキーがあれば再生数も付ける（Holodex は再生数を持っていないため） */
export async function getHolodexClips(youtubeChannelId: string, period: ClipPeriod): Promise<HolodexClips> {
  const plan = PLAN[period];
  const result = await cached<CachedHolodexClips>(
    `hd:clips:${youtubeChannelId}:${period}`,
    {
      // 再生数が一時的な失敗で欠けたときだけ早めに取り直す（クォータ切れなら0時まで直らないので通常どおり）
      ttl: (r) => (r.viewsComplete || youtubeQuotaExhausted() ? plan.ttl : 5 * 60_000),
      errorTtl: 5 * 60_000,
      staleOnError: true,
    },
    async () => {
      const cutoff = Date.now() - CLIP_PERIOD_MS[period];
      const rows: ClipRow[] = [];
      let truncated = false;
      let tracked = false;
      for (let page = 0; page < plan.maxPages; page++) {
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
        if (videos.length > 0) tracked = true;
        // 予約中のプレミア公開・配信中・削除済みは再生できる切り抜きではない
        rows.push(
          ...videos.filter((v) => v.status !== "upcoming" && v.status !== "live" && v.status !== "missing").map(toRow),
        );
        const oldest = videos.at(-1);
        const oldestAt = Date.parse(oldest?.available_at ?? oldest?.published_at ?? "");
        if (videos.length < PAGE_SIZE || Number.isNaN(oldestAt) || oldestAt < cutoff) break;
        if (page === plan.maxPages - 1) truncated = true;
      }

      const inPeriod = rows.filter((r) => Date.parse(r.publishedAt) >= cutoff);
      if (!youtubeEnabled() || inPeriod.length === 0) {
        return { rows: inPeriod, truncated, tracked, viewsComplete: true };
      }
      // 再生数は取り直すたびではなく、この結果をキャッシュする間は使い回す（動画ごとにも6時間キャッシュ）
      const views = await videoViewCounts(inPeriod.map((r) => r.source.slice(3)));
      return {
        rows: inPeriod.map((r) => ({ ...r, viewCount: views.get(r.source.slice(3)) })),
        truncated,
        tracked,
        viewsComplete: inPeriod.every((r) => views.has(r.source.slice(3)) || peek(`yt:views:${r.source.slice(3)}`) === null),
      };
    },
  );
  // キャッシュ後に別のリクエストで取れた再生数があれば補う（API は呼ばない）
  return {
    rows: result.rows.map((r) =>
      r.viewCount !== undefined ? r : { ...r, viewCount: peek<number | null>(`yt:views:${r.source.slice(3)}`) ?? undefined },
    ),
    truncated: result.truncated,
    tracked: result.tracked,
  };
}
