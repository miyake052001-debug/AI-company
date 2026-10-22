"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface PollState<T> {
  url: string;
  data?: T;
  error?: string;
  at: number;
}

/**
 * URL を定期的に取得する。タブが非表示の間は止めて、表示に戻ったら古ければ取り直す。
 */
export function usePolling<T>(url: string | null, intervalMs: number) {
  const [state, setState] = useState<PollState<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const lastRun = useRef(0);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let ctrl: AbortController | null = null;

    const run = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      lastRun.current = Date.now();
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        const json = (await res.json()) as T & { error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (alive) setState({ url, data: json, at: Date.now() });
      } catch (e) {
        if (!alive || (e instanceof DOMException && e.name === "AbortError")) return;
        const message = e instanceof Error ? e.message : String(e);
        setState((prev) => ({ url, data: prev?.url === url ? prev.data : undefined, error: message, at: Date.now() }));
      }
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
  }, [url, intervalMs, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  const current = state && state.url === url ? state : null;
  return {
    data: current?.data,
    error: current?.error,
    loading: !!url && !current,
    updatedAt: current?.at,
    refresh,
  };
}
