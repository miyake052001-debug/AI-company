import { YOUTUBE_CHANNEL_ID_RE, type ImportCandidate } from "./types";

/** RFC 4180 風の CSV（ダブルクォート・""・改行入りのセル・BOM）を行×セルにする */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const CHANNEL_ID_IN_TEXT = /(UC[\w-]{22})/;

/**
 * Google Takeout の「登録チャンネル」CSV（subscriptions.csv / 登録チャンネル.csv）を読む。
 * 列は「チャンネルID, チャンネルURL, チャンネル名」だが、言語や将来の変更に備えて
 * ID はどの列からでも拾い、名前は ID でも URL でもない列を使う。
 */
export function parseSubscriptionsCsv(text: string): ImportCandidate[] {
  const seen = new Set<string>();
  const out: ImportCandidate[] = [];
  for (const cells of parseCsv(text)) {
    const trimmed = cells.map((c) => c.trim());
    const id = trimmed.map((c) => CHANNEL_ID_IN_TEXT.exec(c)?.[1]).find((v) => v && YOUTUBE_CHANNEL_ID_RE.test(v));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = trimmed.filter((c) => c && !CHANNEL_ID_IN_TEXT.test(c) && !/^https?:\/\//i.test(c)).at(-1);
    out.push({ platform: "youtube", id, name: name || id });
  }
  return out;
}
