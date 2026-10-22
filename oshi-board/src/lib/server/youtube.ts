import "server-only";
import { parseIsoDuration } from "@/lib/format";
import { CLIP_PERIOD_MS, YOUTUBE_CHANNEL_ID_RE, type ChannelError, type Clip, type ClipPeriod, type Stream } from "@/lib/types";
import { cached, chunk, errorMessage, mapLimit, peek, put } from "./cache";

/*
 * YouTube の配信状況の取り方（クォータ節約版）
 *   1. チャンネルの RSS（無料・キー不要）で最新動画IDを取る
 *   2. videos.list（50件で1ユニット）でライブ/予定/終了を判定する
 * search.list（1回100ユニット）を使わないので、数十チャンネルを数分おきに更新しても1日の無料枠に収まる。
 */

const API = "https://www.googleapis.com/youtube/v3";
const RECENT_PER_CHANNEL = 10;
const UPCOMING_MAX_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
const UPCOMING_STALE_MS = 6 * 60 * 60 * 1000;
const ENDED_WINDOW_MS = 48 * 60 * 60 * 1000;
const FREE_CHAT_RE = /フリー\s*チャット|free\s*chat|freechat|フリチャ/i;

export function youtubeEnabled(): boolean {
  return !!process.env.YOUTUBE_API_KEY;
}

async function ytApi<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY ?? "");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let reason = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      reason = body.error?.message ?? reason;
    } catch {}
    throw new Error(`YouTube API ${path}: ${res.status} ${reason}`);
  }
  return (await res.json()) as T;
}

interface YtThumbs {
  default?: { url: string };
  medium?: { url: string };
  high?: { url: string };
}

interface YtVideoItem {
  id: string;
  snippet?: {
    channelId: string;
    channelTitle: string;
    title: string;
    publishedAt: string;
    liveBroadcastContent?: "live" | "upcoming" | "none";
    thumbnails?: YtThumbs;
  };
  liveStreamingDetails?: {
    actualStartTime?: string;
    actualEndTime?: string;
    scheduledStartTime?: string;
    concurrentViewers?: string;
  };
  statistics?: { viewCount?: string };
  contentDetails?: { duration?: string };
}

export interface VideoInfo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnailUrl?: string;
  kind: "live" | "upcoming" | "ended" | "video";
  startAt?: string;
  endAt?: string;
  viewers?: number;
}

export function toVideoInfo(item: YtVideoItem): VideoInfo | null {
  const sn = item.snippet;
  if (!sn) return null;
  const live = item.liveStreamingDetails;
  let kind: VideoInfo["kind"] = "video";
  if (sn.liveBroadcastContent === "live" || (live?.actualStartTime && !live.actualEndTime)) kind = "live";
  else if (sn.liveBroadcastContent === "upcoming") kind = "upcoming";
  else if (live?.actualEndTime) kind = "ended";

  return {
    id: item.id,
    channelId: sn.channelId,
    channelTitle: sn.channelTitle,
    title: sn.title,
    thumbnailUrl: sn.thumbnails?.medium?.url ?? sn.thumbnails?.high?.url,
    kind,
    startAt: kind === "upcoming" ? live?.scheduledStartTime : (live?.actualStartTime ?? live?.scheduledStartTime),
    endAt: live?.actualEndTime,
    viewers: live?.concurrentViewers ? Number(live.concurrentViewers) : undefined,
  };
}

/** 一覧に出すべき配信かを判定して Stream に変換する */
export function toStream(v: VideoInfo, now: number, avatarUrl?: string): Stream | null {
  if (v.kind === "video") return null;
  if (v.kind === "upcoming") {
    if (FREE_CHAT_RE.test(v.title)) return null;
    const t = v.startAt ? Date.parse(v.startAt) : NaN;
    if (Number.isNaN(t) || t > now + UPCOMING_MAX_AHEAD_MS || t < now - UPCOMING_STALE_MS) return null;
  }
  if (v.kind === "ended") {
    if (!v.endAt || Date.parse(v.endAt) < now - ENDED_WINDOW_MS) return null;
  }
  return {
    id: `yt:${v.id}`,
    source: `yt:${v.id}`,
    platform: "youtube",
    status: v.kind,
    title: v.title,
    channelId: v.channelId,
    channelName: v.channelTitle,
    avatarUrl,
    thumbnailUrl: v.thumbnailUrl ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    viewers: v.viewers,
    startAt: v.startAt,
    endAt: v.endAt,
  };
}

