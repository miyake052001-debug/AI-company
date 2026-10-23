import type { Stream } from "./types";

const STATUS_ORDER = { live: 0, upcoming: 1, ended: 2 } as const;

/** 配信中（視聴者数順）→ 予定（近い順）→ アーカイブ（新しい順） */
export function compareStreams(a: Stream, b: Stream): number {
  if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (a.status === "live") return (b.viewers ?? 0) - (a.viewers ?? 0);
  if (a.status === "upcoming") return Date.parse(a.startAt ?? "") - Date.parse(b.startAt ?? "");
  return Date.parse(b.endAt ?? b.startAt ?? "") - Date.parse(a.endAt ?? a.startAt ?? "");
}
