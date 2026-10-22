import { describe, expect, it, vi } from "vitest";
import { cached, put, takeBudget } from "./cache";

describe("cached", () => {
  it("失敗を errorTtl の間覚えて、同じキーでは関数を呼ばない", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(cached("test:fail:1", { ttl: 1000, errorTtl: 60_000 }, fn)).rejects.toThrow("boom");
    await expect(cached("test:fail:1", { ttl: 1000, errorTtl: 60_000 }, fn)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("staleOnError なら期限切れの値で代替する", async () => {
    put("test:stale:1", "old", -1);
    const value = await cached("test:stale:1", { ttl: 1000, staleOnError: true }, () => Promise.reject(new Error("down")));
    expect(value).toBe("old");
  });

  it("同時の呼び出しは1回にまとめる", async () => {
    const fn = vi.fn(async () => "v");
    const [a, b] = await Promise.all([
      cached("test:dedupe:1", { ttl: 1000 }, fn),
      cached("test:dedupe:1", { ttl: 1000 }, fn),
    ]);
    expect([a, b]).toEqual(["v", "v"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("takeBudget", () => {
  it("時間枠内は上限回数まで", () => {
    const results = Array.from({ length: 4 }, () => takeBudget("test:budget", 3, 60_000));
    expect(results).toEqual([true, true, true, false]);
  });
});
