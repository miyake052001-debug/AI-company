import "server-only";
import type { Clip, Stream } from "@/lib/types";

/*
 * APIキー未設定でも画面を確認できるようにするためのデモデータ。
 * 1時間ごとに内容が変わる（同じ1時間の間は同じ結果になる）。
 */

const STREAM_TITLES = [
  "【雑談】まったりおしゃべりしよ🌙",
  "【APEX】ランクマッチ！今日こそマスター行く",
  "【歌枠】リクエストありがとう♪ 夜の歌枠",
  "【Minecraft】拠点を建築するぞ！",
  "【朝活】おはよう！みんなで朝ごはん",
  "【スト6】ランクマで修行",
  "【ホラーゲーム】絶叫注意…！ひとりで遊ぶ",
  "【同時視聴】みんなで映画観よう",
  "【VALORANT】フルパでわいわい",
  "【ポケモン】色違い厳選耐久",
];

const GAMES = ["雑談", "Apex Legends", "歌枠", "Minecraft", "Just Chatting", "Street Fighter 6", "VALORANT"];

const CLIP_TITLES = [
  "{name}の神プレイまとめ【切り抜き】",
  "{name}、まさかの展開に大爆笑ｗｗｗ",
  "【切り抜き】{name}の可愛すぎる瞬間",
  "{name}が本気で驚いた瞬間【切り抜き】",
  "【手描き】{name}の名言集",
  "{name}の歌声に鳥肌が止まらない【歌枠切り抜き】",
  "{name}、ついに禁断の一言を…【切り抜き】",
  "1分でわかる{name}【ショート】",
];

/** 文字列から決定的な疑似乱数を作る */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, items: T[]): T {
  return items[Math.floor(r() * items.length)];
}

export function demoStreams(platform: "youtube" | "twitch", channels: string[]): Stream[] {
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);
  const streams: Stream[] = [];
  for (const channel of channels) {
    const r = rng(`${platform}:${channel}:${hour}`);
    const roll = r();
    const status = roll < 0.35 ? "live" : roll < 0.7 ? "upcoming" : roll < 0.85 ? "ended" : null;
    if (!status) continue;
    const startAt =
      status === "live"
        ? now - (10 + r() * 180) * 60_000
        : status === "upcoming"
          ? now + (15 + r() * 60 * 30) * 60_000
          : now - (3 + r() * 30) * 3_600_000;
    const id = `${platform === "youtube" ? "yt" : "tw"}-${channel}`;
    streams.push({
      id: `demo:${id}`,
      source: `demo:${id}`,
      platform,
      status,
      title: pick(r, STREAM_TITLES),
      channelId: channel,
      channelName: "",
      url: platform === "youtube" ? `https://www.youtube.com/channel/${channel}` : `https://www.twitch.tv/${channel}`,
      viewers: status === "live" ? Math.floor(500 + r() * 40000) : undefined,
      startAt: new Date(startAt).toISOString(),
      endAt: status === "ended" ? new Date(startAt + 2 * 3_600_000).toISOString() : undefined,
      category: platform === "twitch" ? pick(r, GAMES) : undefined,
      demo: true,
    });
  }
  return streams;
}

export function demoClips(
  talent: { id: string; name: string },
  platform: "youtube" | "twitch",
  periodMs: number,
): Clip[] {
  const now = Date.now();
  const r = rng(`clips:${platform}:${talent.id}:${Math.floor(now / 3_600_000)}`);
  const count = platform === "youtube" ? 8 : 4;
  return Array.from({ length: count }, (_, i): Clip => {
    const title = pick(r, CLIP_TITLES).replace("{name}", talent.name);
    const id = `clip-${platform}-${talent.id}-${i}`;
    return {
      id: `demo:${id}`,
      source: `demo:${id}`,
      platform,
      title: platform === "twitch" ? title.replace(/【.*?】/g, "") : title,
      url: "#",
      channelName: platform === "youtube" ? pick(r, ["切り抜きch", "推し活切り抜き", "まいにち切り抜き"]) : "viewer さんのクリップ",
      talentId: talent.id,
      publishedAt: new Date(now - r() * periodMs).toISOString(),
      viewCount: Math.floor(r() * 300000),
      durationSec: platform === "twitch" ? Math.floor(10 + r() * 50) : Math.floor(40 + r() * 900),
      via: "demo",
      demo: true,
    };
  });
}

const DEMO_STREAMERS = ["ゲーム実況者A", "ストリーマーB", "配信者C", "実況者D", "FPSプレイヤーE", "雑談配信者F", "RTA走者G", "格ゲー勢H"];
const DEMO_VTUBERS: [string, string][] = [
  ["VTuber あおい", "ホロライブ"],
  ["VTuber みどり", "にじさんじ"],
  ["VTuber しろ", "ぶいすぽっ！"],
  ["VTuber くろ", "個人勢"],
  ["VTuber あか", "ホロライブ"],
  ["VTuber きいろ", "にじさんじ"],
];

/** 「見つける」タブのデモデータ（キー未設定のとき） */
export function demoDiscover(kind: "twitch" | "vtuber"): Stream[] {
  const now = Date.now();
  const r = rng(`discover:${kind}:${Math.floor(now / 3_600_000)}`);
  const entries: [string, string | undefined][] =
    kind === "twitch" ? DEMO_STREAMERS.map((n) => [n, undefined]) : DEMO_VTUBERS;
  return entries
    .map(([name, org], i): Stream => {
      const id = `discover-${kind}-${i}`;
      return {
        id: `demo:${id}`,
        source: `demo:${id}`,
        platform: kind === "twitch" ? "twitch" : "youtube",
        status: "live",
        title: pick(r, STREAM_TITLES),
        channelId: id,
        channelName: name,
        url: "#",
        viewers: Math.floor(300 + r() * 30000),
        startAt: new Date(now - (10 + r() * 180) * 60_000).toISOString(),
        category: kind === "twitch" ? pick(r, GAMES) : undefined,
        org,
        demo: true,
      };
    })
    .sort((a, b) => (b.viewers ?? 0) - (a.viewers ?? 0));
}
