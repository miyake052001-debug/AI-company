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

describe("talentActions.addMany", () => {
  it("同じIDや、同じチャンネルをフォロー済みの人は飛ばして、追加した数を返す", async () => {
    const { talentActions, talentsStore } = await import("./state");
    talentsStore.set([{ id: "a", name: "A", twitchLogin: "kagasumire", youtubeChannelId: "UC1DCedRgGHBdm81E1llLhOQ" }]);
    const added = talentActions.addMany([
      { id: "a", name: "同じID" },
      { id: "b", name: "同じTwitch", twitchLogin: "KagaSumire" },
      { id: "c", name: "同じYouTube", youtubeChannelId: "UC1DCedRgGHBdm81E1llLhOQ" },
      { id: "d", name: "新しい人", twitchLogin: "newstreamer" },
      { id: "e", name: "dの重複", twitchLogin: "newstreamer" },
    ]);
    expect(added).toBe(1);
    expect(talentsStore.get().map((t) => t.id)).toEqual(["a", "d"]);
  });

  it("片方のチャンネルだけフォロー済みなら、足りないチャンネルをその人に足す", async () => {
    const { talentActions, talentsStore } = await import("./state");
    // Twitch のフォロー取り込みで入った人
    talentsStore.set([{ id: "tw-beni_yakumo", name: "八雲べに", twitchLogin: "beni_yakumo", favorite: true }]);
    const added = talentActions.addMany([
      { id: "vspo-beni", name: "八雲べに", group: "ぶいすぽっ！", youtubeChannelId: "UCjXBuHmWkieBApgBhDuJMMQ", twitchLogin: "beni_yakumo" },
    ]);
    expect(added).toBe(1);
    expect(talentsStore.get()).toEqual([
      { id: "tw-beni_yakumo", name: "八雲べに", twitchLogin: "beni_yakumo", favorite: true, youtubeChannelId: "UCjXBuHmWkieBApgBhDuJMMQ", avatarUrl: undefined },
    ]);
    // もう一度追加しても増えない
    expect(talentActions.addMany([{ id: "vspo-beni", name: "八雲べに", youtubeChannelId: "UCjXBuHmWkieBApgBhDuJMMQ", twitchLogin: "beni_yakumo" }])).toBe(0);
  });

  it("同じIDの人がいれば、チャンネルを直したり外したりしていても触らない", async () => {
    const { talentActions, talentsStore } = await import("./state");
    talentsStore.set([
      { id: "vspo-sumire", name: "花芽すみれ", twitchLogin: "kagasumire_new" },
      { id: "vspo-hinano", name: "橘ひなの", youtubeChannelId: "UCvUc0m317LWTTPZoBQV479A" },
    ]);
    const added = talentActions.addMany([
      { id: "vspo-sumire", name: "花芽すみれ", youtubeChannelId: "UCyLGcqYs7RsBb3L0SJfzGYA", twitchLogin: "kagasumire" },
      { id: "vspo-hinano", name: "橘ひなの", youtubeChannelId: "UCvUc0m317LWTTPZoBQV479A", twitchLogin: "hinanotachiba7" },
    ]);
    expect(added).toBe(0);
    expect(talentsStore.get()).toEqual([
      { id: "vspo-sumire", name: "花芽すみれ", twitchLogin: "kagasumire_new" },
      { id: "vspo-hinano", name: "橘ひなの", youtubeChannelId: "UCvUc0m317LWTTPZoBQV479A" },
    ]);
  });

  it("足す先の人がその種類のチャンネルを別に持っていれば、新しいチャンネルだけの人として追加する", async () => {
    const { talentActions, talentsStore } = await import("./state");
    talentsStore.set([{ id: "x", name: "X", twitchLogin: "shared", youtubeChannelId: "UCaaaaaaaaaaaaaaaaaaaaaa" }]);
    const added = talentActions.addMany([{ id: "y", name: "Y", twitchLogin: "shared", youtubeChannelId: "UCbbbbbbbbbbbbbbbbbbbbbb" }]);
    expect(added).toBe(1);
    expect(talentsStore.get().map((t) => [t.id, t.youtubeChannelId, t.twitchLogin])).toEqual([
      ["x", "UCaaaaaaaaaaaaaaaaaaaaaa", "shared"],
      ["y", "UCbbbbbbbbbbbbbbbbbbbbbb", undefined],
    ]);
  });
});
