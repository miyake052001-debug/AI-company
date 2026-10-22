import "server-only";
import { NextResponse, type NextRequest } from "next/server";

/*
 * IPアドレスごとの簡易レート制限（プロセス内）。
 * 外部APIのクォータを第三者に使い切られないための追加の防御で、通常の画面操作では引っかからない回数にしている。
 * クォータ自体はサーバー全体の上限（cache.ts の takeBudget）で守っているので、こちらは多少すり抜けられても致命的ではない。
 *
 * 接続元IPはクライアントが書き換えられない値から取る（上から順に）:
 *   1. TRUSTED_IP_HEADER に指定したヘッダー（例: Cloudflare なら cf-connecting-ip。Vercel の前に置いた場合も）
 *   2. Vercel 上なら、Vercel が上書きする x-vercel-forwarded-for / x-real-ip
 *   3. X-Forwarded-For の右から TRUST_PROXY_HOPS 番目（既定 1 = 直前のプロキシが付けた値）。
 *      それがローカル/プライベートアドレスなら、手前のプロキシ（nginx など）が X-Forwarded-For を付けていないので
 *      プロキシが設定した X-Real-IP を使う
 * プロキシなしで next start している場合はクライアントが X-Forwarded-For を偽装できる。
 */

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 20_000;

const g = globalThis as typeof globalThis & { __oshiRateLimits?: Map<string, { window: number; used: number }> };
const buckets = (g.__oshiRateLimits ??= new Map());

/** "a::b" を8グループに展開する（不正なら null） */
function expandIpv6(ip: string): string[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<string>(missing).fill("0"), ...tail];
}

/**
 * 表記ゆれをなくしてバケットのキーにする。
 * "1.2.3.4:5678" → "1.2.3.4"、"::ffff:1.2.3.4" → "1.2.3.4"、
 * IPv6 は /64 単位にまとめる（1台で大量のアドレスを使えるため）。
 */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1];
  ip = ip.replace(/%.*$/, ""); // スコープID（fe80::1%eth0）
  // IPv4 射影アドレス（デュアルスタックで待ち受けると IPv4 の接続元がこの形になる）
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(ip)) return ip.replace(/:\d+$/, "");
  if (ip.includes(":")) {
    const groups = expandIpv6(ip);
    if (!groups) return ip;
    return `${groups
      .slice(0, 4)
      .map((x) => x.replace(/^0+(?=.)/, ""))
      .join(":")}::/64`;
  }
  return ip || "unknown";
}

/** ループバック・プライベート・リンクローカル（正規化後の表記で判定） */
function isLocalAddress(ip: string): boolean {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0:0:0:0::\/64$|f[cd][0-9a-f]{0,2}:|fe80:)/.test(ip);
}

export function clientIp(headers: Headers): string {
  const trustedHeader = process.env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (trustedHeader) {
    const value = headers.get(trustedHeader);
    if (value) return normalizeIp(value.split(",")[0]);
  }
  if (process.env.VERCEL) {
    const vercel = headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip");
    if (vercel) return normalizeIp(vercel.split(",")[0]);
  }
  const forwarded = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS) || 1);
  const ip = normalizeIp(forwarded[Math.max(0, forwarded.length - hops)] ?? "unknown");
  const realIp = headers.get("x-real-ip");
  if ((ip === "unknown" || isLocalAddress(ip)) && realIp) return normalizeIp(realIp.split(",")[0]);
  return ip;
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
