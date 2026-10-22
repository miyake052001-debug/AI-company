import "server-only";
import { CLIP_PERIOD_MS, type ChannelError, type ClipPeriod, type ClipRow, type Stream } from "@/lib/types";
import { cached, chunk, errorMessage, hasFreshFailure, mapLimit, peek, put, takeBudget } from "./cache";

/*
 * Twitch Helix API（アプリアクセストークン = client credentials）
 *   - 配信中: GET /streams?user_login=...（100件まで1リクエスト）
 *   - 予定:   GET /schedule?broadcaster_id=...（配信者ごと、30分キャッシュ）
 *   - クリップ: GET /clips?broadcaster_id=...（期間内の再生数順）
 */

const HELIX = "https://api.twitch.tv/helix";
const SCHEDULE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
/** 1リクエストで新しく取りに行く予定の数。残りは次回以降のポーリングで埋まる（レート制限対策） */
const SCHEDULE_FETCHES_PER_REQUEST = 25;
/**
 * 予定の取得は全体でも1分あたりこの回数まで。Twitch のアプリ枠は1分800ポイントなので、
 * 配信中チェック（/users・/streams）の分を必ず残す。
 */
const SCHEDULE_FETCHES_PER_MINUTE = 200;

export function twitchEnabled(): boolean {
  return !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

const g = globalThis as typeof globalThis & {
  __oshiTwitchToken?: { token: string; expires: number };
  __oshiTwitchBackoffUntil?: number;
};

async function appToken(force = false): Promise<string> {
  const current = g.__oshiTwitchToken;
  if (!force && current && current.expires > Date.now() + 60_000) return current.token;
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    cache: "no-store",
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID ?? "",
      client_secret: process.env.TWITCH_CLIENT_SECRET ?? "",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Twitch token: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  g.__oshiTwitchToken = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

class HelixError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function helix<T>(path: string, params: [string, string][], retry = true): Promise<T> {
  // レート制限に当たったら、リセットまで全リクエストを止める
  const backoff = g.__oshiTwitchBackoffUntil ?? 0;
  if (backoff > Date.now()) throw new HelixError("Twitch API のレート制限中です。しばらくしてから再試行します", 429);

  const url = new URL(`${HELIX}/${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "Client-Id": process.env.TWITCH_CLIENT_ID ?? "",
      Authorization: `Bearer ${await appToken()}`,
    },
  });
  if (res.status === 401 && retry) {
    await appToken(true);
    return helix<T>(path, params, false);
  }
  if (res.status === 429) {
    const reset = Number(res.headers.get("Ratelimit-Reset"));
    g.__oshiTwitchBackoffUntil = reset > 0 ? reset * 1000 : Date.now() + 60_000;
  }
  if (!res.ok) {
    let reason = res.statusText;
    try {
      reason = ((await res.json()) as { message?: string }).message ?? reason;
    } catch {}
    throw new HelixError(`Twitch API ${path}: ${res.status} ${reason}`, res.status);
  }
  return (await res.json()) as T;
}

export interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
  avatarUrl?: string;
}

/** ログイン名 → ユーザー情報（1日キャッシュ。存在しないログインは null） */
export async function twitchUsers(logins: string[]): Promise<Map<string, TwitchUser>> {
  const out = new Map<string, TwitchUser>();
  const missing: string[] = [];
  for (const login of new Set(logins)) {
    const hit = peek<TwitchUser | null>(`tw:user:${login}`);
    if (hit === undefined) missing.push(login);
    else if (hit) out.set(login, hit);
  }
  for (const batch of chunk(missing, 100)) {
    const data = await helix<{
      data: { id: string; login: string; display_name: string; profile_image_url?: string }[];
    }>(
      "users",
      batch.map((l) => ["login", l]),
    );
    const found = new Set<string>();
    for (const u of data.data) {
      const user: TwitchUser = {
        id: u.id,
        login: u.login,
        displayName: u.display_name,
        avatarUrl: u.profile_image_url,
      };
      found.add(u.login);
      out.set(u.login, user);
      put(`tw:user:${u.login}`, user, 24 * 60 * 60_000);
    }
    for (const l of batch) if (!found.has(l)) put(`tw:user:${l}`, null, 60 * 60_000);
  }
  return out;
}

interface HelixStream {
  user_login: string;
  user_name: string;
  title: string;
  viewer_count: number;
  started_at: string;
  thumbnail_url: string;
  game_name?: string;
}

function liveToStream(s: HelixStream, avatarUrl: string | undefined): Stream {
  const login = s.user_login.toLowerCase();
  // サムネイルは数分ごとに更新されるので、キャッシュ避けのクエリを付ける
  const bust = Math.floor(Date.now() / 300_000);
  return {
    id: `tw:${login}:live`,
    source: `tw:${login}`,
    platform: "twitch",
    status: "live",
    title: s.title,
    channelId: login,
    channelName: s.user_name,
    avatarUrl,
    thumbnailUrl: `${s.thumbnail_url.replace("{width}", "640").replace("{height}", "360")}?t=${bust}`,
    url: `https://www.twitch.tv/${login}`,
    viewers: s.viewer_count,
    startAt: s.started_at,
    category: s.game_name || undefined,
  };
}

/** 配信中ストリーム（ログインごとに60秒キャッシュ） */
async function liveStreams(logins: string[]): Promise<Map<string, HelixStream>> {
  const out = new Map<string, HelixStream>();
  const missing: string[] = [];
  for (const login of logins) {
    const hit = peek<HelixStream | null>(`tw:live:${login}`);
    if (hit === undefined) missing.push(login);
    else if (hit) out.set(login, hit);
  }
  for (const batch of chunk(missing, 100)) {
    const data = await helix<{ data: HelixStream[] }>("streams", [
      ...batch.map((l): [string, string] => ["user_login", l]),
      ["first", "100"],
    ]);
    const found = new Set<string>();
    for (const s of data.data) {
      const login = s.user_login.toLowerCase();
      found.add(login);
      out.set(login, s);
      put(`tw:live:${login}`, s, 60_000);
    }
    for (const l of batch) if (!found.has(l)) put(`tw:live:${l}`, null, 60_000);
  }
  return out;
}

interface ScheduleSegment {
  id: string;
  start_time: string;
  end_time?: string | null;
  title: string;
  canceled_until?: string | null;
  category?: { name: string } | null;
}

interface Schedule {
  segments: ScheduleSegment[];
  vacation: { start_time: string; end_time: string } | null;
}

async function schedule(user: TwitchUser): Promise<Schedule> {
  const errorTtl = (e: unknown) =>
    // レート制限中のエラーは制限が解けるまでだけ覚える（5分も予定が消えないように）
    e instanceof HelixError && e.status === 429
      ? Math.max(5_000, (g.__oshiTwitchBackoffUntil ?? 0) - Date.now() + 5_000)
      : 5 * 60_000;
  return cached<Schedule>(`tw:schedule:${user.id}`, { ttl: 30 * 60_000, errorTtl, staleOnError: true }, async () => {
    try {
      const data = await helix<{ data: { segments: ScheduleSegment[] | null; vacation: Schedule["vacation"] } }>(
        "schedule",
        [
          ["broadcaster_id", user.id],
          ["first", "10"],
        ],
      );
      return { segments: data.data.segments ?? [], vacation: data.data.vacation ?? null };
    } catch (e) {
      // スケジュール未設定の配信者は 404 が返る
      if (e instanceof HelixError && e.status === 404) return { segments: [], vacation: null };
      throw e;
    }
  });
}

/** 次の予定枠（キャンセル済み・休止期間中の枠は除く） */
export function nextSegment(s: Schedule, now: number): ScheduleSegment | undefined {
  const vacationStart = s.vacation ? Date.parse(s.vacation.start_time) : NaN;
  const vacationEnd = s.vacation ? Date.parse(s.vacation.end_time) : NaN;
  return s.segments.find((seg) => {
    const t = Date.parse(seg.start_time);
    if (seg.canceled_until || !(t > now - 30 * 60_000 && t < now + SCHEDULE_AHEAD_MS)) return false;
    return !(t >= vacationStart && t < vacationEnd);
  });
}

export async function getTwitchStreams(logins: string[]): Promise<{ streams: Stream[]; errors: ChannelError[] }> {
  const errors: ChannelError[] = [];
  const users = await twitchUsers(logins);
  for (const login of logins) {
    if (!users.has(login)) errors.push({ channel: `tw:${login}`, message: "Twitch にこのユーザーが見つかりません" });
  }

  const live = await liveStreams(logins);
  const streams: Stream[] = [];
  for (const [login, s] of live) streams.push(liveToStream(s, users.get(login)?.avatarUrl));

  // 予定はキャッシュ済みのもの（失敗を覚えているものを含む）は全部使い、
  // 未取得のものは1リクエストあたり・1分あたりの上限まで取りに行く
  let budget = SCHEDULE_FETCHES_PER_REQUEST;
  const targets = [...users.values()].filter((u) => {
    if (live.has(u.login)) return false; // 配信中なら次回予定は出さない
    const key = `tw:schedule:${u.id}`;
    if (peek(key) !== undefined || hasFreshFailure(key)) return true;
    if (budget <= 0 || !takeBudget("tw:schedule-fetch", SCHEDULE_FETCHES_PER_MINUTE, 60_000)) return false;
    budget--;
    return true;
  });

  const now = Date.now();
  await mapLimit(targets, 6, async (user) => {
    try {
      const upcoming = nextSegment(await schedule(user), now);
      if (!upcoming) return;
      streams.push({
        id: `tw:${user.login}:sched:${upcoming.id}`,
        source: `tw:${user.login}`,
        platform: "twitch",
        status: "upcoming",
        title: upcoming.title || "（タイトル未設定）",
        channelId: user.login,
        channelName: user.displayName,
        avatarUrl: user.avatarUrl,
        url: `https://www.twitch.tv/${user.login}/schedule`,
        startAt: upcoming.start_time,
        category: upcoming.category?.name,
      });
    } catch (e) {
      errors.push({ channel: `tw:${user.login}`, message: errorMessage(e) });
    }
  });

  return { streams, errors };
}

/** 期間内のクリップ（再生数順・30分キャッシュ） */
export async function getTwitchClips(twitchLogin: string, period: ClipPeriod): Promise<ClipRow[]> {
  return cached<ClipRow[]>(
    `tw:clips:${twitchLogin}:${period}`,
    { ttl: 30 * 60_000, errorTtl: 5 * 60_000, staleOnError: true },
    async () => {
      const user = (await twitchUsers([twitchLogin])).get(twitchLogin);
      if (!user) return [];
      const data = await helix<{
        data: {
          id: string;
          url: string;
          title: string;
          view_count: number;
          created_at: string;
          thumbnail_url: string;
          duration: number;
          creator_name: string;
        }[];
      }>("clips", [
        ["broadcaster_id", user.id],
        ["started_at", new Date(Date.now() - CLIP_PERIOD_MS[period]).toISOString()],
        ["ended_at", new Date().toISOString()],
        ["first", "30"],
      ]);
      return data.data.map(
        (c): ClipRow => ({
          id: `twc:${c.id}`,
          source: `twc:${c.id}`,
          platform: "twitch",
          title: c.title,
          url: c.url,
          thumbnailUrl: c.thumbnail_url,
          channelName: `${c.creator_name} さんのクリップ`,
          publishedAt: c.created_at,
          viewCount: c.view_count,
          durationSec: c.duration,
          via: "twitch",
        }),
      );
    },
  );
}

export async function resolveTwitchUser(login: string): Promise<TwitchUser | null> {
  if (!twitchEnabled()) return null;
  return (await twitchUsers([login])).get(login) ?? null;
}
