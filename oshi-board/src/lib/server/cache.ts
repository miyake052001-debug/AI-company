import "server-only";

/*
 * プロセス内の TTL キャッシュ。
 * API のクォータ節約が目的なので、同じキーへの同時リクエストは1回にまとめ、失敗も短時間キャッシュする。
 * サーバーレス環境ではインスタンスごとのキャッシュになるが、CDN の Cache-Control と併用すれば十分。
 *
 * キーの先頭2要素（"yt:video" など）ごとに別の Map に入れて上限を持たせる。
 * 安いエントリ（存在しないIDの否定キャッシュなど）が大量に入っても、高い検索結果が追い出されないようにするため。
 */

interface Entry {
  value: unknown;
  expires: number;
}

interface Failure {
  message: string;
  expires: number;
}

const MAX_PER_FAMILY = 3000;
/** 件数が多くなる種類だけ上限を広げる（動画ごとの情報など。1件あたり数百バイト。1000チャンネルで約1万件） */
const FAMILY_LIMITS: Record<string, number> = { "yt:video": 50_000, "yt:views": 30_000 };
/**
 * 期限切れでも peekStale で使い続ける種類（終了済みの動画など）。あふれたとき期限切れをまとめて消さず、
 * 使われていない順（touch / put の古い順）に消す。
 */
const LRU_FAMILIES = new Set(["yt:video"]);
const MAX_FAILURES = 3000;

const g = globalThis as typeof globalThis & {
  __oshiCache?: Map<string, Map<string, Entry>>;
  __oshiFailures?: Map<string, Failure>;
  __oshiInflight?: Map<string, Promise<unknown>>;
  __oshiBudgets?: Map<string, { window: number; used: number }>;
};
const families = (g.__oshiCache ??= new Map());
const failures = (g.__oshiFailures ??= new Map());
const inflight = (g.__oshiInflight ??= new Map());
const budgets = (g.__oshiBudgets ??= new Map());

function familyOf(key: string): Map<string, Entry> {
  const name = key.split(":", 2).join(":");
  let family = families.get(name);
  if (!family) {
    family = new Map();
    families.set(name, family);
  }
  return family;
}

function evict<T extends { expires: number }>(map: Map<string, T>, max: number, purgeExpired = true) {
  if (map.size <= max) return;
  const now = Date.now();
  if (purgeExpired) for (const [k, v] of map) if (v.expires <= now) map.delete(k);
  // 期限切れを消しても多ければ古い順に消す（Map は挿入順）
  for (const k of map.keys()) {
    if (map.size <= max) break;
    map.delete(k);
  }
}

/** 有効期限内の値。期限切れは undefined（ただし peekStale 用に残しておく） */
export function peek<T>(key: string): T | undefined {
  const hit = familyOf(key).get(key);
  return hit && hit.expires > Date.now() ? (hit.value as T) : undefined;
}

/** 期限切れでも残っていれば返す（API が失敗したときの代替表示用） */
export function peekStale<T>(key: string): T | undefined {
  return familyOf(key).get(key)?.value as T | undefined;
}

export function put<T>(key: string, value: T, ttlMs: number): void {
  const family = familyOf(key);
  const name = key.split(":", 2).join(":");
  family.delete(key);
  family.set(key, { value, expires: Date.now() + ttlMs });
  evict(family, FAMILY_LIMITS[name] ?? MAX_PER_FAMILY, !LRU_FAMILIES.has(name));
}

/** 使ったことを記録する（LRU_FAMILIES で、あふれたときに後回しで消されるように）。期限は変えない */
export function touch(key: string): void {
  const family = familyOf(key);
  const entry = family.get(key);
  if (!entry) return;
  family.delete(key);
  family.set(key, entry);
}

/** 失敗を覚えている最中か（その間 cached() は API を呼ばずにエラーを返す） */
export function hasFreshFailure(key: string): boolean {
  const failure = failures.get(key);
  return !!failure && failure.expires > Date.now();
}

export interface CacheOptions<T> {
  /** 成功時の保存期間。結果に応じて変えられる */
  ttl: number | ((value: T) => number);
  /** 失敗を覚えておく期間。この間は同じキーで API を叩かずに同じエラーを返す */
  errorTtl?: number | ((error: unknown) => number);
  /** 失敗したとき、期限切れの古い値があればそれを返す */
  staleOnError?: boolean;
}

/** キャッシュにあれば返し、なければ fn を実行して保存する */
export async function cached<T>(key: string, opts: CacheOptions<T>, fn: () => Promise<T>): Promise<T> {
  const hit = peek<T>(key);
  if (hit !== undefined) return hit;

  const stale = () => (opts.staleOnError ? peekStale<T>(key) : undefined);

  const failure = failures.get(key);
  if (failure && failure.expires > Date.now()) {
    const old = stale();
    if (old !== undefined) return old;
    throw new Error(failure.message);
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fn()
    .then((value) => {
      failures.delete(key);
      put(key, value, typeof opts.ttl === "function" ? opts.ttl(value) : opts.ttl);
      return value;
    })
    .catch((e: unknown) => {
      if (opts.errorTtl !== undefined) {
        const ttl = typeof opts.errorTtl === "function" ? opts.errorTtl(e) : opts.errorTtl;
        failures.set(key, { message: errorMessage(e), expires: Date.now() + ttl });
        evict(failures, MAX_FAILURES);
      }
      const old = stale();
      if (old !== undefined) return old;
      throw e;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** 回数制限に引っかかったときのエラー（短時間だけキャッシュする） */
export class LimitError extends Error {}

/**
 * 時間枠ごとの回数制限（アプリ全体で共有する上限用。名前は固定の数種類だけにすること）。
 * 外部から好きな入力で叩ける API の、クォータを食う呼び出しに上限をかけるために使う。
 * IPごとの制限は rateLimit.ts の別の Map で管理する（こちらの上限が追い出されないように）。
 */
export function takeBudget(name: string, limit: number, windowMs: number, offsetMs = 0): boolean {
  const window = Math.floor((Date.now() + offsetMs) / windowMs);
  const current = budgets.get(name);
  if (!current || current.window !== window) {
    budgets.set(name, { window, used: 1 });
    return limit >= 1;
  }
  if (current.used >= limit) return false;
  current.used++;
  return true;
}

/** 時間枠の残りを使い切った扱いにする（API 側からクォータ超過が返ったとき） */
export function exhaustBudget(name: string, windowMs: number, offsetMs = 0): void {
  budgets.set(name, { window: Math.floor((Date.now() + offsetMs) / windowMs), used: Number.POSITIVE_INFINITY });
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
