import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTwitchFollows, fetchYouTubeSubscriptions } from "./imports";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const twitchValidate = (info: object) => Response.json({ client_id: "cid", user_id: "42", scopes: ["user:read:follows"], ...info });

describe("fetchTwitchFollows", () => {
  it("ページをたどってフォロー一覧を集める", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "secret");
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/oauth2/validate")) return twitchValidate({});
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

  it.each([
    ["別のアプリのトークン", { client_id: "other-app" }],
    ["フォローを読む権限がない", { scopes: [] }],
    ["ユーザーのトークンではない", { user_id: undefined }],
  ])("%s は使わない", async (_, info) => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).endsWith("/oauth2/validate") ? twitchValidate(info) : Response.json({ data: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTwitchFollows("token")).rejects.toThrow("このアプリのログインではありません");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/helix/"))).toBe(false);
  });
});

const YOUTUBE_READONLY = "https://www.googleapis.com/auth/youtube.readonly";
const googleTokenInfo = (info: object) => Response.json({ aud: "gid", azp: "gid", scope: `openid ${YOUTUBE_READONLY}`, ...info });

describe("fetchYouTubeSubscriptions", () => {
  it("登録チャンネルをページをたどって集める", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "gid");
    let page = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        if (String(input).includes("/tokeninfo")) return googleTokenInfo({});
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

  it.each([
    ["別のアプリのトークン", { aud: "other", azp: "other" }],
    ["YouTube を読む権限がない", { scope: "openid email" }],
  ])("%s は使わない（全体の上限も減らさない）", async (_, info) => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "gid");
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).includes("/tokeninfo") ? googleTokenInfo(info) : Response.json({ items: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchYouTubeSubscriptions("token")).rejects.toThrow("このアプリのログインではありません");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/youtube/v3/"))).toBe(false);
  });

  it("401 はログインのやり直しを促す", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "gid");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(fetchYouTubeSubscriptions("expired")).rejects.toThrow("有効期限");
  });
});
