import { describe, expect, it } from "vitest";
import { focusLayout, gridLayout, type Rect } from "./layout";

function inside(r: Rect, w: number, h: number) {
  const eps = 0.01;
  return r.x >= -eps && r.y >= -eps && r.x + r.w <= w + eps && r.y + r.h <= h + eps;
}

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
}

describe("gridLayout", () => {
  it("横長の画面で2窓なら横並び", () => {
    const [a, b] = gridLayout(2, 1920, 1000);
    expect(a.y).toBeCloseTo(b.y);
    expect(a.x).toBeLessThan(b.x);
  });

  it("縦長の画面で2窓なら縦並び", () => {
    const [a, b] = gridLayout(2, 400, 900);
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeLessThan(b.y);
  });

  it("16:9 を保ち、はみ出さず、重ならない", () => {
    for (let n = 1; n <= 9; n++) {
      for (const [w, h] of [
        [1600, 800],
        [1280, 1024],
        [390, 600],
      ]) {
        const rects = gridLayout(n, w, h);
        expect(rects).toHaveLength(n);
        for (const r of rects) {
          expect(r.w / r.h).toBeCloseTo(16 / 9);
          expect(inside(r, w, h)).toBe(true);
        }
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it("サイズ0（計測前）なら空", () => {
    expect(gridLayout(3, 0, 0)).toEqual([]);
    expect(gridLayout(3, -8, -8)).toEqual([]);
  });
});

describe("focusLayout", () => {
  it("サイズ0（計測前）でも落ちない", () => {
    expect(focusLayout(3, 0, 0)).toEqual([]);
    expect(focusLayout(3, 500, 0)).toEqual([]);
  });

  it("先頭が一番大きく、全部が画面内に収まる", () => {
    for (let n = 2; n <= 9; n++) {
      for (const [w, h] of [
        [1800, 850],
        [1000, 1000],
        [390, 700],
      ]) {
        const rects = focusLayout(n, w, h);
        expect(rects).toHaveLength(n);
        for (const r of rects) expect(inside(r, w, h)).toBe(true);
        for (const r of rects.slice(1)) expect(r.w).toBeLessThan(rects[0].w);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(overlaps(rects[i], rects[j])).toBe(false);
      }
    }
  });
});
