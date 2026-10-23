import "server-only";
import { PRESET_GROUPS } from "@/data/presets";
import { parseIsoDuration } from "@/lib/format";
import {
  CLIP_PERIOD_MS,
  YOUTUBE_CHANNEL_ID_RE,
  type ChannelError,
  type ClipPeriod,
  type ClipRow,
  type Stream,
} from "@/lib/types";
import {
  cached,
  chunk,
  errorMessage,
  exhaustBudget,
  LimitError,
  mapLimit,
  peek,
  peekStale,
  put,
  takeBudget,
} from "./cache";

/*
 * YouTube の配信状況の取り方（クォータ節約版）
 *   1. チャンネルの RSS（無料・キー不要）で最新動画IDを取る
 *   2. videos.list（50件で1ユニット）でライブ/予定/終了を判定する
 * search.list（1回100ユニット・1日100回程度が上限）を使わないので、数十チャンネルを数分おきに更新しても無料枠に収まる。
 */

const API = "https://www.googleapis.com/youtube/v3";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** YouTube API のクォータは太平洋時間の0時にリセットされる（夏時間は無視した近似） */
const QUOTA_DAY_OFFSET = -8 * HOUR;
const RECENT_PER_CHANNEL = 10;
const UPCOMING_MAX_AHEAD_MS = 14 * DAY;
const UPCOMING_STALE_MS = 6 * HOUR;
const ENDED_WINDOW_MS = 48 * HOUR;
const FREE_CHAT_RE = /フリー\s*チャット|free\s*chat|freechat|フリチャ/i;
/** RSS が使えないときの uploads プレイリスト取得（1ユニット）の上限。存在しないIDを大量に送られても枯渇しないように */
const PLAYLIST_FALLBACK_PER_HOUR = 300;
const SEARCH_BUDGET = "yt:search";
const RESOLVE_PER_HOUR = 200;
const CHANNEL_LOOKUPS_PER_HOUR = 120;
/** RSS で存在を確認できなかったチャンネルの問い合わせ上限（別枠。ランダムなIDで通常枠を使い切らせない） */
const UNVERIFIED_LOOKUPS_PER_HOUR = 30;

export function youtubeEnabled(): boolean {
  return !!process.env.YOUTUBE_API_KEY;
}

function searchDailyLimit(): number {
  const n = Number(process.env.YOUTUBE_SEARCH_DAILY_LIMIT);
  return process.env.YOUTUBE_SEARCH_DAILY_LIMIT && Number.isFinite(n) && n >= 0 ? n : 80;
}

export class YouTubeApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

function isQuotaError(e: unknown): boolean {
  return e instanceof YouTubeApiError && e.status === 403 && /quota|rateLimit/i.test(e.reason);
}

const yg = globalThis as typeof globalThis & { __oshiYtQuotaUntil?: number };

/** 通常枠（search 以外）のクォータを使い切っているか（太平洋時間の0時まで） */
export function youtubeQuotaExhausted(): boolean {
  return (yg.__oshiYtQuotaUntil ?? 0) > Date.now();
}

function markQuotaExhausted(): void {
  const day = Math.floor((Date.now() + QUOTA_DAY_OFFSET) / DAY);
  yg.__oshiYtQuotaUntil = (day + 1) * DAY - QUOTA_DAY_OFFSET;
}

async function ytApi<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", process.env.YOUTUBE_API_KEY ?? "");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let reason = "";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
      reason = body.error?.errors?.[0]?.reason ?? "";
      message = body.error?.message ?? message;
    } catch {}
    const error = new YouTubeApiError(res.status, reason, `YouTube API ${path}: ${res.status} ${message}`);
    // search.list は別枠なので、それ以外のクォータ切れだけ覚えておく
    if (path !== "search" && isQuotaError(error)) markQuotaExhausted();
    throw error;
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
  /** キャッシュに入れた時刻（取得失敗時に古い値を使ってよいかの判断用） */
  fetchedAt?: number;
}

