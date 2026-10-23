"use client";

import { useMemo, useState } from "react";
import { isFollowed, talentActions, talentForStream, useMulti, useTalentIndex, useTalents } from "@/lib/client/state";
import { useHydrated, useNow } from "@/lib/client/store";
import { usePolling } from "@/lib/client/usePolling";
import type { DiscoverResponse, Stream } from "@/lib/types";
import { CheckIcon, PlusIcon, RefreshIcon, SearchIcon, TwitchIcon, YouTubeIcon } from "../icons";
import { MultiDock, toggleInMulti } from "../MultiDock";
import { StreamCard } from "../StreamCard";
import { Chip, EmptyState, toast } from "../ui";

type Tab = "vtuber" | "twitch";

/** 件数の多い順に上位の値（事務所・ゲーム）を並べる */
function facets(streams: Stream[], pick: (s: Stream) => string | undefined, max = 12): string[] {
  const counts = new Map<string, number>();
  for (const s of streams) {
    const v = pick(s);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([v]) => v);
}

/** フォローしていなくても、いま配信中の人を探せる画面 */
export function DiscoverView() {
  const hydrated = useHydrated();
  const talents = useTalents();
  const index = useTalentIndex(talents);
  const multi = useMulti();
  const now = useNow();
  const { data, error, loading, refresh, updatedAt } = usePolling<DiscoverResponse>(
    hydrated ? "/api/discover" : null,
    120_000,
  );

  const [tab, setTab] = useState<Tab>("vtuber");
  const [facet, setFacet] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const list = useMemo(() => (tab === "vtuber" ? (data?.vtubers ?? []) : (data?.twitch ?? [])), [data, tab]);
  const pickFacet = (s: Stream) => (tab === "vtuber" ? s.org : s.category);
  const topFacets = useMemo(() => facets(list, (s) => (tab === "vtuber" ? s.org : s.category)), [list, tab]);
  // 更新で選んだ事務所・ゲームの配信がなくなったら絞り込みを解除する
  const activeFacet = facet && list.some((s) => (tab === "vtuber" ? s.org : s.category) === facet) ? facet : null;
  const facetValues = activeFacet && !topFacets.includes(activeFacet) ? [...topFacets, activeFacet] : topFacets;
  const selected = useMemo(() => new Set(multi.map((m) => m.source)), [multi]);

  const q = query.trim().toLowerCase();
  const visible = list.filter((s) => {
    if (activeFacet && pickFacet(s) !== activeFacet) return false;
    if (!q) return true;
    return [s.title, s.channelName, s.category, s.org].some((v) => v?.toLowerCase().includes(q));
  });

  const follow = (s: Stream) => {
    const added = talentActions.importMany(
      [{ platform: s.platform, id: s.channelId, name: s.channelName, avatarUrl: s.avatarUrl }],
      s.org,
    );
    toast(added > 0 ? `「${s.channelName}」をフォローしました` : "すでにフォローしています");
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setFacet(null);
  };

  const missingKey =
    data && tab === "vtuber" && !data.providers.holodex
      ? "Holodex の API キーを設定すると、いま配信中の VTuber が一覧で見られます。"
      : data && tab === "twitch" && !data.providers.twitch
        ? "Twitch の API キーを設定すると、いま配信中の日本語の Twitch 配信が一覧で見られます。"
        : null;

  return (
    <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 pb-28 pt-4 sm:px-5">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-lg font-bold">見つける</h1>
          <p className="text-xs text-muted">
            フォローしていない人も含めて、いま配信中の配信を表示します。気になった人はそのままフォローできます。
            YouTube の VTuber 以外の配信者は API の制限で一覧にできないため、フォロー管理から追加してください。
          </p>
        </div>

        {missingKey && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
            {missingKey}（今は<b>デモデータ</b>を表示しています。手順は README）
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-panel p-0.5">
            <button
              type="button"
              onClick={() => switchTab("vtuber")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                tab === "vtuber" ? "bg-panel-2 font-bold text-white" : "text-muted hover:text-white"
              }`}
            >
              <YouTubeIcon size={14} /> VTuber
              <span className="text-xs text-muted">{data?.vtubers.length ?? ""}</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab("twitch")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
                tab === "twitch" ? "bg-panel-2 font-bold text-white" : "text-muted hover:text-white"
              }`}
            >
              <TwitchIcon size={14} /> Twitch（日本語）
              <span className="text-xs text-muted">{data?.twitch.length ?? ""}</span>
            </button>
          </div>

          <label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 sm:max-w-xs">
            <SearchIcon size={15} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前・タイトル・ゲームで検索"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted/70"
            />
          </label>

          <div className="ml-auto flex items-center gap-2 text-xs text-muted">
            {updatedAt && now !== null && <span>{new Date(updatedAt).toLocaleTimeString("ja-JP")} 更新</span>}
            <button
              type="button"
              onClick={refresh}
              className="rounded-md border border-line bg-panel p-1.5 hover:text-white"
              title="今すぐ更新"
            >
              <RefreshIcon size={14} />
            </button>
          </div>
        </div>

        {facetValues.length > 0 && (
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
            <Chip active={activeFacet === null} onClick={() => setFacet(null)}>
              すべて
            </Chip>
            {facetValues.map((v) => (
              <Chip key={v} active={activeFacet === v} onClick={() => setFacet(activeFacet === v ? null : v)}>
                {v}
              </Chip>
            ))}
          </div>
        )}

        {(error || (data && data.errors.length > 0)) && (
          <p className="text-xs text-amber-300/90">⚠ 一部取得できませんでした: {error ?? data?.errors.join(" / ")}</p>
        )}
      </div>

      <section className="mt-5">
        {loading || !hydrated ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-4 gap-y-6">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="aspect-video animate-pulse rounded-lg bg-panel" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState title="該当する配信はありません" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-4 gap-y-6">
            {visible.map((s) => {
              const followed = isFollowed(index, { platform: s.platform, id: s.channelId });
              const talent = talentForStream(index, s);
              return (
                <StreamCard
                  key={s.id}
                  stream={s}
                  talent={talent}
                  now={now}
                  selected={selected.has(s.source)}
                  onToggle={() =>
                    toggleInMulti({ source: s.source, label: talent?.name ?? s.channelName, title: s.title, chat: true })
                  }
                  extra={
                    s.demo ? null : followed ? (
                      <span className="flex h-fit shrink-0 items-center gap-0.5 rounded-full bg-panel-2 px-2 py-1 text-[11px] text-muted">
                        <CheckIcon size={11} /> フォロー中
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => follow(s)}
                        className="flex h-fit shrink-0 items-center gap-0.5 rounded-full border border-accent/60 px-2 py-1 text-[11px] text-accent hover:bg-accent/15"
                      >
                        <PlusIcon size={11} /> フォロー
                      </button>
                    )
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      <MultiDock />
    </main>
  );
}
