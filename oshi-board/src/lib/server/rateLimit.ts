import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/*
 * IPアドレスごとの簡易レート制限（プロセス内）。
 * 外部APIのクォータを第三者に使い切られないための追加の防御で、通常の画面操作では引っかからない回数にしている。
 * クォータ自体はサーバー全体の上限（cache.ts の takeBudget）で守っているので、こちらは多少すり抜けられても致命的ではない。
 *
 * IPはクライアントが書き換えられないヘッダーから取る:
 *   - Vercel: x-vercel-forwarded-for / x-real-ip（Vercel が上書きする）
 *   - nginx などの手前のプロキシ: x-real-ip（$remote_addr を設定しておく）
 * どちらも無い（プロキシなしで next start している）場合は X-Forwarded-For の右端を使うが、偽装できる。
 */

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 20_000;

const g = globalThis as typeof globalThis & { __oshiRateLimits?: Map<string, { window: number; used: number }> };
const buckets = (g.__oshiRateLimits ??= new Map());

/** "1.2.3.4:5678" → "1.2.3.4"、IPv6 は /64 単位にまとめる（1台で大量のアドレスを使えるため） */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().replace(/^\[|\](?::\d+)?$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, "");
  if (ip.includes(":")) {
    const parts = ip.toLowerCase().split("::")[0].split(":");
    return `${parts.slice(0, 4).join(":")}::/64`;
  }
  return ip || "unknown";
}

export function clientIp(headers: Headers): string {
  const trusted = headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip");
  if (trusted) return normalizeIp(trusted.split(",")[0]);
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return normalizeIp(forwarded?.at(-1) ?? "unknown");
}

function take(key: string, limit: number): boolean {
  const window = Math.floor(Date.now() / WINDOW_MS);
  const current = buckets.get(key);
  if (current && current.window === window) {
    if (current.used >= limit) return false;
    current.used++;
    return true;
  }
  buckets.delete(key);
  buckets.set(key, { window, used: 1 });
  if (buckets.size > MAX_BUCKETS) {
    // 古い時間枠のものから捨てる（Map は挿入順なので先頭ほど古い）
    for (const [k, v] of buckets) {
      if (buckets.size <= MAX_BUCKETS) break;
      if (v.window < window) buckets.delete(k);
    }
    for (const k of buckets.keys()) {
      if (buckets.size <= MAX_BUCKETS) break;
      buckets.delete(k);
    }
  }
  return true;
}

/** 制限内なら null、超えたら 429 のレスポンスを返す */
export function rateLimit(request: NextRequest, name: string, limitPerMinute: number): NextResponse | null {
  if (take(`${name}:${clientIp(request.headers)}`, limitPerMinute)) return null;
  return NextResponse.json(
    { error: "リクエストが多すぎます。少し待ってから再試行してください" },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}