/** 取得に失敗したとき、ライブ/予定の古い値を使ってよい時間（それ以上古いと終了済みを LIVE と出してしまう） */
const STALE_ACTIVE_MS = 15 * 60_000;

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

/**
 * RSS から最近の動画IDを取得。RSS が落ちているときは uploads プレイリスト（1ユニット）にフォールバック。
 * 存在しないチャンネルは失敗をキャッシュして、ポーリングのたびにクォータを使わないようにする。
 */
async function recentVideoIds(channelId: string): Promise<string[]> {
  const result = await cached<{ ids: string[]; via: "rss" | "api" }>(
    `yt:recent:${channelId}`,
    {
      ttl: (r) => (r.via === "rss" ? 3 * 60_000 : 10 * 60_000),
      // 存在しないチャンネルは長く覚える。一時的な失敗はすぐ再試行し、その間は前回の結果を使う
      errorTtl: (e) =>
        e instanceof YouTubeApiError && e.status === 404 ? 6 * HOUR : e instanceof LimitError ? 5 * 60_000 : 2 * 60_000,
      staleOnError: true,
    },
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
      if (!takeBudget("yt:playlist-fallback", PLAYLIST_FALLBACK_PER_HOUR, HOUR)) {
        throw new LimitError("YouTube の取得が混み合っています。しばらくしてから再試行します");
      }
      try {
        const data = await ytApi<{ items?: { contentDetails: { videoId: string } }[] }>("playlistItems", {
          part: "contentDetails",
          playlistId: `UU${channelId.slice(2)}`,
          maxResults: String(RECENT_PER_CHANNEL),
        });
        return { ids: (data.items ?? []).map((i) => i.contentDetails.videoId), via: "api" };
      } catch (e) {
        if (e instanceof YouTubeApiError && e.status === 404) {
          throw new YouTubeApiError(404, e.reason, "チャンネルが見つかりません（チャンネルIDを確認してください）");
        }
        throw e;
      }
    },
  );
  return result.ids;
}

/**
 * 動画詳細をまとめて取得。ライブ/予定以外は状態が変わらないので長めにキャッシュする。
 * 一部のバッチが失敗しても、残りと（期限切れでも）前回の値で返す。
 */
async function videoDetails(ids: string[]): Promise<{ videos: Map<string, VideoInfo>; errors: string[] }> {
  const videos = new Map<string, VideoInfo>();
  const errors: string[] = [];
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = peek<VideoInfo | null>(`yt:video:${id}`);
    if (hit === undefined) missing.push(id);
    else if (hit) videos.set(id, hit);
  }
  for (const batch of chunk(missing, 50)) {
    try {
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
        videos.set(info.id, info);
        const active = info.kind === "live" || info.kind === "upcoming";
        put(`yt:video:${info.id}`, { ...info, fetchedAt: Date.now() }, active ? 90_000 : 6 * HOUR);
      }
      // 非公開・削除済みは null をキャッシュして毎回問い合わせない
      for (const id of batch) if (!found.has(id)) put(`yt:video:${id}`, null, 6 * HOUR);
    } catch (e) {
      errors.push(errorMessage(e));
      for (const id of batch) {
        const stale = peekStale<VideoInfo | null>(`yt:video:${id}`);
        if (!stale) continue;
        // 終了済み・通常動画は状態が変わらないので使ってよい。ライブ/予定は最近の値だけ
        const settled = stale.kind === "ended" || stale.kind === "video";
        if (settled || Date.now() - (stale.fetchedAt ?? 0) < STALE_ACTIVE_MS) videos.set(id, stale);
      }
    }
  }
  return { videos, errors };
}

interface ChannelSnippet {
  title: string;
  avatarUrl?: string;
}

/**
 * チャンネル名とアイコン（1日キャッシュ）。
 * 未取得分の問い合わせが1時間の上限に達したら、それまでに取れた分だけ返す（limited: true）。
 */
