import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { takeBudget } from "./cache";

/**
 * IPアドレスごとの簡易レート制限（プロセス内）。
 * 外部APIのクォータを第三者に使い切られないためのもので、通常の画面操作では引っかからない回数にしている。
 * 制限内なら null、超えたら 429 のレスポンスを返す。
 */
export function rateLimit(request: NextRequest, name: string, limitPerMinute: number): NextResponse | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (takeBudget(`rl:${name}:${ip}`, limitPerMinute, 60_000)) return null;
  return NextResponse.json(
    { error: "リクエストが多すぎます。少し待ってから再試行してください" },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}
