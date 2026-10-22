"use client";

import { useSyncExternalStore } from "react";

/*
 * localStorage に保存される小さなストア。
 * useSyncExternalStore 経由で読むので、SSR 時は初期値・クライアントでは保存値になり、
 * 他のタブで変更されたときも storage イベントで追従する。
 */
export interface LocalStore<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  initial: T;
}

export function createLocalStore<T>(key: string, initial: T, validate?: (v: unknown) => T | null): LocalStore<T> {
  let value: T | undefined;
  const listeners = new Set<() => void>();

  const read = (): T => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed: unknown = JSON.parse(raw);
      return validate ? (validate(parsed) ?? initial) : (parsed as T);
    } catch {
      return initial;
    }
  };

  const emit = () => listeners.forEach((l) => l());

  const get = (): T => {
    if (value === undefined) value = read();
    return value;
  };

  return {
    initial,
    get,
    set(next) {
      value = typeof next === "function" ? (next as (p: T) => T)(get()) : next;
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {}
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (e: StorageEvent) => {
        if (e.key !== key) return;
        value = read();
        emit();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

export function useLocalStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.get(),
    () => store.initial,
  );
}

const noopSubscribe = () => () => {};

/** クライアントでハイドレーションが終わったら true */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Twitch の parent パラメータ用のホスト名（SSR 中は null） */
export function useHost(): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.hostname,
    () => null,
  );
}

/* 相対時刻表示用の時計。SSR 中は null を返し、クライアントでは15秒ごとに更新 */
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

export function useNow(): number | null {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow || (clockNow = Date.now()),
    () => null,
  );
}
