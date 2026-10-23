"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareStreams } from "@/lib/streams";
import type { StreamsResponse, Talent } from "@/lib/types";

/** 1リクエストあたりのチャンネル数（サーバー側の上限 YouTube 150 / Twitch 100 より少なめ） */
export const STREAMS_CHUNK = 100;

/**
 * フォロー中のチャンネルを /api/streams の URL に分割する。
 * 数百チャンネルをフォローしても1リクエストが重くならないように、100件ずつに分ける。
 * キャッシュが効くよう ID はソートしておく。
 */
export function streamsUrls(talents: Talent[]): string[] {
  const yt = [...new Set(talents.map((t) => t.youtubeChannelId).filter((v): v is string => !!v))].sort();
  const tw = [...new Set(talents.map((t) => t.twitchLogin?.toLowerCase()).filter((v): v is string => !!v))].sort();
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

/**
 * 複数の URL をまとめて定期取得する。タブが非表示の間は止めて、表示に戻ったら古ければ取り直す。
 * 一部の URL が失敗しても、その URL の前回の結果を残す。
 */
export function usePollingMany<T>(urls: string[] | null, intervalMs: number) {
  const key = urls && urls.length > 0 ? urls.join("\n") : "";
  const [state, setState] = useState<ManyState<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const lastRun = useRef(0);

  useEffect(() => {
    if (!key) return;
    const list = key.split("\n");
    let alive = true;
    let ctrl: AbortController | null = null;

    const run = async () => {
      ctrl?.abort();
      const current = (ctrl = new AbortController());
      lastRun.current = Date.now();
      const results = await Promise.allSettled(
        list.map(async (url) => {
          const res = await fetch(url, { signal: current.signal });
          const json = (await res.json()) as T & { error?: string };
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
          return [url, json] as const;
        }),
      );
      if (!alive || current.signal.aborted) return;
      setState((prev) => {
        const data: Record<string, T> = prev?.key === key ? { ...prev.data } : {};
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
        return { key, data, error, at: anyOk ? Date.now() : prev?.key === key ? prev.at : undefined };
      });
    };

    void run();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRun.current > intervalMs / 2) void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      ctrl?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const current = state?.key === key ? state : null;
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

/** フォロー中の配信（分割して取得したものを1つにまとめる）。talents が null の間は取得しない */
export function useStreamsFeed(talents: Talent[] | null, intervalMs: number) {
  const urls = useMemo(() => (talents ? streamsUrls(talents) : null), [talents]);
  const { results, error, loading, updatedAt, refresh } = usePollingMany<StreamsResponse>(urls, intervalMs);
  const data = useMemo<StreamsResponse | undefined>(() => {
    if (results.length === 0) return undefined;
    return {
      streams: results.flatMap((r) => r.streams).sort(compareStreams),
      errors: results.flatMap((r) => r.errors),
      providers: results[0].providers,
      fetchedAt: results[0].fetchedAt,
    };
  }, [results]);
  return { data, error, loading, updatedAt, refresh };
}
