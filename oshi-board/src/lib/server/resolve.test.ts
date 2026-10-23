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

describe("searchYouTubeClips", () => {
  it("RSS が一時的に 404 でも、channels.list で確認できれば「見つかりません」にしない", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const id = "UCrsstemporary404xxxxxxx";
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/feeds/videos.xml")) return new Response("", { status: 404 });
      if (url.includes("/youtube/v3/channels")) {
        return Response.json({ items: [{ id, snippet: { title: "Test Ch. テスト" } }] });
      }
      if (url.includes("/youtube/v3/search")) return Response.json({ items: [] });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { searchYouTubeClips } = await import("./youtube");
    await expect(searchYouTubeClips({ name: "テスト", youtubeChannelId: id }, "7d")).resolves.toEqual([]);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/youtube/v3/channels"))).toBe(true);
  });
});
