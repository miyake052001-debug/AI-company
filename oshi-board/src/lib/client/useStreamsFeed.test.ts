import { describe, expect, it } from "vitest";
import type { Talent } from "@/lib/types";
import { MAX_POLLED_CHANNELS, STREAMS_CHUNK, polledChannels, streamsUrls } from "./useStreamsFeed";

const many = (n: number, favoriteFrom = Infinity): Talent[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    name: `T${i}`,
    twitchLogin: `user${i}`,
    favorite: i >= favoriteFrom,
  }));

describe("polledChannels", () => {
  it("上限を超えたらお気に入りを優先して残し、外れた数を返す", () => {
    const talents = many(MAX_POLLED_CHANNELS + 50, MAX_POLLED_CHANNELS + 40);
    const { tw, skipped } = polledChannels(talents);
    expect(tw).toHaveLength(MAX_POLLED_CHANNELS);
    expect(skipped).toBe(50);
    // 末尾のお気に入り10人は必ず含まれる
    for (let i = MAX_POLLED_CHANNELS + 40; i < MAX_POLLED_CHANNELS + 50; i++) expect(tw).toContain(`user${i}`);
  });

  it("同じチャンネルは一度だけ数える", () => {
    const { tw, yt, skipped } = polledChannels([
      { id: "a", name: "A", twitchLogin: "Same" },
      { id: "b", name: "B", twitchLogin: "same" },
    ]);
    expect(tw).toEqual(["same"]);
    expect(yt).toEqual([]);
    expect(skipped).toBe(0);
  });
});

describe("streamsUrls", () => {
  it("100件ずつに分ける", () => {
    const urls = streamsUrls(many(250));
    expect(urls).toHaveLength(Math.ceil(250 / STREAMS_CHUNK));
  });
});
