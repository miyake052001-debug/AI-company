"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { compareStreams } from "@/lib/streams";
import type { StreamsResponse, Talent } from "@/lib/types";

/** 1リクエストあたりのチャンネル数（サーバー側の上限 YouTube 150 / Twitch 100 より少なめ） */
export const STREAMS_CHUNK = 100;
/** 配信を確認するチャンネル数の上限（お気に入りを優先）。API の1日の枠と更新の速さのため */
export const MAX_POLLED_CHANNELS = 1000;

/** 確認するチャンネル（お気に入りを先にして上限まで）と、上限で外れた数 */
export function polledChannels(talents: Talent[]) {
  const ordered = [...talents.filter((t) => t.favorite), ...talents.filter((t) => !t.favorite)];
  const yt = [...new Set(ordered.map((t) => t.youtubeChannelId).filter((v): v is string => !!v))];
  const tw = [...new Set(ordered.map((t) => t.twitchLogin?.toLowerCase()).filter((v): v is string => !!v))];
  return {
    yt: yt.slice(0, MAX_POLLED_CHANNELS),
    tw: tw.slice(0, MAX_POLLED_CHANNELS),
    skipped: Math.max(0, yt.length - MAX_POLLED_CHANNELS) + Math.max(0, tw.length - MAX_POLLED_CHANNELS),
  };
}

/**
 * フォロー中のチャンネルを /api/streams の URL に分割する。
 * 数百チャンネルをフォローしても1リクエストが重くならないように、100件ずつに分ける。
 * キャッシュが効くよう ID はソートしておく。
 */
export function streamsUrls(talents: Talent[]): string[] {
  const polled = polledChannels(talents);
  const yt = [...polled.yt].sort();
  const tw = [...polled.tw].sort();
  const urls: string[] = [];
  const chunks = Math.max(Math.ceil(yt.length / STREAMS_CHUNK), Math.ceil(tw.length / STREAMS_CHUNK));
  for (let i = 0; i < chunks; i++) {
    const params = new URLSearchParams();
    const ytPart = yt.slice(i * STREAMS_CHUNK, (i + 1) * STREAMS_CHUNK);
    const twPart = tw.slice(i * STREAMS_CHUNK, (i + 1) * STREAMS_CHUNK);
    if (ytPart.length) params.set("yt", ytPart.join(","));
    if (twPart.length) params.set("tw", twPart.join(","));
    urls.push(`/api/streams?${params}`);
  }
  return urls;
}

interface ManyState<T> {
  key: string;
  data: Record<string, T>;
  error?: string;
  at?: number;
}

/*
 * 直近の取得結果（URL の組ごと）。同じフォローを表示するページ（配信・フォロー管理・マルチビュー）で共有し、
 * どのページが取っても、表示中のページはすぐ最新の結果に切り替わる。
 * ページを移動して戻ったとき（Activity の再表示）は、取ったばかりなら取り直さずにこれを表示する。
 */
const recent = new Map<string, { attemptedAt: number; state: ManyState<unknown> }>();
const recentListeners = new Set<() => void>();

function remember(key: string, state: ManyState<unknown>) {
  recent.delete(key);
  recent.set(key, { attemptedAt: Date.now(), state });
  if (recent.size > 20) recent.delete(recent.keys().next().value!);
  recentListeners.forEach((l) => l());
}

function subscribeRecent(listener: () => void) {
  recentListeners.add(listener);
  return () => {
    recentListeners.delete(listener);
  };
}

/**
 * 複数の URL をまとめて定期取得する。タブが非表示の間は止めて、表示に戻ったら古ければ取り直す。
 * 一部の URL が失敗しても、その URL の前回の結果を残す。
 */