async function channelSnippets(
  channelIds: string[],
  budget: { name: string; perHour: number } = { name: "yt:channels", perHour: CHANNEL_LOOKUPS_PER_HOUR },
): Promise<{ snippets: Map<string, ChannelSnippet>; limited: boolean }> {
  const out = new Map<string, ChannelSnippet>();
  const missing: string[] = [];
  for (const id of new Set(channelIds)) {
    const hit = peek<ChannelSnippet | null>(`yt:channel:${id}`);
    if (hit === undefined) missing.push(id);
    else if (hit) out.set(id, hit);
  }
  for (const batch of chunk(missing, 50)) {
    // 外部から任意のチャンネルIDを渡せるので、未取得分の問い合わせは1時間あたりの上限まで
    if (!takeBudget(budget.name, budget.perHour, HOUR)) return { snippets: out, limited: true };
    const data = await ytApi<{ items?: { id: string; snippet: { title: string; thumbnails?: YtThumbs } }[] }>(
      "channels",
      { part: "snippet", id: batch.join(","), maxResults: "50" },
    );
    const found = new Set<string>();
    for (const item of data.items ?? []) {
      const snippet: ChannelSnippet = {
        title: item.snippet.title,
        avatarUrl: item.snippet.thumbnails?.default?.url ?? item.snippet.thumbnails?.medium?.url,
      };
      found.add(item.id);
      out.set(item.id, snippet);
      put(`yt:channel:${item.id}`, snippet, DAY);
    }
    for (const id of batch) if (!found.has(id)) put(`yt:channel:${id}`, null, HOUR);
  }
  return { snippets: out, limited: false };
}

export async function getYouTubeStreams(channelIds: string[]): Promise<{ streams: Stream[]; errors: ChannelError[] }> {
  const errors: ChannelError[] = [];
  const found: string[] = [];
  const recent = await mapLimit(channelIds, 8, async (id) => {
    try {
      const ids = await recentVideoIds(id);
      found.push(id);
      return ids;
    } catch (e) {
      errors.push({ channel: `yt:${id}`, message: errorMessage(e) });
      return [];
    }
  });

  const details = await videoDetails(recent.flat());
  for (const message of new Set(details.errors)) errors.push({ channel: "youtube", message });

  // アイコンは存在が確認できたチャンネルだけ取る（存在しないIDで channels.list を使わせない）
  let snippets = new Map<string, ChannelSnippet>();
  try {
    snippets = (await channelSnippets(found)).snippets;
  } catch {}

  const now = Date.now();
  const wanted = new Set(channelIds);
  const streams: Stream[] = [];
  for (const info of details.videos.values()) {
    if (!wanted.has(info.channelId)) continue;
    const s = toStream(info, now, snippets.get(info.channelId)?.avatarUrl);
    if (s) streams.push(s);
  }
  return { streams, errors };
}

/* ---------- 切り抜き ---------- */

/**
 * チャンネルの RSS（無料）が取れるか。
 * RSS は実在するチャンネルでも一時的に 404 を返すことがあるので、404 でも「存在しない」とは決めつけない
 * （呼び出し側で別枠の channels.list に回す）。
 */
async function channelFeedStatus(channelId: string): Promise<"found" | "missing" | "unknown"> {
  return cached<"found" | "missing" | "unknown">(
    `yt:feed:${channelId}`,
    { ttl: (st) => (st === "found" ? 6 * HOUR : 2 * 60_000) },
    async () => {
      try {
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { cache: "no-store" });
        if (res.ok) return "found";
        return res.status === 404 ? "missing" : "unknown";
      } catch {
        return "unknown";
      }
    },
  );
}

