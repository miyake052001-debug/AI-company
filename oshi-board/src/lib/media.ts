import type { Platform } from "./types";

/**
 * マルチビューで再生できるソース。
 * 文字列キー（"yt:VIDEO_ID" など）にシリアライズして URL や localStorage に保存する。
 */
export type MediaSource =
  | { kind: "yt"; id: string } // YouTube 動画 / ライブ
  | { kind: "tw"; id: string } // Twitch チャンネル（ライブ）
  | { kind: "twv"; id: string } // Twitch アーカイブ（VOD）
  | { kind: "twc"; id: string } // Twitch クリップ
  | { kind: "demo"; id: string }; // APIキー未設定時のデモ用

const YT_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TW_LOGIN = /^[A-Za-z0-9_]{1,25}$/;
const TW_VOD_ID = /^\d{5,}$/;
const TW_CLIP_SLUG = /^[A-Za-z0-9_-]{3,100}$/;

// twitch.tv/<ここ> がチャンネル名ではないパス
const TWITCH_RESERVED = new Set([
  "directory",
  "downloads",
  "drops",
  "friends",
  "inventory",
  "jobs",
  "login",
  "messages",
  "moderator",
  "p",
  "payments",
  "popout",
  "prime",
  "search",
  "settings",
  "signup",
  "store",
  "subscriptions",
  "turbo",
  "videos",
  "wallet",
]);

function isValid(kind: MediaSource["kind"], id: string): boolean {
  switch (kind) {
    case "yt":
      return YT_VIDEO_ID.test(id);
    case "tw":
      return TW_LOGIN.test(id) && !TWITCH_RESERVED.has(id.toLowerCase());
    case "twv":
      return TW_VOD_ID.test(id);
    case "twc":
      return TW_CLIP_SLUG.test(id);
    case "demo":
      return /^[\w:-]{1,80}$/.test(id);
  }
}

export function makeSource(kind: MediaSource["kind"], id: string): MediaSource | null {
  const normalized = kind === "tw" ? id.toLowerCase() : id;
  return isValid(kind, normalized) ? { kind, id: normalized } : null;
}

export function sourceKey(s: MediaSource): string {
  return `${s.kind}:${s.id}`;
}

export function parseSourceKey(key: string): MediaSource | null {
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  if (kind !== "yt" && kind !== "tw" && kind !== "twv" && kind !== "twc" && kind !== "demo") {
    return null;
  }
  return makeSource(kind, id);
}

/** YouTube / Twitch の URL（またはソースキー）を解析する */
export function parseMediaInput(input: string): MediaSource | null {
  const raw = input.trim();
  if (!raw) return null;

  const fromKey = parseSourceKey(raw);
  if (fromKey) return fromKey;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    return parts[0] ? makeSource("yt", parts[0]) : null;
  }

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v) return makeSource("yt", v);
    if (parts.length >= 2 && ["live", "shorts", "embed", "v"].includes(parts[0])) {
      return makeSource("yt", parts[1]);
    }
    return null;
  }

  if (host === "clips.twitch.tv") {
    if (parts[0] === "embed") {
      const clip = url.searchParams.get("clip");
      return clip ? makeSource("twc", clip) : null;
    }
    return parts[0] ? makeSource("twc", parts[0]) : null;
  }

  if (host === "player.twitch.tv") {
    const channel = url.searchParams.get("channel");
    if (channel) return makeSource("tw", channel);
    const video = url.searchParams.get("video");
    if (video) return makeSource("twv", video.replace(/^v/, ""));
    return null;
  }

  if (host === "twitch.tv") {
    if (parts[0] === "videos" && parts[1]) return makeSource("twv", parts[1]);
    if (parts.length >= 3 && parts[1] === "clip") return makeSource("twc", parts[2]);
    if (parts.length >= 3 && parts[1] === "video") return makeSource("twv", parts[2]);
    if (parts[0]) return makeSource("tw", parts[0]);
    return null;
  }

  return null;
}

export function sourcePlatform(s: MediaSource): Platform | null {
  if (s.kind === "yt") return "youtube";
  if (s.kind === "demo") return null;
  return "twitch";
}

export interface EmbedOptions {
  /** Twitch の parent / YouTube チャットの embed_domain に使うホスト名 */
  host: string;
  muted: boolean;
}

export function embedUrl(s: MediaSource, { host, muted }: EmbedOptions): string | null {
  const parent = encodeURIComponent(host);
  switch (s.kind) {
    case "yt":
      return `https://www.youtube.com/embed/${s.id}?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&rel=0`;
    case "tw":
      return `https://player.twitch.tv/?channel=${s.id}&parent=${parent}&autoplay=true&muted=${muted}`;
    case "twv":
      return `https://player.twitch.tv/?video=v${s.id}&parent=${parent}&autoplay=true&muted=${muted}`;
    case "twc":
      return `https://clips.twitch.tv/embed?clip=${s.id}&parent=${parent}&autoplay=true&muted=${muted}`;
    case "demo":
      return null;
  }
}

/** ライブチャットの埋め込みURL（チャットが無いソースは null） */
export function chatUrl(s: MediaSource, host: string): string | null {
  const domain = encodeURIComponent(host);
  if (s.kind === "yt") return `https://www.youtube.com/live_chat?v=${s.id}&embed_domain=${domain}`;
  if (s.kind === "tw") return `https://www.twitch.tv/embed/${s.id}/chat?parent=${domain}&darkpopout`;
  return null;
}

export function watchUrl(s: MediaSource): string | null {
  switch (s.kind) {
    case "yt":
      return `https://www.youtube.com/watch?v=${s.id}`;
    case "tw":
      return `https://www.twitch.tv/${s.id}`;
    case "twv":
      return `https://www.twitch.tv/videos/${s.id}`;
    case "twc":
      return `https://clips.twitch.tv/${s.id}`;
    case "demo":
      return null;
  }
}

/** 名前が分からないときの表示ラベル */
export function fallbackLabel(s: MediaSource): string {
  switch (s.kind) {
    case "yt":
      return "YouTube";
    case "tw":
      return s.id;
    case "twv":
      return "Twitch アーカイブ";
    case "twc":
      return "Twitch クリップ";
    case "demo":
      return "デモ";
  }
}
