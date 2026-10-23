"use client";

import { useMemo, useState } from "react";
import { talentForStream, useMulti, useTalentIndex, useTalents } from "@/lib/client/state";
import { useHydrated, useNow } from "@/lib/client/store";
import { useStreamsFeed } from "@/lib/client/useStreamsFeed";
import type { Platform, StreamStatus } from "@/lib/types";
import { RefreshIcon, SearchIcon, StarIcon, TwitchIcon, YouTubeIcon } from "./icons";
import { MultiDock, toggleInMulti } from "./MultiDock";
import { StreamCard } from "./StreamCard";
import { Chip, DemoNotice, EmptyState, FollowLink } from "./ui";

const TABS: { status: StreamStatus; label: string }[] = [
  { status: "live", label: "配信中" },
  { status: "upcoming", label: "予定" },
  { status: "ended", label: "アーカイブ" },
];

export function StreamsView() {
  const hydrated = useHydrated();
  const talents = useTalents();
  const index = useTalentIndex(talents);
  const multi = useMulti();
  const now = useNow();
  const { data, error, loading, refresh, updatedAt } = useStreamsFeed(hydrated ? talents : null, 120_000);

  const [tab, setTab] = useState<StreamStatus>("live");
  const [query, setQuery] = useState("");
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({ youtube: true, twitch: true });
  const [group, setGroup] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);

  const groups = useMemo(
    () => [...new Set(talents.map((t) => t.group).filter((g): g is string => !!g))],
    [talents],
  );
  const selected = useMemo(() => new Set(multi.map((m) => m.source)), [multi]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.streams ?? [])
      .map((stream) => ({ stream, talent: talentForStream(index, stream) }))
      .filter(({ stream, talent }) => {
        if (!platforms[stream.platform]) return false;
        if (group && talent?.group !== group) return false;
        if (favOnly && !talent?.favorite) return false;
        if (!q) return true;
        return [stream.title, stream.channelName, talent?.name, stream.category]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q));
      });
  }, [data, index, platforms, group, favOnly, query]);

  const counts = { live: 0, upcoming: 0, ended: 0 };
  for (const { stream } of items) counts[stream.status]++;
  const visible = items.filter(({ stream }) => stream.status === tab);

  const channelErrors = data?.errors.filter((e) => e.channel.includes(":")) ?? [];
  const providerErrors = data?.errors.filter((e) => !e.channel.includes(":")) ?? [];

  return (
    <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 pb-28 pt-4 sm:px-5">
      <div className="flex flex-col gap-3">
        <DemoNotice providers={data?.providers} needTwitch={talents.some((t) => t.twitchLogin)} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-panel p-0.5">
            {TABS.map((t) => (
              <button
                key={t.status}
                type="button"
                onClick={() => setTab(t.status)}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  tab === t.status ? "bg-panel-2 font-bold text-white" : "text-muted hover:text-white"
                }`}
              >
                {t.label}
                <span className={`ml-1.5 text-xs ${t.status === "live" && counts.live ? "text-live" : "text-muted"}`}>
                  {counts[t.status]}
                </span>
              </button>
            ))}
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

        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
          <Chip active={platforms.youtube} onClick={() => setPlatforms((p) => ({ ...p, youtube: !p.youtube }))}>
            <YouTubeIcon size={13} /> YouTube
          </Chip>
          <Chip active={platforms.twitch} onClick={() => setPlatforms((p) => ({ ...p, twitch: !p.twitch }))}>
            <TwitchIcon size={13} /> Twitch
          </Chip>
          <span className="mx-1 h-4 w-px shrink-0 bg-line" />
          <Chip active={favOnly} onClick={() => setFavOnly((v) => !v)} title="フォロー管理で★を付けた人だけ">
            <StarIcon size={12} filled={favOnly} /> お気に入り
          </Chip>
          <Chip active={group === null} onClick={() => setGroup(null)}>
            すべて
          </Chip>
          {groups.map((g) => (
            <Chip key={g} active={group === g} onClick={() => setGroup(group === g ? null : g)}>
              {g}
            </Chip>
          ))}
        </div>

        {(error || providerErrors.length > 0) && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200">
            {error && <p>取得に失敗しました: {error}</p>}
            {providerErrors.map((e) => (
              <p key={e.channel}>
                {e.channel === "youtube" ? "YouTube" : "Twitch"}: {e.message}
              </p>
            ))}
          </div>
        )}
        {channelErrors.length > 0 && (
          <p className="text-xs text-amber-300/90">
            ⚠ {channelErrors.length}件のチャンネルで取得エラーがありました（IDが間違っている可能性があります。<FollowLink />
            で確認できます）
          </p>
        )}
      </div>

      <section className="mt-5">
        {loading || !hydrated ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-4 gap-y-6">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="aspect-video animate-pulse rounded-lg bg-panel" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-panel" />
              </div>
            ))}
          </div>
        ) : talents.length === 0 ? (
          <EmptyState title="まだ誰もフォローしていません">
            <FollowLink /> からVTuberを追加しましょう
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState title={tab === "live" ? "いま配信中の人はいません" : tab === "upcoming" ? "配信予定はありません" : "最近のアーカイブはありません"}>
            {tab === "live" && "「予定」タブで次の配信をチェックできます。"}
            <br />
            フォローは <FollowLink /> から増やせます。
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-4 gap-y-6">
            {visible.map(({ stream, talent }) => (
              <StreamCard
                key={stream.id}
                stream={stream}
                talent={talent}
                now={now}
                selected={selected.has(stream.source)}
                onToggle={() =>
                  toggleInMulti({
                    source: stream.source,
                    label: talent?.name ?? stream.channelName,
                    title: stream.title,
                    chat: stream.status !== "ended",
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      <MultiDock />
    </main>
  );
}
