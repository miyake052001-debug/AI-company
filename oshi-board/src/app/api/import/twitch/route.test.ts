import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const request = (ip: string, token?: string) =>
  new NextRequest("https://oshi.example/api/import/twitch", {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...(token ? { cookie: `oshiboard_oauth_token_twitch=${token}` } : {}) },
  });

describe("POST /api/import/twitch", () => {
  it("トークンがなければ 401", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await POST(request("203.0.113.1"));
    expect(res.status).toBe(401);
  });

  it("回数制限にかかってもトークンを失効させて cookie を消す", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/oauth2/validate") ? new Response("", { status: 401 }) : new Response(""),
    );
    vi.stubGlobal("fetch", fetchMock);
    const revokes = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/oauth2/revoke")).length;

    let last: Response | undefined;
    for (let i = 0; i < 11; i++) last = await POST(request("203.0.113.2", `t${i}`));
    expect(last?.status).toBe(429);
    // 制限内の10回も、制限にかかった1回も、すべて失効させる
    expect(revokes()).toBe(11);
    const revokeBody = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/oauth2/revoke")).at(-1)?.[1]?.body;
    expect(String(revokeBody)).toContain("token=t10");
    expect(last?.headers.get("set-cookie")).toMatch(/oshiboard_oauth_token_twitch=;.*Max-Age=0/i);
  });
});
