import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { ImportErrorCode } from "@/lib/importErrors";

/*
 * フォロー取り込み用の OAuth（Twitch / Google）。
 *   1. /api/auth/<provider>/start   … state を cookie に入れてログイン画面へ
 *   2. /api/auth/<provider>/callback … state を確かめてアクセストークンを受け取り、HttpOnly cookie に一時保存
 *   3. /api/import/<provider>       … cookie のトークンでフォロー一覧を取り、すぐにトークンを失効させて cookie を消す
 * トークンはブラウザの JavaScript からは読めず、取り込みが終わったら残らない。
 */

export type OAuthProvider = "twitch" | "google";


const STATE_TTL_SEC = 10 * 60;
const TOKEN_TTL_SEC = 10 * 60;

const stateCookie = (p: OAuthProvider) => `oshiboard_oauth_state_${p}`;
const tokenCookie = (p: OAuthProvider) => `oshiboard_oauth_token_${p}`;

let warnedOrigin = false;

/** 公開URL（リダイレクトURIの組み立て用）。Vercel 以外で動かすときは APP_URL が必要 */
export function appOrigin(request: NextRequest): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const origin = request.nextUrl.origin;
  if (
    !warnedOrigin &&
    !process.env.VERCEL &&
    process.env.NODE_ENV === "production" &&
    /^https?:\/\/(localhost|0\.0\.0\.0|127\.0\.0\.1)(:|$)/.test(origin)
  ) {
    warnedOrigin = true;
    console.warn(
      `[oshi-board] 公開URLが ${origin} と判定されました。Vercel 以外で動かすときは APP_URL（例: https://board.example.com）を設定してください。`,
    );
  }
  return origin;
}

export function callbackUrl(request: NextRequest, provider: OAuthProvider): string {
  return `${appOrigin(request)}/api/auth/${provider}/callback`;
}

function secure(request: NextRequest): boolean {
  return appOrigin(request).startsWith("https://");
}

/** ログイン画面へリダイレクトし、CSRF 対策の state を cookie に保存する */
export function redirectToProvider(
  request: NextRequest,
  provider: OAuthProvider,
  buildUrl: (state: string) => string,
): NextResponse {
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildUrl(state));
  response.cookies.set(stateCookie(provider), state, {
    httpOnly: true,
    secure: secure(request),
    sameSite: "lax",
    path: `/api/auth/${provider}`,
    maxAge: STATE_TTL_SEC,
  });
  return response;
}

/** コールバックの state が start で発行したものと一致するか */
const STATE_RE = /^[0-9a-f]{48}$/;

export function verifyState(request: NextRequest, provider: OAuthProvider): boolean {
  const expected = request.cookies.get(stateCookie(provider))?.value ?? "";
  const actual = request.nextUrl.searchParams.get("state") ?? "";
  // 形式を先に確かめる（長さの違う値を timingSafeEqual に渡すと例外になるため）
  if (!STATE_RE.test(expected) || !STATE_RE.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

/** フォロー管理画面へ戻す（結果はクエリで伝える） */
export function backToChannels(
  request: NextRequest,
  provider: OAuthProvider,
  result: { ok: true; token: string } | { ok: false; error: ImportErrorCode },
): NextResponse {
  const url = new URL("/channels", appOrigin(request));
  if (result.ok) url.searchParams.set("import", provider);
  else {
    url.searchParams.set("import_error", result.error);
    url.searchParams.set("import_provider", provider);
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(stateCookie(provider), "", { path: `/api/auth/${provider}`, maxAge: 0 });
  if (result.ok) {
    response.cookies.set(tokenCookie(provider), result.token, {
      httpOnly: true,
      secure: secure(request),
      sameSite: "strict",
      path: `/api/import/${provider}`,
      maxAge: TOKEN_TTL_SEC,
    });
  }
  return response;
}

export function readToken(request: NextRequest, provider: OAuthProvider): string | undefined {
  return request.cookies.get(tokenCookie(provider))?.value || undefined;
}

export function clearToken(response: NextResponse, provider: OAuthProvider): NextResponse {
  response.cookies.set(tokenCookie(provider), "", { path: `/api/import/${provider}`, maxAge: 0 });
  return response;
}

/** application/x-www-form-urlencoded で POST して JSON を受け取る */
export async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host}: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}