/** RSS から最近の動画IDを取得。RSS が落ちているときは uploads プレイリスト（1ユニット）にフォールバック */
async function recentVideoIds(channelId: string): Promise<string[]> {
  return cached<{ ids: string[]; via: "rss" | "api" }>(
    `yt:recent:${channelId}`,
    (r) => (r.via === "rss" ? 3 * 60_000 : 10 * 60_000),
    async () => {
      try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const xml = await res.text();
          const ids = [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((m) => m[1]);
          return { ids: ids.slice(0, RECENT_PER_CHANNEL), via: "rss" };
        }
      } catch {}
      const data = await ytApi<{ items?: { contentDetails: { videoId: string } }[] }>("playlistItems", {
        part: "contentDetails",
        playlistId: `UU${channelId.slice(2)}`,
        maxResults: String(RECENT_PER_CHANNEL),
      });
      return { ids: (data.items ?? []).map((i) => i.contentDetails.videoId), via: "api" };
    },
  ).then((r) => r.ids);
}

/** 動画詳細をまとめて取得。ライブ/予定以外は状態が変わらないので長めにキャッシュする */
async function videoDetails(ids: string[]): Promise<Map<string, VideoInfo>> {
  const out = new Map<string, VideoInfo>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = peek<VideoInfo | null>(`yt:video:${id}`);
    if (hit === undefined) missing.push(id);
    else if (hit) out.set(id, hit);
  }
  for (const batch of chunk(missing, 50)) {
    const data = await ytApi<{ items?: YtVideoItem[] }>("videos", {
      part: "snippet,liveStreamingDetails",
      id: batch.join(","),
      maxResults: "50",
    });
    const found = new Set<string>();
    for (const item of data.items ?? []) {
      const info = toVideoInfo(item);
      if (!info) continue;
      found.add(info.id);
      out.set(info.id, info);
      const active = info.kind === "live" || info.kind === "upcoming";
      put(`yt:video:${info.id}`, info, active ? 90_000 : 6 * 60 * 60_000);
    }
    // 非公開・削除済みは null をキャッシュして毎回問い合わせない
    for (const id of batch) if (!found.has(id)) put(`yt:video:${id}`, null, 6 * 60 * 60_000);
  }
  return out;
}

/** チャンネルアイコン（1日キャッシュ） */
export async function channelAvatars(channelIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const id of new Set(channelIds)) {
    const hit = peek<string | null>(`yt:avatar:${id}`);
    if (hit === undefined) missing.push(id);
    else if (hit) out.set(id, hit);
  }
  for (const batch of chunk(missing, 50)) {
    const data = await ytApi<{ items?: { id: string; snippet: { thumbnails?: YtThumbs } }[] }>("channels", {
      part: "snippet",
      id: batch.join(","),
      maxResults: "50",
    });
    const found = new Set<string>();
    for (const item of data.items ?? []) {
      const url = item.snippet.thumbnails?.default?.url ?? item.snippet.thumbnails?.medium?.url;
      found.add(item.id);
      put(`yt:avatar:${item.id}`, url ?? null, 24 * 60 * 60_000);
      if (url) out.set(item.id, url);
    }
    for (const id of batch) if (!found.has(id)) put(`yt:avatar:${id}`, null, 60 * 60_000);
  }
  return out;
}

export async function getYouTubeStreams(channelIds: string[]): Promise<{ streams: Stream[]; errors: ChannelError[] }> {
  const errors: ChannelError[] = [];
  const recent = await mapLimit(channelIds, 8, async (id) => {
    try {
      return await recentVideoIds(id);
    } catch (e) {
      errors.push({ channel: `yt:${id}`, message: errorMessage(e) });
      return [];
    }
  });

  const details = await videoDetails(recent.flat());
  let avatars = new Map<string, string>();
  try {
    avatars = await channelAvatars(channelIds);
  } catch {}

  const now = Date.now();
  const wanted = new Set(channelIds);
  const streams: Stream[] = [];
  for (const info of details.values()) {
    if (!wanted.has(info.channelId)) continue;
    const s = toStream(info, now, avatars.get(info.channelId));
    if (s) streams.push(s);
  }
  return { streams, errors };
}

/* ---------- 切り抜き（search.list フォールバック） ---------- */

/**
 * 「<名前> 切り抜き」で YouTube 検索する。search.list は100ユニットと高いので6時間キャッシュ。
 * Holodex の API キーがある場合はそちらを優先する（clips.ts 参照）。
 */
