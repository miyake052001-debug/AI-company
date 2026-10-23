import { describe, expect, it } from "vitest";
import { holodexLiveToStream, orgLabel } from "./holodex";

describe("holodexLiveToStream", () => {
  const base = {
    id: "dQw4w9WgXcQ",
    title: "【APEX】ランクマ",
    type: "stream",
    status: "live",
    start_actual: "2026-10-23T10:00:00Z",
    live_viewers: 12345,
    topic_id: "Apex_Legends",
    channel: { id: "UC1DCedRgGHBdm81E1llLhOQ", name: "Pekora Ch. 兎田ぺこら", org: "Hololive", photo: "https://yt3.example/p.jpg" },
  };

  it("配信中の配信を Stream にする", () => {
    expect(holodexLiveToStream(base)).toMatchObject({
      source: "yt:dQw4w9WgXcQ",
      status: "live",
      channelId: "UC1DCedRgGHBdm81E1llLhOQ",
      viewers: 12345,
      org: "ホロライブ",
      category: "Apex Legends",
    });
  });

  it("予定・プレースホルダー・不正なIDは除く", () => {
    expect(holodexLiveToStream({ ...base, status: "upcoming" })).toBeNull();
    expect(holodexLiveToStream({ ...base, type: "placeholder" })).toBeNull();
    expect(holodexLiveToStream({ ...base, id: "twitch-placeholder-id" })).toBeNull();
  });

  it("事務所名は日本語にし、知らないものはそのまま", () => {
    expect(orgLabel("Nijisanji")).toBe("にじさんじ");
    // Holodex の表記ゆれ
    expect(orgLabel("VSpo")).toBe("ぶいすぽっ！");
    expect(orgLabel("VSPO")).toBe("ぶいすぽっ！");
    expect(orgLabel("Nori Pro")).toBe("のりプロ");
    expect(orgLabel("Neo-Porte")).toBe("ネオポルテ");
    expect(orgLabel("Aogiri Highschool")).toBe("あおぎり高校");
    expect(orgLabel("Some New Org")).toBe("Some New Org");
    expect(orgLabel(undefined)).toBeUndefined();
  });
});
