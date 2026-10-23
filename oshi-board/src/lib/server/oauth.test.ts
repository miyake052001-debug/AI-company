import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backToChannels, callbackUrl, redirectToProvider, verifyState } from "./oauth";

afterEach(() => vi.unstubAllEnvs());

describe("oauth", () => {
  it("state を cookie に入れてログイン画面へ送り、コールバックで照合する", () => {
    const start = new NextRequest("https://oshi.example/api/auth/twitch/start");
    const res = redirectToProvider(start, "twitch", (state) => `https://id.twitch.tv/oauth2/authorize?state=${state}`);
    const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
    const cookie = res.cookies.get("oshiboard_oauth_state_twitch");
    expect(cookie?.value).toBe(state);
    expect(cookie?.httpOnly).toBe(true);

    const ok = new NextRequest(`https://oshi.example/api/auth/twitch/callback?code=c&state=${state}`, {
      headers: { cookie: `oshiboard_oauth_state_twitch=${state}` },
    });
    expect(verifyState(ok, "twitch")).toBe(true);

    const forged = new NextRequest(`https://oshi.example/api/auth/twitch/callback?code=c&state=${"x".repeat(state.length)}`, {
      headers: { cookie: `oshiboard_oauth_state_twitch=${state}` },
    });
    expect(verifyState(forged, "twitch")).toBe(false);
    const noCookie = new NextRequest(`https://oshi.example/api/auth/twitch/callback?code=c&state=${state}`);
    expect(verifyState(noCookie, "twitch")).toBe(false);
  });

  it("形式の違う state は例外にせず弾く", () => {
    const cookie = "a".repeat(48);
    for (const state of ["", "abc", "a".repeat(49), "あ".repeat(16), "A".repeat(48)]) {
      const req = new NextRequest(`https://oshi.example/api/auth/twitch/callback?state=${encodeURIComponent(state)}`, {
        headers: { cookie: `oshiboard_oauth_state_twitch=${cookie}` },
      });
      expect(verifyState(req, "twitch")).toBe(false);
    }
  });

  it("エラーはコードだけをクエリで返す", () => {
    const req = new NextRequest("https://oshi.example/api/auth/twitch/callback");
    const res = backToChannels(req, "twitch", { ok: false, error: "cancelled" });
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("import_error")).toBe("cancelled");
    expect(url.searchParams.get("import_provider")).toBe("twitch");
    expect(res.cookies.get("oshiboard_oauth_token_twitch")).toBeUndefined();
  });

  it("トークンは取り込み API だけに送られる HttpOnly cookie に入る", () => {
    const req = new NextRequest("https://oshi.example/api/auth/google/callback");
    const res = backToChannels(req, "google", { ok: true, token: "secret-token" });
    expect(res.headers.get("location")).toBe("https://oshi.example/channels?import=google");
    const cookie = res.cookies.get("oshiboard_oauth_token_google");
    expect(cookie).toMatchObject({ value: "secret-token", httpOnly: true, path: "/api/import/google", secure: true });
  });

  it("APP_URL があればリダイレクトURIに使う", () => {
    vi.stubEnv("APP_URL", "https://board.example.com/");
    const req = new NextRequest("http://localhost:3000/api/auth/twitch/start");
    expect(callbackUrl(req, "twitch")).toBe("https://board.example.com/api/auth/twitch/callback");
  });
});
