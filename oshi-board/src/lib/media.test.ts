import { describe, expect, it } from "vitest";
import { chatUrl, embedUrl, parseMediaInput, parseSourceKey, sourceKey } from "./media";

describe("parseMediaInput", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "yt:dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=120s", "yt:dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "yt:dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ?feature=share", "yt:dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "yt:dQw4w9WgXcQ"],
    ["youtube.com/embed/dQw4w9WgXcQ", "yt:dQw4w9WgXcQ"],
    ["https://www.twitch.tv/KagaSumire", "tw:kagasumire"],
    ["twitch.tv/kagasumire/", "tw:kagasumire"],
    ["https://www.twitch.tv/videos/2012345678", "twv:2012345678"],
    ["https://www.twitch.tv/kagasumire/clip/FunnyClipSlug-abc123", "twc:FunnyClipSlug-abc123"],
    ["https://clips.twitch.tv/FunnyClipSlug-abc123", "twc:FunnyClipSlug-abc123"],
    ["https://player.twitch.tv/?channel=foo&parent=example.com", "tw:foo"],
    ["yt:dQw4w9WgXcQ", "yt:dQw4w9WgXcQ"],
    ["https://m.twitch.tv/clip/FunnyClipSlug-abc123", "twc:FunnyClipSlug-abc123"],
    ["https://www.twitch.tv/KagaSumire/clip/FunnyClipSlug-abc123?filter=clips", "twc:FunnyClipSlug-abc123"],
    ["https://www.twitch.tv/embed/KagaSumire/chat?parent=x", "tw:kagasumire"],
    ["https://www.twitch.tv/VIDEOS/2012345678", "twv:2012345678"],
    ["https://www.twitch.tv/kagasumire/v/2012345678", "twv:2012345678"],
  ])("%s → %s", (input, expected) => {
    const s = parseMediaInput(input);
    expect(s && sourceKey(s)).toBe(expected);
  });

  it.each([
    "",
    "こんにちは",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/@usadapekora",
    "https://www.youtube.com/watch?v=short",
    "https://www.twitch.tv/directory",
    "https://www.twitch.tv/",
    "https://www.twitch.tv/clip",
    "https://www.youtube.com/embed/live_stream?channel=UC1DCedRgGHBdm81E1llLhOQ",
  ])("認識しない: %s", (input) => {
    expect(parseMediaInput(input)).toBeNull();
  });
});

describe("parseSourceKey", () => {
  it("不正な種類やIDは null", () => {
    expect(parseSourceKey("xx:abc")).toBeNull();
    expect(parseSourceKey("yt:bad")).toBeNull();
    expect(parseSourceKey("tw:has space")).toBeNull();
  });
});

describe("embedUrl / chatUrl", () => {
  it("Twitch には parent を付ける", () => {
    const url = embedUrl({ kind: "tw", id: "foo" }, { host: "oshi.example.com", muted: true })!;
    expect(url).toContain("parent=oshi.example.com");
    expect(url).toContain("muted=true");
  });

  it("YouTube のミュート指定", () => {
    expect(embedUrl({ kind: "yt", id: "dQw4w9WgXcQ" }, { host: "localhost", muted: false })).toContain("mute=0");
  });

  it("チャットは YouTube と Twitch チャンネルのみ", () => {
    expect(chatUrl({ kind: "yt", id: "dQw4w9WgXcQ" }, "localhost")).toContain("embed_domain=localhost");
    expect(chatUrl({ kind: "tw", id: "foo" }, "localhost")).toContain("/embed/foo/chat?parent=localhost");
    expect(chatUrl({ kind: "twc", id: "slug" }, "localhost")).toBeNull();
  });
});