/** 再生数（6時間キャッシュ）。Holodex の切り抜きに再生数を付けるために使う。失敗しても空で返す */
export async function videoViewCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = peek<number | null>(`yt:views:${id}`);
    if (hit === undefined) missing.push(id);
    else if (hit !== null) out.set(id, hit);
  }
  // クォータ切れの間は呼んでも失敗するだけなので呼ばない
  for (const batch of youtubeQuotaExhausted() ? [] : chunk(missing, 50)) {
    try {
      const data = await ytApi<{ items?: { id: string; statistics?: { viewCount?: string } }[] }>("videos", {
        part: "statistics",
        id: batch.join(","),
        maxResults: "50",
      });
      const found = new Set<string>();
      for (const item of data.items ?? []) {
        const views = item.statistics?.viewCount ? Number(item.statistics.viewCount) : null;
        found.add(item.id);
        put(`yt:views:${item.id}`, views, 6 * HOUR);
        if (views !== null) out.set(item.id, views);
      }
      for (const id of batch) if (!found.has(id)) put(`yt:views:${id}`, null, 6 * HOUR);
    } catch (e) {
      // クォータ切れなら残りも失敗するのでやめる。一時的な失敗なら次のバッチは続ける
      if (isQuotaError(e)) break;
    }
  }
  return out;
}

function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

const TITLE_STOPWORDS = new Set(["ch", "channel", "official", "公式", "チャンネル", "ちゃんねる"]);
const TITLE_SEPARATORS = /[\s/／|｜・【】[\]()（）.,、。!！?？]+/;

/** プリセットに登録されている名前（チャンネルID → 名前） */
const PRESET_NAMES = new Map(
  PRESET_GROUPS.flatMap((g) => g.talents)
    .filter((t) => t.youtubeChannelId)
    .map((t) => [t.youtubeChannelId as string, t.name]),
);

/**
 * 切り抜き検索のキーワード。検索結果は全員で共有するので、外から渡された文字列をそのまま使わない。
 *   1. プリセットのチャンネルならプリセットの名前
 *   2. ユーザーが付けた名前がチャンネル名の単語と完全に一致すればそれ
 *   3. それ以外はチャンネル名から「Ch.」などを除いたもの
 */
export function clipSearchTerm(name: string, channelTitle: string, presetName?: string): string {
  if (presetName) return presetName;
  const tokens = channelTitle
    .split(TITLE_SEPARATORS)
    .map((t) => t.trim().replace(/(?:ちゃんねる|チャンネル|channel|official|公式)$/i, ""))
    .filter((t) => t && !TITLE_STOPWORDS.has(normalize(t)));
  const n = normalize(name);
  if (n && tokens.some((t) => normalize(t) === n)) return name.trim();
  return tokens.join(" ") || channelTitle.trim();
}

/** 期間ごとの検索方法: 24時間は新着順、1週間・1ヶ月は再生数順（人気の切り抜きが埋もれないように） */
const SEARCH_PLAN: Record<ClipPeriod, { order: "date" | "viewCount"; ttl: number }> = {
  "24h": { order: "date", ttl: 3 * HOUR },
  "7d": { order: "viewCount", ttl: 12 * HOUR },
  "30d": { order: "viewCount", ttl: DAY },
};

/**
 * 「<名前> 切り抜き」で YouTube 検索する（Holodex が使えないときの代替）。
 * search.list は高いので、チャンネル×期間ごとに長めにキャッシュし、1日の検索回数にも上限を設ける。
 * 上限に達したら前回の結果（あれば）を返す。
 */
