import { describe, expect, it } from "vitest";
import { parseCsv, parseSubscriptionsCsv } from "./takeout";

describe("parseCsv", () => {
  it("クォート・カンマ・改行・BOM を扱える", () => {
    expect(parseCsv('﻿a,"b,c","d ""e"""\r\n1,"2\n3",4')).toEqual([
      ["a", "b,c", 'd "e"'],
      ["1", "2\n3", "4"],
    ]);
  });
});

describe("parseSubscriptionsCsv", () => {
  it("英語の Takeout 形式", () => {
    const csv = [
      "Channel Id,Channel Url,Channel Title",
      "UC1DCedRgGHBdm81E1llLhOQ,http://www.youtube.com/channel/UC1DCedRgGHBdm81E1llLhOQ,Pekora Ch. 兎田ぺこら",
      'UCCzUftO8KOVkV4wQG1vkUvg,http://www.youtube.com/channel/UCCzUftO8KOVkV4wQG1vkUvg,"Marine Ch, 宝鐘マリン"',
      "",
    ].join("\n");
    expect(parseSubscriptionsCsv(csv)).toEqual([
      { platform: "youtube", id: "UC1DCedRgGHBdm81E1llLhOQ", name: "Pekora Ch. 兎田ぺこら" },
      { platform: "youtube", id: "UCCzUftO8KOVkV4wQG1vkUvg", name: "Marine Ch, 宝鐘マリン" },
    ]);
  });

  it("日本語の見出し・重複・ID のない行", () => {
    const csv = [
      "チャンネル ID,チャンネルの URL,チャンネルのタイトル",
      "UC5CwaMl1eIgY8h02uZw7u8A,https://www.youtube.com/channel/UC5CwaMl1eIgY8h02uZw7u8A,Suisei Channel",
      "UC5CwaMl1eIgY8h02uZw7u8A,https://www.youtube.com/channel/UC5CwaMl1eIgY8h02uZw7u8A,Suisei Channel",
      "壊れた行,,",
    ].join("\r\n");
    expect(parseSubscriptionsCsv(csv)).toEqual([
      { platform: "youtube", id: "UC5CwaMl1eIgY8h02uZw7u8A", name: "Suisei Channel" },
    ]);
  });
});
