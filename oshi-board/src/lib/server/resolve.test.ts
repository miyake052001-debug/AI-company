import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveYouTubeChannel } from "./youtube";

const page = (id: string, title: string) =>
  new Response(`<link rel="canonical" href="https://www.youtube.com/channel/${id}"><meta property="og:title" content="${title}">`, {
    status: 200,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolveYouTubeChannel（APIキーなし＝ページ読み取り）", () => {
  it("チャンネルIDは大文字小文字を区別してキャッシュする（別の大文字小文字で結果を汚せない）", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    const real = "UCabcdefghijklmnopqrstuv";
    const flipped = "UCABCDEFGHIJKLMNOPQRSTUV";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (String(url).includes(real) ? page(real, "本物") : new Response("", { status: 404 }))),
    );
    expect(await resolveYouTubeChannel(flipped)).toBeNull();
    expect(await resolveYouTubeChannel(real)).toEqual({ channelId: real, name: "本物", avatarUrl: undefined });
  });

  it("一時的な失敗（503）はハンドルなら例外、IDならIDだけ返す", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(resolveYouTubeChannel("@some_temporary_failure")).rejects.toThrow("503");
    expect(await resolveYouTubeChannel("UCtemporaryfailure000000")).toEqual({ channelId: "UCtemporaryfailure000000" });
  });
});