export async function searchYouTubeClips(
  talent: { name: string; youtubeChannelId: string },
  period: ClipPeriod,
): Promise<ClipRow[]> {
  const channelId = talent.youtubeChannelId;
  const plan = SEARCH_PLAN[period];
  return cached<ClipRow[]>(
    `yt:clips:${channelId}:${period}`,
    { ttl: plan.ttl, errorTtl: (e) => (isQuotaError(e) ? HOUR : 10 * 60_000), staleOnError: true },
    async () => {
      // 外部から任意のIDで呼べるので、存在が確認できていないIDは別枠（少なめ）の上限で channels.list を使う
      const known =
        !!peekStale<ChannelSnippet | null>(`yt:channel:${channelId}`) ||
        peekStale(`yt:recent:${channelId}`) !== undefined ||
        (await channelFeedStatus(channelId)) === "found";
      const { snippets, limited } = await channelSnippets(
        [channelId],
        known ? undefined : { name: "yt:channels-unverified", perHour: UNVERIFIED_LOOKUPS_PER_HOUR },
      );
      const channel = snippets.get(channelId);
      if (!channel) {
        throw limited
          ? new LimitError("YouTube のチャンネル情報の取得が混み合っています。しばらくしてから再試行します")
          : new Error("YouTube チャンネルが見つかりません");
      }
      if (!takeBudget(SEARCH_BUDGET, searchDailyLimit(), DAY, QUOTA_DAY_OFFSET)) {
        throw new LimitError(
          "今日の YouTube 切り抜き検索の上限に達しました（Holodex の API キーを設定すると上限なしで取得できます）",
        );
      }
      let search: { items?: { id: { videoId?: string }; snippet: { channelId: string } }[] };
      try {
        search = await ytApi("search", {
          part: "snippet",
          type: "video",
          q: `${clipSearchTerm(talent.name, channel.title, PRESET_NAMES.get(channelId))} 切り抜き`,
          order: plan.order,
          maxResults: "50",
          regionCode: "JP",
          relevanceLanguage: "ja",
          publishedAfter: new Date(Date.now() - CLIP_PERIOD_MS[period]).toISOString(),
        });
      } catch (e) {
        if (isQuotaError(e)) exhaustBudget(SEARCH_BUDGET, DAY, QUOTA_DAY_OFFSET);
        throw e;
      }
      const ids = (search.items ?? [])
        .filter((i) => i.id.videoId && i.snippet.channelId !== channelId)
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
          (v): ClipRow => ({
            id: `yt:${v.id}`,
            source: `yt:${v.id}`,
            platform: "youtube",
            title: v.snippet!.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            thumbnailUrl: v.snippet!.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
            channelName: v.snippet!.channelTitle,
            publishedAt: v.snippet!.publishedAt,
            viewCount: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
            durationSec: parseIsoDuration(v.contentDetails?.duration),
            via: "youtube-search",
          }),
        );
    },
  );
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

/**
 * チャンネルページの HTML から ID を拾う（APIキーなしでも使える）。
 * 404 はチャンネルなし（null）。それ以外の失敗（429・5xx・同意画面など）は一時的なものとして例外にする。
 */
async function scrapeChannelPage(url: string): Promise<ResolvedYouTubeChannel | null> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "Accept-Language": "ja,en;q=0.8", "User-Agent": "Mozilla/5.0 (compatible; OshiBoard/1.0)" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`YouTube のページを読み込めませんでした（${res.status}）。しばらくしてから再試行してください`);
  const html = await res.text();
  const id =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1] ??
    /"channelId":"(UC[\w-]{22})"/.exec(html)?.[1];
  if (!id) throw new Error("YouTube のページからチャンネルを読み取れませんでした。チャンネルURL（/channel/UC...）で試してください");
  const name = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1];
  const avatar = /<meta property="og:image" content="([^"]*)"/.exec(html)?.[1];
  return { channelId: id, name: name ? decodeEntities(name) : undefined, avatarUrl: avatar };
}

type ChannelInput = { kind: "id"; id: string } | { kind: "handle"; handle: string } | { kind: "c" | "user"; name: string };

