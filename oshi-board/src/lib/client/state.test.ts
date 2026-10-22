import { describe, expect, it } from "vitest";
import { sanitizeTalents } from "./state";

describe("sanitizeTalents", () => {
  it("配列でなければ null", () => {
    expect(sanitizeTalents({})).toBeNull();
    expect(sanitizeTalents("x")).toBeNull();
  });

  it("壊れた値を捨て、型の違うフィールドは落とす", () => {
    const result = sanitizeTalents([
      null,
      { id: "a" },
      { id: "b", name: "ok", twitchLogin: 123, youtubeChannelId: "bad", favorite: "yes", group: ["x"] },
      { id: "c", name: "ok2", twitchLogin: "KagaSumire", youtubeChannelId: "UC1DCedRgGHBdm81E1llLhOQ", favorite: true },
    ]);
    expect(result).toEqual([
      { id: "b", name: "ok" },
      {
        id: "c",
        name: "ok2",
        twitchLogin: "kagasumire",
        youtubeChannelId: "UC1DCedRgGHBdm81E1llLhOQ",
        favorite: true,
      },
    ]);
  });
});
