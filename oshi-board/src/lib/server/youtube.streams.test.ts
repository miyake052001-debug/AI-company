import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { takeBudget } from "./cache";
import { getYouTubeStreams } from "./youtube";

/*
 * getYouTubeStreams を RSS と videos.list のモックで動かして、
 * フォローが多いときの問い合わせ回数と、失敗したときの代替表示を確かめる。
 */

const HOUR = 3_600_000;
const pad = (n: number, len: number) => n.toString(36).padStart(len, "0");
const channelId = (test: number, n: number) => `UC${pad(test, 2)}${pad(n, 20)}`;
const videoId = (test: number, ch: number, v: number) => `${pad(test, 2)}${pad(ch, 6)}${pad(v, 3)}`;

type Kind = "live" | "upcoming" | "none";
interface FakeVideo {
  channelId: string;
  kind: Kind;
  start?: string;
}

let videos: Map<string, FakeVideo>;
let feeds: Map<string, string[]>;
let videoCalls: string[][];
let failVideos: boolean;

function feed(ids: string[]) {
  return `<feed>${ids.map((id) => `<entry><yt:videoId>${id}</yt:videoId></entry>`).join("")}</feed>`;
}

beforeEach(() => {
  videos = new Map();
  feeds = new Map();
  videoCalls = [];
  failVideos = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/feeds/videos.xml") {
        const ids = feeds.get(url.searchParams.get("channel_id") ?? "");
        return ids ? new Response(feed(ids)) : new Response("", { status: 404 });
      }
      if (url.pathname.endsWith("/videos")) {
        const ids = (url.searchParams.get("id") ?? "").split(",");
        videoCalls.push(ids);
        if (failVideos) return Response.json({ error: { message: "backend error" } }, { status: 500 });
        return Response.json({
          items: ids
            .filter((id) => videos.has(id))
            .map((id) => {
              const v = videos.get(id)!;
              return {
                id,
                snippet: { channelId: v.channelId, channelTitle: "ch", title: "配信", liveBroadcastContent: v.kind },
                liveStreamingDetails:
                  v.kind === "live"
                    ? { actualStartTime: new Date(Date.now() - 60_000).toISOString() }
                    : v.kind === "upcoming"
                      ? { scheduledStartTime: v.start }
                      : undefined,
              };
            }),
        });
      }
      // channels.list（アイコン）は空でよい
      return Response.json({ items: [] });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** test 番号ごとにチャンネルを作る（キャッシュと時間枠が他のテストと混ざらないように） */
function addChannels(test: number, count: number, perChannel: (ch: number, v: number) => FakeVideo["kind"] = () => "none") {
  const ids: string[] = [];
  for (let ch = 0; ch < count; ch++) {
    const cid = channelId(test, ch);
    const vids: string[] = [];
    for (let v = 0; v < 10; v++) {
      const vid = videoId(test, ch, v);
      const kind = perChannel(ch, v);
      videos.set(vid, {
        channelId: cid,
        kind,
        start: kind === "upcoming" ? new Date(Date.now() + 2 * 24 * HOUR).toISOString() : undefined,
      });
      vids.push(vid);
    }
    feeds.set(cid, vids);
    ids.push(cid);
  }
  return ids;
}

describe("getYouTubeStreams（問い合わせ回数）", () => {
  it("終了済み・通常の動画は期限が切れても問い合わせ直さず、予定だけ確かめ直す", async () => {
    vi.setSystemTime(Date.parse("2026-10-01T00:00:00Z"));
    const channels = addChannels(1, 1, (_, v) => (v === 0 ? "upcoming" : "none"));
    const first = await getYouTubeStreams(channels);
    expect(first.streams.map((s) => s.status)).toEqual(["upcoming"]);
    expect(videoCalls).toHaveLength(1);

    vi.setSystemTime(Date.parse("2026-10-06T00:00:00Z"));
    await getYouTubeStreams(channels);
    expect(videoCalls).toHaveLength(2);
    expect(videoCalls[1]).toEqual([videoId(1, 0, 0)]);
  });

  it("問い合わせに失敗しても、本来の期限から15分以内の予定は前回の値で出す", async () => {
    vi.setSystemTime(Date.parse("2026-10-02T00:00:00Z"));
    const channels = addChannels(2, 3, (_, v) => (v === 0 ? "upcoming" : "none"));
    expect((await getYouTubeStreams(channels)).streams).toHaveLength(3);

    // 2日後の予定は30分キャッシュ。31分後に失敗しても消さない
    vi.setSystemTime(Date.parse("2026-10-02T00:31:00Z"));
    failVideos = true;
    const result = await getYouTubeStreams(channels);
    expect(result.streams).toHaveLength(3);
    expect(result.errors.length).toBeGreaterThan(0);

    // 期限（30分）から15分を過ぎたら、古い予定は出さない
    vi.setSystemTime(Date.parse("2026-10-02T00:46:00Z"));
    expect((await getYouTubeStreams(channels)).streams).toHaveLength(0);
  });

  it("1000チャンネルを初めて読み込んでも、表示中のライブの更新と、知っているチャンネルの新しい配信は止まらない", async () => {
    vi.setSystemTime(Date.parse("2026-10-03T00:00:00Z"));
    const live = addChannels(3, 2, (ch, v) => (ch === 0 && v === 0 ? "live" : "none"));
    expect((await getYouTubeStreams(live)).streams.map((s) => s.status)).toEqual(["live"]);

    // 1000チャンネル × 10本 = 200回分。初めて見るチャンネルの枠（1時間200回、最初の1回を含む）はここで使い切る
    const heavy = addChannels(4, 1000);
    for (let i = 0; i < 10; i++) await getYouTubeStreams(heavy.slice(i * 100, (i + 1) * 100));
    expect(videoCalls.length).toBe(200);

    // 別の人の初回分は後回しになるが、期限の切れたライブは問い合わせ直して出し続ける
    vi.setSystemTime(Date.parse("2026-10-03T00:05:00Z"));
    const before = videoCalls.length;
    const others = addChannels(5, 20);
    const result = await getYouTubeStreams([...live, ...others]);
    expect(result.streams.map((s) => s.status)).toEqual(["live"]);
    expect(videoCalls.slice(before).flat()).toContain(videoId(3, 0, 0));
    expect(result.errors.map((e) => e.message)).toContain("フォローが多いため、一部のチャンネルの配信情報はあとで取得します");

    // 知っているチャンネルで新しく始まった配信は、初めて見るチャンネルの枠とは別に取る
    vi.setSystemTime(Date.parse("2026-10-03T00:10:00Z"));
    const fresh = "zzzzzzzzz01";
    videos.set(fresh, { channelId: live[1], kind: "live" });
    feeds.set(live[1], [fresh, ...feeds.get(live[1])!.slice(0, 9)]);
    const withNew = await getYouTubeStreams(live);
    expect(withNew.streams.map((s) => s.channelId).sort()).toEqual([...live].sort());
    expect(withNew.errors).toEqual([]);
  });

  it("ほかの人のリクエストの空き枠で、期限の切れたライブもまとめて更新する", async () => {
    vi.setSystemTime(Date.parse("2026-10-04T00:00:00Z"));
    const a = addChannels(6, 1, (_, v) => (v === 0 ? "live" : "none"));
    const b = addChannels(7, 1, (_, v) => (v === 0 ? "live" : "none"));
    await getYouTubeStreams(a);
    await getYouTubeStreams(b);

    vi.setSystemTime(Date.parse("2026-10-04T00:02:00Z"));
    const before = videoCalls.length;
    await getYouTubeStreams(a);
    // a の問い合わせに b のライブも相乗りしたので、b の更新では問い合わせない
    expect(videoCalls.slice(before).flat()).toEqual(expect.arrayContaining([videoId(6, 0, 0), videoId(7, 0, 0)]));
    const mid = videoCalls.length;
    expect((await getYouTubeStreams(b)).streams.map((s) => s.status)).toEqual(["live"]);
    expect(videoCalls.length).toBe(mid);
  });

  it("予定がたくさんあっても、その後ろの期限切れのライブを相乗りで更新する", async () => {
    vi.setSystemTime(Date.parse("2026-10-07T00:00:00Z"));
    // 予定（30分キャッシュ）が600件ある状態で、ライブ（90秒）はその後ろに並ぶ
    const planned = addChannels(10, 600, (_, v) => (v === 0 ? "upcoming" : "none"));
    for (let i = 0; i < 6; i++) await getYouTubeStreams(planned.slice(i * 100, (i + 1) * 100));
    vi.setSystemTime(Date.parse("2026-10-07T00:01:00Z"));
    const a = addChannels(11, 1, (_, v) => (v === 0 ? "live" : "none"));
    const b = addChannels(12, 1, (_, v) => (v === 0 ? "live" : "none"));
    await getYouTubeStreams(a);
    await getYouTubeStreams(b);

    vi.setSystemTime(Date.parse("2026-10-07T00:03:00Z"));
    const before = videoCalls.length;
    await getYouTubeStreams(a);
    expect(videoCalls.slice(before).flat()).toEqual(expect.arrayContaining([videoId(11, 0, 0), videoId(12, 0, 0)]));
  });

  it("アプリ側の1時間の上限に達したら、枠が戻るまで前回のライブを出し続ける", async () => {
    vi.setSystemTime(Date.parse("2026-10-05T00:00:00Z"));
    const channels = addChannels(8, 1, (_, v) => (v === 0 ? "live" : "none"));
    await getYouTubeStreams(channels);
    while (takeBudget("yt:videos", 300, HOUR));

    vi.setSystemTime(Date.parse("2026-10-05T00:40:00Z"));
    const result = await getYouTubeStreams(channels);
    expect(result.streams.map((s) => s.status)).toEqual(["live"]);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
