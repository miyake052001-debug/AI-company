import { describe, expect, it } from "vitest";
import { parseIsoDuration } from "../format";
import { clipSearchTerm, toStream, toVideoInfo, videoTtl } from "./youtube";

const NOW = Date.parse("2026-10-22T12:00:00Z");

function item(overrides: {
  live?: "live" | "upcoming" | "none";
  title?: string;
  details?: Record<string, string>;
}) {
  return {
    id: "dQw4w9WgXcQ",
    snippet: {
      channelId: "UC1DCedRgGHBdm81E1llLhOQ",
      channelTitle: "Pekora Ch.",
      title: overrides.title ?? "【雑談】テスト",
      publishedAt: "2026-10-20T00:00:00Z",
      liveBroadcastContent: overrides.live ?? "none",
    },
    liveStreamingDetails: overrides.details,
  };
}

describe("toVideoInfo / toStream", () => {
  it("配信中", () => {
    const info = toVideoInfo(
      item({ live: "live", details: { actualStartTime: "2026-10-22T11:00:00Z", concurrentViewers: "12345" } }),
    )!;
    const s = toStream(info, NOW)!;
    expect(s.status).toBe("live");
    expect(s.viewers).toBe(12345);
    expect(s.source).toBe("yt:dQw4w9WgXcQ");
  });

  it("予定（2週間以内）", () => {
    const info = toVideoInfo(item({ live: "upcoming", details: { scheduledStartTime: "2026-10-22T20:00:00Z" } }))!;
    expect(toStream(info, NOW)?.status).toBe("upcoming");
  });

  it("ずっと先の予定枠・フリーチャットは除外", () => {
    const far = toVideoInfo(item({ live: "upcoming", details: { scheduledStartTime: "2027-03-01T00:00:00Z" } }))!;
    expect(toStream(far, NOW)).toBeNull();
    const freeChat = toVideoInfo(
      item({ live: "upcoming", title: "【フリーチャット】待機所", details: { scheduledStartTime: "2026-10-23T00:00:00Z" } }),
    )!;
    expect(toStream(freeChat, NOW)).toBeNull();
  });

  it("48時間以内に終わった配信はアーカイブ、普通の動画は対象外", () => {
    const ended = toVideoInfo(
      item({ details: { actualStartTime: "2026-10-21T10:00:00Z", actualEndTime: "2026-10-21T12:00:00Z" } }),
    )!;
    expect(toStream(ended, NOW)?.status).toBe("ended");
    const old = toVideoInfo(
      item({ details: { actualStartTime: "2026-10-10T10:00:00Z", actualEndTime: "2026-10-10T12:00:00Z" } }),
    )!;
    expect(toStream(old, NOW)).toBeNull();
    expect(toStream(toVideoInfo(item({}))!, NOW)).toBeNull();
  });
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT45S", 45],
    ["PT3M2S", 182],
    ["PT1H0M5S", 3605],
    ["P1DT1H", 90000],
  ])("%s → %d", (iso, sec) => {
    expect(parseIsoDuration(iso)).toBe(sec);
  });
});

describe("clipSearchTerm", () => {
  it("チャンネル名に含まれる名前ならそのまま使う", () => {
    expect(clipSearchTerm("兎田ぺこら", "Pekora Ch. 兎田ぺこら")).toBe("兎田ぺこら");
    expect(clipSearchTerm(" 兎田 ぺこら ", "Pekora Ch. 兎田ぺこら")).toBe("兎田 ぺこら");
  });

  it("含まれない名前（任意の文字列）は使わず、チャンネル名から作る", () => {
    expect(clipSearchTerm("なんでも検索", "Pekora Ch. 兎田ぺこら")).toBe("Pekora 兎田ぺこら");
    expect(clipSearchTerm("x", "Suisei Channel")).toBe("Suisei");
    expect(clipSearchTerm("", "葛葉 / Kuzuha Channel")).toBe("葛葉 Kuzuha");
    expect(clipSearchTerm("Ch", "Pekora Ch. 兎田ぺこら")).toBe("Pekora 兎田ぺこら");
    expect(clipSearchTerm("ra", "Pekora Ch. 兎田ぺこら")).toBe("Pekora 兎田ぺこら");
    expect(clipSearchTerm("兎田ぺこら", "兎田ぺこらちゃんねる")).toBe("兎田ぺこら");
  });

  it("プリセットのチャンネルはプリセットの名前を使う", () => {
    expect(clipSearchTerm("なんでも", "Pekora Ch. 兎田ぺこら", "兎田ぺこら")).toBe("兎田ぺこら");
  });
});

describe("videoTtl", () => {
  const base = { id: "dQw4w9WgXcQ", channelId: "UC1DCedRgGHBdm81E1llLhOQ", channelTitle: "x", title: "配信" };
  it("配信中は短く、終了済みは長く", () => {
    expect(videoTtl({ ...base, kind: "live" }, NOW)).toBe(90_000);
    expect(videoTtl({ ...base, kind: "ended" }, NOW, 0)).toBe(72 * 3_600_000);
    // まとめて取り込んだ分が同時に切れないよう、ばらつかせる
    expect(videoTtl({ ...base, kind: "video" }, NOW, 1)).toBe(108 * 3_600_000);
  });
  it("予定は開始が近いほど短く、フリーチャット枠は長く", () => {
    const soon = videoTtl({ ...base, kind: "upcoming", startAt: new Date(NOW + 5 * 60_000).toISOString() }, NOW);
    const later = videoTtl({ ...base, kind: "upcoming", startAt: new Date(NOW + 2 * 86_400_000).toISOString() }, NOW);
    expect(soon).toBe(90_000);
    expect(later).toBe(30 * 60_000);
    expect(videoTtl({ ...base, kind: "upcoming", title: "【フリーチャット】", startAt: undefined }, NOW)).toBe(6 * 3_600_000);
  });
});
