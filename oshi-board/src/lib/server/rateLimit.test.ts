import { describe, expect, it } from "vitest";
import { clientIp, normalizeIp } from "./rateLimit";

describe("clientIp", () => {
  it("プロキシが設定するヘッダーを X-Forwarded-For より優先する", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4", "x-real-ip": "1.2.3.4" });
    expect(clientIp(h)).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "9.9.9.9", "x-forwarded-for": "6.6.6.6" }))).toBe("9.9.9.9");
  });

  it("X-Forwarded-For しかなければ右端（直前のプロキシが付けた値）", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
  });
});

describe("normalizeIp", () => {
  it("ポートを外し、IPv6 は /64 にまとめる", () => {
    expect(normalizeIp("1.2.3.4:5678")).toBe("1.2.3.4");
    expect(normalizeIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("[2001:db8:1:2::1]:443")).toBe("2001:db8:1:2::/64");
  });
});
