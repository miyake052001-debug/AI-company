import "server-only";
import type { ImportCandidate, ImportResponse } from "@/lib/types";
import { LimitError, takeBudget } from "./cache";
import { postForm } from "./oauth";
import { twitchUsers } from "./twitch";

/* ---------- Twitch（user:read:follows） ---------- */

/** 1000件（10ページ×100）を超えるフォローは途中まで */
const TWITCH_MAX_PAGES = 10;

export async function exchangeTwitchCode(code: string, redirectUri: string): Promise<string> {
  const json = await postForm<{ access_token: string }>("https://id.twitch.tv/oauth2/token", {
    client_id: process.env.TWITCH_CLIENT_ID ?? "",
    client_secret: process.env.TWITCH_CLIENT_SECRET ?? "",
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  return json.access_token;
}

async function twitchGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    cache: "no-store",
    headers: { "Client-Id": process.env.TWITCH_CLIENT_ID ?? "", Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error("Twitch のログインの有効期限が切れました。もう一度取り込んでください");
  if (!res.ok) throw new Error(`Twitch API ${path.split("?")[0]}: ${res.status}`);
  return (await res.json()) as T;
}

/** このアプリで発行したトークンか（他のアプリのトークンでアプリ側の枠を使わせない） */
async function validateTwitchToken(token: string): Promise<{ userId: string }> {
  const res = await fetch("https://id.twitch.tv/oauth2/validate", {
    cache: "no-store",
    headers: { Authorization: `OAuth ${token}` },
  });
  if (res.status === 401) throw new Error("Twitch のログインの有効期限が切れました。もう一度取り込んでください");
  if (!res.ok) throw new Error(`Twitch のログインを確認できませんでした（${res.status}）`);
  const info = (await res.json()) as { client_id?: string; user_id?: string; scopes?: string[] };
  if (info.client_id !== process.env.TWITCH_CLIENT_ID || !info.user_id || !info.scopes?.includes("user:read:follows")) {
    throw new Error("このアプリのログインではありません。もう一度取り込んでください");
  }
  return { userId: info.user_id };
}

export async function fetchTwitchFollows(token: string): Promise<ImportResponse> {
  const { userId } = await validateTwitchToken(token);

  const follows: { login: string; name: string }[] = [];
  let cursor: string | undefined;
  let truncated = false;
  for (let page = 0; page < TWITCH_MAX_PAGES; page++) {
    const params = new URLSearchParams({ user_id: userId, first: "100" });
    if (cursor) params.set("after", cursor);
    const data = await twitchGet<{
      data: { broadcaster_login: string; broadcaster_name: string }[];
      pagination?: { cursor?: string };
    }>(`channels/followed?${params}`, token);
    follows.push(...data.data.map((f) => ({ login: f.broadcaster_login.toLowerCase(), name: f.broadcaster_name })));
    cursor = data.pagination?.cursor;
    if (!cursor) break;
    if (page === TWITCH_MAX_PAGES - 1) truncated = true;
  }

  // アイコンはアプリのトークンでまとめて取る（取れなくても取り込みは続ける）
  let avatars = new Map<string, string | undefined>();
  try {
    const users = await twitchUsers(follows.map((f) => f.login));
    avatars = new Map([...users].map(([login, u]) => [login, u.avatarUrl]));
  } catch {}

  return {
    candidates: follows.map(
      (f): ImportCandidate => ({ platform: "twitch", id: f.login, name: f.name, avatarUrl: avatars.get(f.login) }),
    ),
    truncated,
  };
}

export async function revokeTwitchToken(token: string): Promise<void> {
  await fetch("https://id.twitch.tv/oauth2/revoke", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID ?? "", token }),
  }).catch(() => {});
}

/* ---------- Google / YouTube（youtube.readonly） ---------- */

/** 2000件（40ページ×50）を超える登録チャンネルは途中まで */
const YOUTUBE_MAX_PAGES = 40;
/** subscriptions.list はアプリのクォータ（1ページ1ユニット）を使うので、全体で1時間あたりの上限を設ける */
const SUBSCRIPTION_PAGES_PER_HOUR = 400;

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<string> {
  const json = await postForm<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  return json.access_token;
}

const YOUTUBE_READONLY = "https://www.googleapis.com/auth/youtube.readonly";

/** このアプリで発行したトークンか（偽のトークンで全体の上限を使わせない） */
async function validateGoogleToken(token: string): Promise<void> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (res.status === 400 || res.status === 401) {
    throw new Error("Google のログインの有効期限が切れました。もう一度取り込んでください");
  }
  if (!res.ok) throw new Error(`Google のログインを確認できませんでした（${res.status}）`);
  const info = (await res.json()) as { aud?: string; azp?: string; scope?: string };
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || (info.aud !== clientId && info.azp !== clientId) || !info.scope?.split(" ").includes(YOUTUBE_READONLY)) {
    throw new Error("このアプリのログインではありません。もう一度取り込んでください");
  }
}

export async function fetchYouTubeSubscriptions(token: string): Promise<ImportResponse> {
  await validateGoogleToken(token);
  const candidates: ImportCandidate[] = [];
  let pageToken: string | undefined;
  let truncated = false;
  for (let page = 0; page < YOUTUBE_MAX_PAGES; page++) {
    if (!takeBudget("yt:subscriptions", SUBSCRIPTION_PAGES_PER_HOUR, 60 * 60_000)) {
      if (candidates.length === 0) {
        throw new LimitError("取り込みが混み合っています。しばらくしてから再試行してください");
      }
      truncated = true;
      break;
    }
    const params = new URLSearchParams({ part: "snippet", mine: "true", maxResults: "50" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/youtube/v3/subscriptions?${params}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error("Google のログインの有効期限が切れました。もう一度取り込んでください");
    if (!res.ok) {
      let reason = "";
      try {
        reason = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
      } catch {}
      throw new Error(`YouTube の登録チャンネルを取得できませんでした（${res.status}${reason ? `: ${reason}` : ""}）`);
    }
    const data = (await res.json()) as {
      items?: {
        snippet?: {
          title?: string;
          resourceId?: { channelId?: string };
          thumbnails?: { default?: { url: string } };
        };
      }[];
      nextPageToken?: string;
    };
    for (const item of data.items ?? []) {
      const id = item.snippet?.resourceId?.channelId;
      if (!id) continue;
      candidates.push({
        platform: "youtube",
        id,
        name: item.snippet?.title || id,
        avatarUrl: item.snippet?.thumbnails?.default?.url,
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
    if (page === YOUTUBE_MAX_PAGES - 1) truncated = true;
  }
  return { candidates, truncated };
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  }).catch(() => {});
}
