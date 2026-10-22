"use client";

import Link from "next/link";
import { MAX_MULTI, multiActions, useMulti, type MultiInput } from "@/lib/client/state";
import { useHydrated } from "@/lib/client/store";
import { parseSourceKey, fallbackLabel } from "@/lib/media";
import { PlayIcon, XIcon } from "./icons";
import { toast } from "./ui";

/** 配信一覧・切り抜き画面の下に出る「選択中のマルチビュー」バー */
export function MultiDock() {
  const multi = useMulti();
  const hydrated = useHydrated();
  if (!hydrated || multi.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1800px] items-center gap-3 px-3 py-2.5 sm:px-5">
        <span className="hidden shrink-0 text-xs text-muted sm:inline">
          マルチビュー {multi.length}/{MAX_MULTI}
        </span>
        <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {multi.map((m) => {
            const src = parseSourceKey(m.source);
            return (
              <span
                key={m.uid}
                className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-panel-2 py-0.5 pl-2.5 pr-1 text-xs"
              >
                <span className="max-w-32 truncate">{m.label ?? (src ? fallbackLabel(src) : m.source)}</span>
                <button
                  type="button"
                  onClick={() => multiActions.remove(m.uid)}
                  className="rounded-full p-0.5 text-muted hover:bg-black/40 hover:text-white"
                  aria-label="外す"
                >
                  <XIcon size={12} />
                </button>
              </span>
            );
          })}
        </div>
        <Link
          href="/multi"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-strong"
        >
          <PlayIcon size={14} />
          {multi.length >= 2 ? `${multi.length}窓で見る` : "視聴する"}
        </Link>
      </div>
    </div>
  );
}

/** マルチビューへの追加/削除（結果をトーストで知らせる） */
export function toggleInMulti(item: MultiInput & { label: string }) {
  const result = multiActions.toggle(item);
  if (result === "full") toast(`マルチビューは最大${MAX_MULTI}枠までです`);
  else if (result === "invalid") toast("この動画はマルチビューで再生できません");
  else if (result === "added") toast(`「${item.label}」をマルチビューに追加しました`);
  else if (result === "removed") toast(`「${item.label}」をマルチビューから外しました`);
}
