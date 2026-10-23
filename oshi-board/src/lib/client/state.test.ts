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

describe("talentActions.importMany", () => {
  it("同じチャンネルは二重に追加しない", async () => {
    const { talentActions, talentsStore } = await import("./state");
    talentsStore.set([{ id: "a", name: "A", twitchLogin: "kagasumire" }]);
    const added = talentActions.importMany(
      [
        { platform: "twitch", id: "KagaSumire", name: "花芽すみれ" },
        { platform: "twitch", id: "newstreamer", name: "新しい人" },
        { platform: "youtube", id: "UC1DCedRgGHBdm81E1llLhOQ", name: "Pekora" },
        { platform: "youtube", id: "UC1DCedRgGHBdm81E1llLhOQ", name: "Pekora" },
        { platform: "youtube", id: "bad-id", name: "x" },
      ],
      "取り込み",
    );
    expect(added).toBe(2);
    expect(talentsStore.get().map((t) => [t.id, t.group])).toEqual([
      ["a", undefined],
      ["tw-newstreamer", "取り込み"],
      ["yt-UC1DCedRgGHBdm81E1llLhOQ", "取り込み"],
    ]);
  });
});
