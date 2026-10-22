export type Platform = "youtube" | "twitch";
export type StreamStatus = "live" | "upcoming" | "ended";

/** フォロー中のVTuber（YouTube / Twitch のどちらか、または両方を持つ） */
export interface Talent {
  id: string;
  name: string;
  group?: string;
  youtubeChannelId?: string;
  twitchLogin?: string;
  avatarUrl?: string;
  favorite?: boolean;
}

export interface Stream {
  /** リスト表示用のユニークID */
  id: string;
  /** マルチビューで再生するときのソースキー（"yt:VIDEO_ID" / "tw:login" など） */
  source: string;
  platform: Platform;
  status: StreamStatus;
  title: string;
  /** YouTube のチャンネルID、または Twitch のログイン名（小文字） */
  channelId: string;
  channelName: string;
  avatarUrl?: string;
  thumbnailUrl?: string;
  url: string;
  viewers?: number;
  /** 配信中/終了: 実際の開始時刻、予定: 予定時刻 */
  startAt?: string;
  endAt?: string;
  category?: string;
  demo?: boolean;
}

export interface Clip {
  id: string;
  source: string;
  platform: Platform;
  title: string;
  url: string;
  thumbnailUrl?: string;
  /** 切り抜きチャンネル名 / クリップ作成者 */
  channelName: string;
  talentId: string;
  publishedAt: string;
  viewCount?: number;
  durationSec?: number;
  via: "holodex" | "youtube-search" | "twitch" | "demo";
  demo?: boolean;
}

/** プロバイダから取った切り抜き（どのタレントのものかはルート側で付ける。キャッシュを共有するため） */
export type ClipRow = Omit<Clip, "talentId">;

export interface ProviderStatus {
  youtube: boolean;
  twitch: boolean;
  holodex: boolean;
}

export interface ChannelError {
  /** "yt:UCxxxx" / "tw:login" */
  channel: string;
  message: string;
}

export interface StreamsResponse {
  streams: Stream[];
  errors: ChannelError[];
  providers: ProviderStatus;
  fetchedAt: string;
}

export interface ClipsResponse {
  clips: Clip[];
  errors: ChannelError[];
  providers: ProviderStatus;
  /** 件数が多く、期間の途中までしか取得できなかった */
  truncated?: boolean;
}

export interface ResolveResponse {
  platform: "youtube" | "twitch";
  /** YouTube のチャンネルID / Twitch のログイン名 */
  id: string;
  name?: string;
  avatarUrl?: string;
  /** API で存在を確認できたか（Twitch のキー未設定時は false） */
  verified: boolean;
}

export type ClipPeriod = "24h" | "7d" | "30d";

export const CLIP_PERIOD_MS: Record<ClipPeriod, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function isClipPeriod(v: unknown): v is ClipPeriod {
  return v === "24h" || v === "7d" || v === "30d";
}

export const YOUTUBE_CHANNEL_ID_RE = /^UC[\w-]{22}$/;
export const TWITCH_LOGIN_RE = /^[a-z0-9_]{1,25}$/;
