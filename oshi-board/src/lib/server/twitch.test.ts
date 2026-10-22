import { describe, expect, it } from "vitest";
import { nextSegment } from "./twitch";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const seg = (id: string, start: string, canceled?: string) => ({ id, start_time: start, title: id, canceled_until: canceled ?? null });

describe("nextSegment", () => {
  it("キャンセル済みと過去の枠を飛ばす", () => {
    const s = {
      segments: [seg("past", "2026-10-22T10:00:00Z"), seg("canceled", "2026-10-22T20:00:00Z", "2026-10-22T22:00:00Z"), seg("next", "2026-10-23T20:00:00Z")],
      vacation: null,
    };
    expect(nextSegment(s, NOW)?.id).toBe("next");
  });

  it("休止期間中の枠は出さない", () => {
    const s = {
      segments: [seg("during", "2026-10-23T20:00:00Z"), seg("after", "2026-10-26T20:00:00Z")],
      vacation: { start_time: "2026-10-23T00:00:00Z", end_time: "2026-10-25T00:00:00Z" },
    };
    expect(nextSegment(s, NOW)?.id).toBe("after");
  });

  it("7日より先は出さない", () => {
    expect(nextSegment({ segments: [seg("far", "2026-11-10T00:00:00Z")], vacation: null }, NOW)).toBeUndefined();
  });
});