function parseChannelInput(raw: string): ChannelInput | null {
  const id = /(UC[\w-]{22})/.exec(raw)?.[1];
  if (id && YOUTUBE_CHANNEL_ID_RE.test(id)) return { kind: "id", id };
  const legacy = /youtube\.com\/(c|user)\/([^/?#\s]+)/.exec(raw);
  if (legacy) {
    let name = legacy[2];
    try {
      name = decodeURIComponent(name);
    } catch {}
    return { kind: legacy[1] as "c" | "user", name };
  }
  const handle = /(?:^|\/)@([^/?#\s]+)/.exec(raw)?.[1] ?? (/^[\w.-]{3,30}$/.test(raw) ? raw : undefined);
  if (!handle) return null;
  try {
    return { kind: "handle", handle: decodeURIComponent(handle) };
  } catch {
    return null;
  }
}

interface ResolveResult {
  channel: ResolvedYouTubeChannel | null;
  /** API やページで確認できた結果か（false は ID をそのまま返しただけの推測） */
  confirmed: boolean;
}

/**
 * チャンネルURL / @ハンドル / ID をチャンネルIDにする。
 * 入力の種類ごとの正規形でキャッシュする（チャンネルIDは大文字小文字を区別、ハンドル等は区別しない）。
 */
export async function resolveYouTubeChannel(input: string): Promise<ResolvedYouTubeChannel | null> {
  const parsed = parseChannelInput(input.trim());
  if (!parsed) return null;
  const key =
    parsed.kind === "id"
      ? `id:${parsed.id}`
      : parsed.kind === "handle"
        ? `handle:${parsed.handle.toLowerCase()}`
        : `${parsed.kind}:${parsed.name.toLowerCase()}`;
  const result = await cached<ResolveResult>(
    `yt:resolve:${key}`,
    {
      ttl: (r) => (!r.confirmed ? 60_000 : r.channel ? HOUR : 5 * 60_000),
      errorTtl: 60_000,
    },
    () => resolveUncached(parsed),
  );
  return result.channel;
}

async function resolveUncached(input: ChannelInput): Promise<ResolveResult> {
  const params: Record<string, string> | null =
    input.kind === "id"
      ? { part: "snippet", id: input.id }
      : input.kind === "handle"
        ? { part: "snippet", forHandle: `@${input.handle}` }
        : input.kind === "user"
          ? { part: "snippet", forUsername: input.name }
          : null;

  // channels.list は1回1ユニット。外部から好きな入力で叩けるので1時間あたりの上限を設け、超えたらページ読み取りで代替
  if (params && youtubeEnabled() && takeBudget("yt:resolve", RESOLVE_PER_HOUR, HOUR)) {
    try {
      const data = await ytApi<{ items?: { id: string; snippet: { title: string; thumbnails?: YtThumbs } }[] }>(
        "channels",
        params,
      );
      const item = data.items?.[0];
      const channel = item
        ? { channelId: item.id, name: item.snippet.title, avatarUrl: item.snippet.thumbnails?.default?.url }
        : null;
      return { channel, confirmed: true };
    } catch {
      // API が使えないとき（クォータ切れなど）はページの読み取りにフォールバック
    }
  }

  const url =
    input.kind === "id"
      ? `https://www.youtube.com/channel/${input.id}`
      : input.kind === "handle"
        ? `https://www.youtube.com/@${encodeURIComponent(input.handle)}`
        : `https://www.youtube.com/${input.kind}/${encodeURIComponent(input.name)}`;
  try {
    return { channel: await scrapeChannelPage(url), confirmed: true };
  } catch (e) {
    // ID の形をしていれば、確認できなくてもそのまま使えるようにする（短時間だけキャッシュ）
    if (input.kind === "id") return { channel: { channelId: input.id }, confirmed: false };
    throw e;
  }
}

/** 貼り付けた動画URLのタイトル取得（oEmbed・キー不要） */
export async function videoMeta(videoId: string): Promise<{ title: string; author: string } | null> {
  return cached<{ title: string; author: string } | null>(`yt:oembed:${videoId}`, { ttl: HOUR }, async () => {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
      { cache: "no-store" },
    );
    // 存在しない・非公開・埋め込み不可のときだけ「なし」として覚える。一時的なエラーはキャッシュしない
    if ([400, 401, 403, 404].includes(res.status)) return null;
    if (!res.ok) throw new Error(`oEmbed: ${res.status}`);
    const json = (await res.json()) as { title?: string; author_name?: string };
    return { title: json.title ?? "", author: json.author_name ?? "" };
  });
}