export function usePollingMany<T>(urls: string[] | null, intervalMs: number) {
  const key = urls && urls.length > 0 ? urls.join("\n") : "";
  const current = useSyncExternalStore(
    subscribeRecent,
    () => (key ? (recent.get(key)?.state as ManyState<T> | undefined) : undefined),
    () => undefined,
  );
  const [nonce, setNonce] = useState(0);
  // 「更新」ボタンのときはブラウザのキャッシュ（stale-while-revalidate）を使わない
  const forceRef = useRef(false);

  useEffect(() => {
    if (!key) return;
    const list = key.split("\n");
    let alive = true;
    let ctrl: AbortController | null = null;
    // この画面で取得を始めた時刻（取得中にタブへ戻っても、始めたばかりの取得をやり直さない）
    let startedAt = 0;

    const run = async () => {
      ctrl?.abort();
      const current = (ctrl = new AbortController());
      startedAt = Date.now();
      const cache: RequestCache = forceRef.current ? "no-cache" : "default";
      forceRef.current = false;
      const results = await Promise.allSettled(
        list.map(async (url) => {
          const res = await fetch(url, { signal: current.signal, cache });
          const json = (await res.json()) as T & { error?: string };
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
          return [url, json] as const;
        }),
      );
      if (!alive || current.signal.aborted) return;
      // 待っている間に別のページが新しい結果を入れていれば、それに重ねる
      const prev = recent.get(key)?.state as ManyState<T> | undefined;
      const data: Record<string, T> = { ...prev?.data };
      let error: string | undefined;
      let anyOk = false;
      for (const r of results) {
        if (r.status === "fulfilled") {
          data[r.value[0]] = r.value[1];
          anyOk = true;
        } else {
          error ??= r.reason instanceof Error ? r.reason.message : String(r.reason);
        }
      }
      remember(key, { key, data, error, at: anyOk ? Date.now() : prev?.at });
    };

    // 直近に取ったばかりなら（別ページから戻ってきただけ・別の画面が取ったばかりなら）取り直さない
    const stale = () => Date.now() - Math.max(startedAt, recent.get(key)?.attemptedAt ?? 0) >= intervalMs / 2;
    if (stale()) void run();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && stale()) void run();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && stale()) void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      ctrl?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, intervalMs, nonce]);

  const refresh = useCallback(() => {
    // 表示中の結果は残したまま、すぐに取り直す
    const entry = recent.get(key);
    if (entry) entry.attemptedAt = 0;
    forceRef.current = true;
    setNonce((n) => n + 1);
  }, [key]);
  // 取得結果が変わったときだけ新しい配列にする（下流の useMemo を無駄に再計算させない）
  const results = useMemo(
    () => (key && current ? key.split("\n").flatMap((u) => (current.data[u] ? [current.data[u]] : [])) : []),
    [key, current],
  );
  return {
    results,
    error: current?.error,
    loading: !!key && !current,
    updatedAt: current?.at,
    refresh,
  };
}

/**
 * フォロー中の配信（分割して取得したものを1つにまとめる）。talents が null の間は取得しない。
 * フォローが多い（リクエストが多い）ほど更新間隔を延ばす（最大で5倍）。
 */
export function useStreamsFeed(talents: Talent[] | null, intervalMs: number) {
  const urls = useMemo(() => (talents ? streamsUrls(talents) : null), [talents]);
  const skipped = useMemo(() => (talents ? polledChannels(talents).skipped : 0), [talents]);
  const interval = intervalMs * Math.min(5, Math.max(1, Math.ceil((urls?.length ?? 0) / 3)));
  const { results, error, loading, updatedAt, refresh } = usePollingMany<StreamsResponse>(urls, interval);
  const data = useMemo<StreamsResponse | undefined>(() => {
    if (results.length === 0) return undefined;
    // 分割したリクエストごとに同じ API 全体のエラーが返るので、重複を除く
    const seen = new Set<string>();
    const errors = results
      .flatMap((r) => r.errors)
      .filter((e) => {
        const k = `${e.channel}\n${e.message}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    return {
      streams: results.flatMap((r) => r.streams).sort(compareStreams),
      errors,
      providers: results[0].providers,
      fetchedAt: results[0].fetchedAt,
    };
  }, [results]);
  return { data, error, loading, updatedAt, refresh, skipped, intervalMs: interval };
}
