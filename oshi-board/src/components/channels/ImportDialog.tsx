"use client";

import { useEffect, useMemo, useState } from "react";
import { isFollowed, talentActions, useTalentIndex, useTalents } from "@/lib/client/state";
import type { ImportCandidate } from "@/lib/types";
import { CheckIcon, PlatformIcon, SearchIcon, XIcon } from "../icons";
import { Avatar, toast } from "../ui";

interface Props {
  title: string;
  candidates: ImportCandidate[];
  truncated?: boolean;
  /** グループ名の初期値（例: 「Twitch」） */
  defaultGroup?: string;
  onClose: () => void;
}

const keyOf = (c: ImportCandidate) => `${c.platform}:${c.id.toLowerCase()}`;

/** 取り込み候補を確認して、選んだ人だけフォローするダイアログ */
export function ImportDialog({ title, candidates, truncated, defaultGroup = "", onClose }: Props) {
  const talents = useTalents();
  const index = useTalentIndex(talents);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState(defaultGroup);
  // 最初はまだフォローしていない人を全員選んでおく
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => !isFollowed(index, c)).map(keyOf)),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? candidates.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)) : candidates;
  }, [candidates, query]);

  const chosen = candidates.filter((c) => selected.has(keyOf(c)) && !isFollowed(index, c));
  const newCount = candidates.filter((c) => !isFollowed(index, c)).length;
  // 1000チャンネルを超えると配信を確認しきれない（お気に入り優先で上限まで）。多いほど更新間隔も延びる
  const totalAfter = talents.length + chosen.length;

  const setMany = (list: ImportCandidate[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of list) {
        if (isFollowed(index, c)) continue;
        if (on) next.add(keyOf(c));
        else next.delete(keyOf(c));
      }
      return next;
    });

  const add = () => {
    const added = talentActions.importMany(chosen, group);
    toast(`${added}人をフォローしました`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 border-b border-line p-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold">{title}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {candidates.length}件のうち、まだフォローしていないのは{newCount}件です。追加する人を選んでください。
              {truncated && " 件数が多いため、途中までを表示しています。"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-white" aria-label="閉じる">
            <XIcon size={18} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <label className="flex min-w-40 flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5">
            <SearchIcon size={14} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前で絞り込み"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted/70"
            />
          </label>
          <button type="button" onClick={() => setMany(visible, true)} className="text-xs text-muted hover:text-white">
            表示中をすべて選択
          </button>
          <button type="button" onClick={() => setMany(visible, false)} className="text-xs text-muted hover:text-white">
            選択を外す
          </button>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {visible.map((c) => {
            const followed = isFollowed(index, c);
            const on = followed || selected.has(keyOf(c));
            return (
              <li key={keyOf(c)}>
                <button
                  type="button"
                  disabled={followed}
                  onClick={() => setMany([c], !selected.has(keyOf(c)))}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-panel-2 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded border ${
                      on ? "border-accent bg-accent text-white" : "border-line"
                    }`}
                  >
                    {on && <CheckIcon size={12} />}
                  </span>
                  <Avatar name={c.name} url={c.avatarUrl} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm">
                      <PlatformIcon platform={c.platform} size={12} />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="block truncate text-xs text-muted">{c.id}</span>
                  </span>
                  {followed && <span className="shrink-0 text-xs text-muted">フォロー済み</span>}
                </button>
              </li>
            );
          })}
          {visible.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">該当するチャンネルはありません</li>}
        </ul>

        {totalAfter > 300 && (
          <p className="border-t border-line px-4 py-2 text-[11px] text-amber-300/90">
            追加するとフォローが{totalAfter}件になります。フォローが多いほど配信一覧の更新間隔が長くなり、
            1000件を超えた分はお気に入り以外から確認されなくなります。よく見る人だけを選ぶのがおすすめです。
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="グループ名（任意）"
            className="min-w-32 flex-1 rounded-lg border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent/60"
          />
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-white">
            キャンセル
          </button>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={add}
            className="rounded-lg bg-accent px-4 py-1.5 text-sm font-bold text-white hover:bg-accent-strong disabled:opacity-50"
          >
            {chosen.length}人をフォロー
          </button>
        </div>
      </div>
    </div>
  );
}
