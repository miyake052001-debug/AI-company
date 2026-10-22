import "server-only";

/*
 * プロセス内の TTL キャッシュ。
 * API のクォータ節約が目的なので、同じキーへの同時リクエストは1回にまとめる。
 * サーバーレス環境ではインスタンスごとのキャッシュになるが、CDN の Cache-Control と併用すれば十分。
 */

interface Entry {
  value: unknown;
  expires: number;
}

const MAX_ENTRIES = 5000;

const g = globalThis as typeof globalThis & {
  __oshiCache?: Map<string, Entry>;
  __oshiInflight?: Map<string, Promise<unknown>>;
};
const store = (g.__oshiCache ??= new Map());
const inflight = (g.__oshiInflight ??= new Map());

export function peek<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function put<T>(key: string, value: T, ttlMs: number): void {
  store.delete(key);
  store.set(key, { value, expires: Date.now() + ttlMs });
  if (store.size > MAX_ENTRIES) {
    // Map は挿入順なので先頭が一番古い
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

/** キャッシュにあれば返し、なければ fn を実行して保存する。ttl は結果に応じて変えられる */
export async function cached<T>(key: string, ttl: number | ((value: T) => number), fn: () => Promise<T>): Promise<T> {
  const hit = peek<T>(key);
  if (hit !== undefined) return hit;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fn()
    .then((value) => {
      put(key, value, typeof ttl === "function" ? ttl(value) : ttl);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** 同時実行数を制限した map */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
