"use client";

import { useMemo } from "react";
import { DEFAULT_TALENTS } from "@/data/presets";
import type { LayoutMode } from "@/lib/layout";
import { parseSourceKey } from "@/lib/media";
import { TWITCH_LOGIN_RE, YOUTUBE_CHANNEL_ID_RE, type Stream, type Talent } from "@/lib/types";
import { createLocalStore, useLocalStore } from "./store";

/* ---------- フォロー中のタレント ---------- */

const optionalString = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** localStorage やインポートしたJSONを、壊れた値が混ざっていても安全な Talent[] にする */
export function sanitizeTalents(v: unknown): Talent[] | null {
  if (!Array.isArray(v)) return null;
  const out: Talent[] = [];
  for (const t of v) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || typeof r.name !== "string" || !r.name) continue;
    const youtubeChannelId = optionalString(r.youtubeChannelId);
    const twitchLogin = optionalString(r.twitchLogin)?.toLowerCase();
    out.push({
      id: r.id,
      name: r.name,
      group: optionalString(r.group),
      youtubeChannelId: youtubeChannelId && YOUTUBE_CHANNEL_ID_RE.test(youtubeChannelId) ? youtubeChannelId : undefined,
      twitchLogin: twitchLogin && TWITCH_LOGIN_RE.test(twitchLogin) ? twitchLogin : undefined,
      avatarUrl: optionalString(r.avatarUrl),
      favorite: r.favorite === true ? true : undefined,
    });
  }
  return out;
}

export const talentsStore = createLocalStore<Talent[]>("oshiboard:talents:v1", DEFAULT_TALENTS, sanitizeTalents);

export function useTalents(): Talent[] {
  return useLocalStore(talentsStore);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const talentActions = {
  add(talent: Talent) {
    talentsStore.set((list) => [...list.filter((t) => t.id !== talent.id), talent]);
  },
  addMany(talents: Talent[]) {
    talentsStore.set((list) => {
      const ids = new Set(list.map((t) => t.id));
      return [...list, ...talents.filter((t) => !ids.has(t.id))];
    });
  },
  update(id: string, patch: Partial<Talent>) {
    talentsStore.set((list) => list.map((t) => (t.id === id ? { ...t, ...patch, id } : t)));
  },
  remove(id: string) {
    talentsStore.set((list) => list.filter((t) => t.id !== id));
  },
  toggleFavorite(id: string) {
    talentsStore.set((list) => list.map((t) => (t.id === id ? { ...t, favorite: !t.favorite } : t)));
  },
  replaceAll(list: Talent[]) {
    talentsStore.set(list);
  },
  reset() {
    talentsStore.set(DEFAULT_TALENTS);
  },
};

/** "yt:<channelId>" / "tw:<login>" → タレント */
export function useTalentIndex(talents: Talent[]): Map<string, Talent> {
  return useMemo(() => {
    const map = new Map<string, Talent>();
    for (const t of talents) {
      if (t.youtubeChannelId) map.set(`yt:${t.youtubeChannelId}`, t);
      if (t.twitchLogin) map.set(`tw:${t.twitchLogin.toLowerCase()}`, t);
    }
    return map;
  }, [talents]);
}

export function talentForStream(index: Map<string, Talent>, s: Stream): Talent | undefined {
  return index.get(`${s.platform === "youtube" ? "yt" : "tw"}:${s.channelId}`);
}

/** /api/streams のURL（キャッシュが効くようにIDはソートしておく） */
export function streamsUrl(talents: Talent[]): string | null {
  const yt = [...new Set(talents.map((t) => t.youtubeChannelId).filter((v): v is string => !!v))].sort();
  const tw = [...new Set(talents.map((t) => t.twitchLogin?.toLowerCase()).filter((v): v is string => !!v))].sort();
  if (yt.length === 0 && tw.length === 0) return null;
  const params = new URLSearchParams();
  if (yt.length) params.set("yt", yt.join(","));
  if (tw.length) params.set("tw", tw.join(","));
  return `/api/streams?${params}`;
}

/* ---------- マルチビュー ---------- */

export const MAX_MULTI = 9;

export interface MultiItem {
  uid: string;
  source: string;
  /** タレント名など */
  label?: string;
  /** 配信タイトル */
  title?: string;
  /** 2枚目以降はミュートで開始（音が重ならないように） */
  startMuted: boolean;
  /** ライブチャットがあるか（切り抜き・アーカイブは false）。不明なら undefined */
  chat?: boolean;
  addedAt: number;
}

export interface MultiInput {
  source: string;
  label?: string;
  title?: string;
  chat?: boolean;
}

function validateMulti(v: unknown): MultiItem[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter(
      (m): m is MultiItem =>
        !!m && typeof m === "object" && typeof m.uid === "string" && !!parseSourceKey(String(m.source)),
    )
    .slice(0, MAX_MULTI);
}

export const multiStore = createLocalStore<MultiItem[]>("oshiboard:multi:v1", [], validateMulti);

export function useMulti(): MultiItem[] {
  return useLocalStore(multiStore);
}

export type AddResult = "added" | "exists" | "full";

export const multiActions = {
  add(item: MultiInput): AddResult | "invalid" {
    if (!parseSourceKey(item.source)) return "invalid";
    const list = multiStore.get();
    if (list.some((m) => m.source === item.source)) return "exists";
    if (list.length >= MAX_MULTI) return "full";
    multiStore.set([
      ...list,
      { ...item, uid: newId("m"), startMuted: list.length > 0, addedAt: Date.now() },
    ]);
    return "added";
  },
  /** 追加済みなら外す、なければ追加 */
  toggle(item: MultiInput): AddResult | "invalid" | "removed" {
    const existing = multiStore.get().find((m) => m.source === item.source);
    if (existing) {
      multiActions.remove(existing.uid);
      return "removed";
    }
    return multiActions.add(item);
  },
  remove(uid: string) {
    multiStore.set((list) => list.filter((m) => m.uid !== uid));
  },
  update(uid: string, patch: Partial<Pick<MultiItem, "label" | "title">>) {
    multiStore.set((list) => list.map((m) => (m.uid === uid ? { ...m, ...patch } : m)));
  },
  /** 並び順を1つずらす（dir: -1 で前へ, 1 で後ろへ） */
  move(uid: string, dir: -1 | 1) {
    multiStore.set((list) => {
      const i = list.findIndex((m) => m.uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  },
  /** 先頭（メイン枠）に移動 */
  promote(uid: string) {
    multiStore.set((list) => {
      const item = list.find((m) => m.uid === uid);
      return item ? [item, ...list.filter((m) => m.uid !== uid)] : list;
    });
  },
  clear() {
    multiStore.set([]);
  },
  /** 共有URLから復元 */
  replaceWithSources(sources: string[]) {
    const now = Date.now();
    multiStore.set(
      sources.filter((source) => parseSourceKey(source)).slice(0, MAX_MULTI).map((source, i) => ({
        uid: newId("m"),
        source,
        startMuted: i > 0,
        addedAt: now + i,
      })),
    );
  },
};

export interface MultiPrefs {
  layout: LayoutMode;
  chat: boolean;
}

export const multiPrefsStore = createLocalStore<MultiPrefs>("oshiboard:multi-prefs:v1", {
  layout: "grid",
  chat: false,
});

export function useMultiPrefs(): MultiPrefs {
  return useLocalStore(multiPrefsStore);
}
