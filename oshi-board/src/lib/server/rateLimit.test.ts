import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, normalizeIp } from "./rateLimit";

afterEach(() => vi.unstubAllEnvs());

describe("clientIp", () => {
  it("既定では X-Forwarded-For の右端（直前のプロキシが付けた値）を使い、偽装できるヘッダーは見ない", () => {
    vi.stubEnv("VERCEL", "");
    const h = new Headers({
      "x-forwarded-for": "6.6.6.6, 1.2.3.4",
      "x-real-ip": "7.7.7.7",
      "x-vercel-forwarded-for": "8.8.8.8",
    });
    expect(clientIp(h)).toBe("1.2.3.4");
  });

  it("Vercel 上では Vercel が上書きするヘッダーを使う", () => {
    vi.stubEnv("VERCEL", "1");
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "6.6.6.6" }))).toBe("9.9.9.9");
  });

  it("X-Forwarded-For を付けない nginx（Next が nginx のアドレスを入れる）では nginx の X-Real-IP を使う", () => {
    vi.stubEnv("VERCEL", "");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "127.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "::ffff:172.18.0.2" }))).toBe(
      "203.0.113.7",
    );
  });

  it("X-Forwarded-For を上書きするプロキシ（Caddy など）では、偽装された X-Real-IP を使わない", () => {
    vi.stubEnv("VERCEL", "");
    expect(clientIp(new Headers({ "x-real-ip": "6.6.6.6", "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("Vercel の前に Cloudflare を置いた場合は TRUSTED_IP_HEADER が優先される", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("TRUSTED_IP_HEADER", "cf-connecting-ip");
    const a = clientIp(new Headers({ "cf-connecting-ip": "198.51.100.1", "x-vercel-forwarded-for": "172.68.1.1" }));
    const b = clientIp(new Headers({ "cf-connecting-ip": "198.51.100.2", "x-vercel-forwarded-for": "172.68.1.1" }));
    expect([a, b]).toEqual(["198.51.100.1", "198.51.100.2"]);
  });

  it("TRUSTED_IP_HEADER / TRUST_PROXY_HOPS で自前のプロキシ構成に合わせられる", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUSTED_IP_HEADER", "X-Real-IP");
    expect(clientIp(new Headers({ "x-real-ip": "5.5.5.5", "x-forwarded-for": "6.6.6.6" }))).toBe("5.5.5.5");
    vi.stubEnv("TRUSTED_IP_HEADER", "");
    vi.stubEnv("TRUST_PROXY_HOPS", "2");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
});

describe("normalizeIp", () => {
  it.each([
    ["1.2.3.4:5678", "1.2.3.4"],
    ["::ffff:198.51.100.1", "198.51.100.1"],
    ["0:0:0:0:0:ffff:198.51.100.1", "198.51.100.1"],
    ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["[2001:db8:1:2::1]:443", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["2001::5:1:2:3:4", "2001:0:0:5::/64"],
    ["::1", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected);
  });

  it("IPv4 の接続元は別々のキーになる", () => {
    expect(normalizeIp("::ffff:1.2.3.4")).not.toBe(normalizeIp("::ffff:5.6.7.8"));
  });
});
