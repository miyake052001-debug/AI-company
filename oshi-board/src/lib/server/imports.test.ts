import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTwitchFollows, fetchYouTubeSubscriptions } from "./imports";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchTwitchFollows", () => {
  it("ページをたどってフォロー一覧を集める", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "secret");
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/helix/users")) return Response.json({ data: [{ id: "42" }] });
      if (url.includes("/channels/followed") && !url.includes("after=")) {
        return Response.json({
          data: [{ broadcaster_login: "KagaSumire", broadcaster_name: "花芽すみれ" }],
          pagination: { cursor: "next" },
        });
      }
      if (url.includes("/channels/followed")) {
        return Response.json({ data: [{ broadcaster_login: "other", broadcaster_name: "Other" }], pagination: {} });
      }
      // アイコン取得（アプリのトークン）は失敗しても取り込みは続く
      return new Response("", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchTwitchFollows("user-token");
    expect(result.candidates.map((c) => [c.id, c.name])).toEqual([
      ["kagasumire", "花芽すみれ"],
      ["other", "Other"],
    ]);
    expect(result.truncated).toBe(false);
    const followedCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/channels/followed"));
    expect(String(followedCall?.[0])).toContain("user_id=42");
  });
});

describe("fetchYouTubeSubscriptions", () => {
  it("登録チャンネルをページをたどって集める", async () => {
    let page = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        page++;
        return Response.json(
          page === 1
            ? {
                items: [{ snippet: { title: "A", resourceId: { channelId: "UC1DCedRgGHBdm81E1llLhOQ" } } }],
                nextPageToken: "p2",
              }
            : { items: [{ snippet: { title: "B", resourceId: { channelId: "UCCzUftO8KOVkV4wQG1vkUvg" } } }] },
        );
      }),
    );
    const result = await fetchYouTubeSubscriptions("token");
    expect(result.candidates.map((c) => c.id)).toEqual(["UC1DCedRgGHBdm81E1llLhOQ", "UCCzUftO8KOVkV4wQG1vkUvg"]);
  });

  it("401 はログインのやり直しを促す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(fetchYouTubeSubscriptions("expired")).rejects.toThrow("有効期限");
  });
});