export async function searchYouTubeClips(
  talent: { id: string; name: string; youtubeChannelId?: string },
  period: ClipPeriod,
): Promise<Clip[]> {
  return cached(`yt:clips:${talent.name}:${period}`, 6 * 60 * 60_000, async () => {
    const publishedAfter = new Date(Date.now() - CLIP_PERIOD_MS[period]).toISOString();
    const search = await ytApi<{ items?: { id: { videoId?: string }; snippet: { channelId: string } }[] }>("search", {
      part: "snippet",
      type: "video",
      q: `${talent.name} 切り抜き`,
      order: "relevance",
      maxResults: "30",
      regionCode: "JP",
      relevanceLanguage: "ja",
      publishedAfter,
    });
    const ids = (search.items ?? [])
      .filter((i) => i.id.videoId && i.snippet.channelId !== talent.youtubeChannelId)
      .map((i) => i.id.videoId as string);
    if (ids.length === 0) return [];

    const data = await ytApi<{ items?: YtVideoItem[] }>("videos", {
      part: "snippet,statistics,contentDetails",
      id: ids.join(","),
      maxResults: "50",
    });
    return (data.items ?? [])
      .filter((v) => v.snippet && v.snippet.liveBroadcastContent === "none")
      .map(
        (v): Clip => ({
          id: `yt:${v.id}`,
          source: `yt:${v.id}`,
          platform: "youtube",
          title: v.snippet!.title,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnailUrl: v.snippet!.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
          channelName: v.snippet!.channelTitle,
          talentId: talent.id,
          publishedAt: v.snippet!.publishedAt,
          viewCount: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
          durationSec: parseIsoDuration(v.contentDetails?.duration),
          via: "youtube-search",
        }),
      );
  });
}

/* ---------- チャンネルURL / @ハンドルの解決 ---------- */

export interface ResolvedYouTubeChannel {
  channelId: string;
  name?: string;
  avatarUrl?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** チャンネルページの HTML から ID を拾う（APIキーなしでも使える） */
async function scrapeChannelPage(url: string): Promise<ResolvedYouTubeChannel | null> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Accept-Language": "ja,en;q=0.8", "User-Agent": "Mozilla/5.0 (compatible; OshiBoard/1.0)" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const id =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1];
  if (!id) return null;
  const name = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const avatar = /<meta property="og:image" content="([^"]*)"/.exec(html)?.[1];
  return { channelId: id, name: name ? decodeEntities(name) : undefined, avatarUrl: avatar };
}

export async function resolveYouTubeChannel(input: string): Promise<ResolvedYouTubeChannel | null> {
  const raw = input.trim();
  const idMatch = /(UC[\w-]{22})/.exec(raw);
  const handle = /(?:^|\/)@([^/?#\s]+)/.exec(raw)?.[1] ?? (/^[\w.-]{3,30}$/.test(raw) ? raw : undefined);
  const legacy = /youtube\.com\/(?:c|user)\/([^/?#\s]+)/.exec(raw)?.[1];

  if (youtubeEnabled() && (idMatch || handle)) {
    const params: Record<string, string> = idMatch
      ? { part: "snippet", id: idMatch[1] }
      : { part: "snippet", forHandle: `@${decodeURIComponent(handle!)}` };
    const data = await ytApi<{ items?: { id: string; snippet: { title: string; thumbnails?: YtThumbs } }[] }>(
      "channels",
      params,
    );
    const item = data.items?.[0];
    if (item) {
      return {
        channelId: item.id,
        name: item.snippet.title,
        avatarUrl: item.snippet.thumbnails?.default?.url,
      };
    }
    if (idMatch) return null;
  }

  if (idMatch && YOUTUBE_CHANNEL_ID_RE.test(idMatch[1])) {
    return (await scrapeChannelPage(`https://www.youtube.com/channel/${idMatch[1]}`)) ?? { channelId: idMatch[1] };
  }
  if (handle) return scrapeChannelPage(`https://www.youtube.com/@${handle}`);
  if (legacy) return scrapeChannelPage(`https://www.youtube.com/c/${legacy}`);
  return null;
}

/** 貼り付けた動画URLのタイトル取得（oEmbed・キー不要） */
export async function videoMeta(videoId: string): Promise<{ title: string; author: string } | null> {
  return cached(`yt:oembed:${videoId}`, 60 * 60_000, async () => {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string; author_name?: string };
    return { title: json.title ?? "", author: json.author_name ?? "" };
  });
}
