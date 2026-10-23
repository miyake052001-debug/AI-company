"use client";

import { formatCount } from "@/lib/format";
import { talentForStream, type MultiItem } from "@/lib/client/state";
import type { Stream, Talent } from "@/lib/types";
import { CheckIcon, PlatformIcon, PlusIcon } from "../icons";
import { Avatar } from "../ui";

interface Props {
  streams: Stream[] | undefined;
  loading: boolean;
  index: Map<string, Talent>;
  multi: MultiItem[];
  onToggle: (s: Stream, label: string) => void;
}

/** 配信中・まもなく開始の配信をワンクリックでマルチビューに足すリスト */
export function LivePicker({ streams, loading, index, multi, onToggle }: Props) {
  const added = new Set(multi.map((m) => m.source));
  const candidates = (streams ?? []).filter((s) => s.status === "live" || s.status === "upcoming").slice(0, 40);

  if (loading) return <p className="p-4 text-sm text-muted">読み込み中…</p>;
  if (candidates.length === 0) {
    return <p className="p-4 text-sm text-muted">フォロー中で配信中・予定の配信はありません。</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {candidates.map((s) => {
        const talent = talentForStream(index, s);
        const name = talent?.name ?? s.channelName;
        const isAdded = added.has(s.source);
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onToggle(s, name)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-panel-2"
            >
              <Avatar name={name} url={s.avatarUrl ?? talent?.avatarUrl} size={30} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <PlatformIcon platform={s.platform} size={12} />
                  <span className="truncate">{name}</span>
                  {s.status === "live" ? (
                    <span className="shrink-0 text-[11px] text-live">● {formatCount(s.viewers)}人</span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-sky-400">予定</span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted">{s.title}</span>
              </span>
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-full ${
                  isAdded ? "bg-accent text-white" : "border border-line text-muted"
                }`}
              >
                {isAdded ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
