export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayoutMode = "grid" | "focus";

const RATIO = 16 / 9;

/** 幅 w × 高さ h の箱に収まる最大の 16:9 サイズ */
function fit(w: number, h: number): { w: number; h: number } {
  const fw = Math.max(0, Math.min(w, h * RATIO));
  return { w: fw, h: fw / RATIO };
}

/**
 * n 個のプレイヤーを 16:9 を保ったまま最大サイズで並べる。
 * 列数を全通り試して、1枚あたりの面積が最大になる配置を選ぶ。
 */
export function gridLayout(n: number, width: number, height: number, gap = 4, maxTileW = Infinity): Rect[] {
  if (n <= 0 || width <= 0 || height <= 0) return [];

  let best = { cols: 1, rows: n, w: 0, h: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const tile = fit(
      Math.min(maxTileW, (width - gap * (cols - 1)) / cols),
      (height - gap * (rows - 1)) / rows,
    );
    if (tile.w > best.w) best = { cols, rows, ...tile };
  }

  const { cols, rows, w, h } = best;
  const top = (height - (rows * h + gap * (rows - 1))) / 2;
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const left = (width - (inRow * w + gap * (inRow - 1))) / 2;
    rects.push({ x: left + col * (w + gap), y: top + row * (h + gap), w, h });
  }
  return rects;
}

/** メイン枠とサブ枠のかたまりを、隙間なく並べて画面中央に寄せる */
function pack(axis: "x" | "y", main: { w: number; h: number }, strip: Rect[], width: number, height: number, gap: number): Rect[] {
  if (strip.length === 0) return [];
  const x0 = Math.min(...strip.map((r) => r.x));
  const y0 = Math.min(...strip.map((r) => r.y));
  const x1 = Math.max(...strip.map((r) => r.x + r.w));
  const y1 = Math.max(...strip.map((r) => r.y + r.h));
  if (axis === "x") {
    const left = (width - (main.w + gap + (x1 - x0))) / 2;
    const dx = left + main.w + gap - x0;
    return [{ x: left, y: (height - main.h) / 2, ...main }, ...strip.map((r) => ({ ...r, x: r.x + dx }))];
  }
  const top = (height - (main.h + gap + (y1 - y0))) / 2;
  const dy = top + main.h + gap - y0;
  return [{ x: (width - main.w) / 2, y: top, ...main }, ...strip.map((r) => ({ ...r, y: r.y + dy }))];
}

/**
 * 先頭のプレイヤーを大きく、残りを右列 or 下段に小さく並べる。
 * 横長の画面なら右列、縦長なら下段のほうがメインが大きくなるので、両方計算して大きい方を採用。
 * サブ枠はメインの半分の幅までに抑える（縦長画面で全部同じ大きさになるのを防ぐ）。
 */
export function focusLayout(n: number, width: number, height: number, gap = 4): Rect[] {
  if (n <= 1 || width <= 0 || height <= 0) return gridLayout(n, width, height, gap);
  const subs = n - 1;

  // 右列: メインを高さいっぱいに置いた余りを使う。余りが少なければ幅の25%を確保
  const sideLeftover = width - height * RATIO - gap;
  const stripW = sideLeftover >= width * 0.18 ? sideLeftover : width * 0.25;
  const sideMain = fit(width - stripW - gap, height);
  const side = pack("x", sideMain, gridLayout(subs, stripW, height, gap, sideMain.w / 2), width, height, gap);

  // 下段: 同様に高さ方向の余りを使う
  const bottomLeftover = height - width / RATIO - gap;
  const stripH = bottomLeftover >= height * 0.18 ? bottomLeftover : height * 0.28;
  const bottomMain = fit(width, height - stripH - gap);
  const bottom = pack("y", bottomMain, gridLayout(subs, width, stripH, gap, bottomMain.w / 2), width, height, gap);

  if (side.length === 0 || bottom.length === 0) return side.length ? side : bottom;
  if (sideMain.w !== bottomMain.w) return sideMain.w > bottomMain.w ? side : bottom;
  // メインが同じ大きさなら、サブが大きく見える方
  return side[1].w >= bottom[1].w ? side : bottom;
}

export function computeLayout(mode: LayoutMode, n: number, width: number, height: number, gap = 4) {
  return mode === "focus" ? focusLayout(n, width, height, gap) : gridLayout(n, width, height, gap);
}
