"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { formatAgo, formatCount, formatDuration } from "@/lib/format";
import { useMulti, useTalents } from "@/lib/client/state";
import { createLocalStore, useHydrated, useLocalStore, useNow } from "@/lib/client/store";
import type { Clip, ClipPeriod, ClipsResponse, ProviderStatus, Talent } from "@/lib/types";
import { CheckIcon, PlatformIcon, PlusIcon, StarIcon } from "../icons";
import { MultiDock, toggleInMulti } from "../MultiDock";
import { Avatar, Chip, EmptyState, FollowLink, ThumbPlaceholder } from "../ui";
import { ClipPlayerModal } from "./ClipPlayerModal";

const MAX_SELECTED = 6;

type Kind = "all" | "youtube" | "twitch";
type Sort = "new" | "views";

interface ClipPrefs {
  selected: string[];
  period: ClipPeriod;
  kind: Kind;
  sort: Sort;
  hideShorts: boolean;
}

const prefsStore = createLocalStore<ClipPrefs>("oshiboard:clip-prefs:v1", {
  selected: [],
  period: "7d",
  kind: "all",
  sort: "new",
  hideShorts: false,
});

function clipsUrl(t: Talent, period: ClipPeriod): string {
  const p = new URLSearchParams({ id: t.id, name: t.name, period });
  if (t.youtubeChannelId) p.set("yt", t.youtubeChannelId);
  if (t.twitchLogin) p.set("tw", t.twitchLogin);
  return `/api/clips?${p}`;
}

interface FetchState {
  key: string;
  clips: Clip[];
  errors: string[];
  providers?: ProviderStatus;
  truncated: boolean;
}

/** 選択中のタレントそれぞれの切り抜きを並列で取得してまとめる */
function useClips(talents: Talent[], period: ClipPeriod) {
  const urls = useMemo(() => talents.map((t) => clipsUrl(t, period)), [talents, period]);
  const key = urls.join("|");
  const [state, setState] = useState<FetchState | null>(null);

  useEffect(() => {
    if (urls.length === 0) return;
    let alive = true;
    Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url);
          const json = (await res.json()) as ClipsResponse & { error?: string };
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
          return json;
        } catch (e) {
          return { clips: [], errors: [{ channel: url, message: e instanceof Error ? e.message : String(e) }] } as Partial<ClipsResponse>;
        }
      }),
    ).then((results) => {
      if (!alive) return;
      setState({
        key,
        clips: results.flatMap((r) => r.clips ?? []),
        errors: results.flatMap((r) => (r.errors ?? []).map((e) => e.message)),
        providers: results.find((r) => r.providers)?.providers,
        truncated: results.some((r) => r.truncated),
      });
    });
    return () => {
      alive = false;
    };
  }, [key, urls]);

  const current = state?.key === key ? state : null;
  return { ...current, loading: urls.length > 0 && !current };
}

export function ClipsView() {
  const hydrated = useHydrated();
  const talents = useTalents();
  const multi = useMulti();
  const now = useNow();
  const prefs = useLocalStore(prefsStore);
  const [playing, setPlaying] = useState<Clip | null>(null);

  // 別ページに移ったら再生中の切り抜きを閉じる（Cache Components ではページが非表示で残り、音が鳴り続けるため）
  useLayoutEffect(() => () => setPlaying(null), []);

  const setPrefs = (patch: Partial<ClipPrefs>) => prefsStore.set((p) => ({ ...p, ...patch }));

  // 何も選んでいなければ、お気に入り（なければ先頭）の人を表示
  const selectedTalents = useMemo(() => {
    const chosen = talents.filter((t) => prefs.selected.includes(t.id));
    if (chosen.length > 0) return chosen;
    const favs = talents.filter((t) => t.favorite);
    return (favs.length > 0 ? favs : talents).slice(0, 1);
  }, [talents, prefs.selected]);
  const selectedIds = new Set(selectedTalents.map((t) => t.id));

  const { clips, errors, providers, truncated, loading } = useClips(hydrated ? selectedTalents : [], prefs.period);
  const talentById = useMemo(() => new Map(talents.map((t) => [t.id, t])), [talents]);
  const inMulti = new Set(multi.map((m) => m.source));

  const visible = useMemo(() => {
    const list = (clips ?? []).filter((c) => {
      if (prefs.kind !== "all" && c.platform !== prefs.kind) return false;
      if (prefs.hideShorts && c.platform === "youtube" && (c.durationSec ?? 999) <= 60) return false;
      return true;
    });
    // 同じ動画が複数タレントで出たときは1つにする
    const seen = new Set<string>();
    const unique = list.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    // 再生数が分からない切り抜き（Holodex のみで YouTube キーなし等）は、再生数順でも新しい順で後ろに並ぶ
    const byDate = (a: Clip, b: Clip) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    return unique.sort((a, b) =>
      prefs.sort === "views" ? (b.viewCount ?? -1) - (a.viewCount ?? -1) || byDate(a, b) : byDate(a, b),
    );
  }, [clips, prefs.kind, prefs.hideShorts, prefs.sort]);

  const toggleTalent = (id: string) => {
    // 選んだ順を保つ（7人目を選んだら一番前に選んだ人が外れる）
    const followed = new Set(talents.map((t) => t.id));
    const chosen = prefs.selected.filter((x) => followed.has(x));
    const current = chosen.length > 0 ? chosen : selectedTalents.map((t) => t.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(-MAX_SELECTED);
    setPrefs({ selected: next });
  };

  const sortedTalents = [...talents].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  const viaLabel =
    providers?.holodex ? "Holodex" : providers?.youtube ? "YouTube検索" : providers ? "デモデータ" : "";

  return (
    <main className="mx-auto w-full max-w-[1800px] flex-1 px-3 pb-28 pt-4 sm:px-5">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-lg font-bold">切り抜き</h1>
          <p className="text-xs text-muted">
            YouTube の切り抜き動画と Twitch のクリップをまとめて表示します（{MAX_SELECTED}人まで同時に選択可）。
            {viaLabel && <span className="ml-1">YouTube 切り抜きの取得元: {viaLabel}</span>}
          </p>
        </div>

        {hydrated && talents.length === 0 ? (
          <EmptyState title="まだ誰もフォローしていません">
            <FollowLink /> からVTuberを追加しましょう
          </EmptyState>
        ) : (
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
            {sortedTalents.map((t) => (
              <Chip key={t.id} active={selectedIds.has(t.id)} onClick={() => toggleTalent(t.id)}>
                {t.favorite && <StarIcon size={11} filled className="text-amber-300" />}
                <Avatar name={t.name} url={t.avatarUrl} size={18} />
                {t.name}
              </Chip>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Segmented
            value={prefs.kind}
            onChange={(kind) => setPrefs({ kind })}
            options={[
              ["all", "すべて"],
              ["youtube", "YouTube切り抜き"],
              ["twitch", "Twitchクリップ"],
            ]}
          />
          <Segmented
            value={prefs.period}
            onChange={(period) => setPrefs({ period })}
            options={[
              ["24h", "24時間"],
              ["7d", "1週間"],
              ["30d", "1ヶ月"],
            ]}
          />
          <Segmented
            value={prefs.sort}
            onChange={(sort) => setPrefs({ sort })}
            options={[
              ["new", "新着順"],
              ["views", "再生数順"],
            ]}
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={prefs.hideShorts}
              onChange={(e) => setPrefs({ hideShorts: e.target.checked })}
              className="accent-[var(--color-accent)]"
            />
            ショート（60秒以下）を除く
          </label>
        </div>

        {errors && errors.length > 0 && (
          <p className="text-xs text-amber-300/90">⚠ 一部取得できませんでした: {[...new Set(errors)].join(" / ")}</p>
        )}
        {truncated && (
          <p className="text-xs text-muted">
            切り抜きが多いため、この期間の新しいものから一部だけ表示しています。期間を短くすると全件表示されます。
          </p>
        )}
        {prefs.sort === "views" && visible.some((c) => c.platform === "youtube" && c.viewCount === undefined) && (
          <p className="text-xs text-muted">再生数が取得できない切り抜きは、再生数順の後ろに新しい順で並べています。</p>
        )}
      </div>

      <section className="mt-5">
        {loading || !hydrated ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-6">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="aspect-video animate-pulse rounded-lg bg-panel" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState title="この条件の切り抜きは見つかりませんでした">期間を広げるか、別の人を選んでみてください。</EmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-6">
            {visible.map((clip) => {
              const talent = talentById.get(clip.talentId);
              const added = inMulti.has(clip.source);
              return (
                <article key={clip.id} className="group flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setPlaying(clip)}
                    className="relative aspect-video overflow-hidden rounded-lg bg-panel-2 ring-1 ring-line transition hover:ring-muted/60"
                  >
                    {clip.thumbnailUrl ? (
                      <img
                        src={clip.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : (
                      <ThumbPlaceholder seed={clip.id}>
                        <span className="px-4 text-center text-xs font-bold text-white/80">{clip.title}</span>
                      </ThumbPlaceholder>
                    )}
                    {clip.durationSec !== undefined && (
                      <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] text-white">
                        {formatDuration(clip.durationSec)}
                      </span>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-black/70 p-1">
                      <PlatformIcon platform={clip.platform} size={12} />
                    </span>
                  </button>
                  <div className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="line-clamp-2 text-sm leading-snug font-medium" title={clip.title}>
                        {clip.title}
                      </h3>
                      <p className="mt-1 truncate text-xs text-muted">{clip.channelName}</p>
                      <p className="text-xs text-muted/80">
                        {talent && <span className="text-accent/90">{talent.name}</span>}
                        {clip.viewCount !== undefined && <span>・{formatCount(clip.viewCount)}回</span>}
                        {now !== null && <span>・{formatAgo(clip.publishedAt, now)}</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      title={added ? "マルチビューから外す" : "マルチビューに追加"}
                      onClick={() =>
                        toggleInMulti({ source: clip.source, label: talent?.name ?? clip.channelName, title: clip.title, chat: false })
                      }
                      className={`grid size-7 shrink-0 place-items-center rounded-full ${
                        added ? "bg-accent text-white" : "border border-line text-muted hover:text-white"
                      }`}
                    >
                      {added ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {playing && (
        <ClipPlayerModal
          clip={playing}
          talentName={talentById.get(playing.talentId)?.name}
          onClose={() => setPlaying(null)}
        />
      )}
      <MultiDock />
    </main>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="flex rounded-lg border border-line bg-panel p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            value === v ? "bg-panel-2 font-bold text-white" : "text-muted hover:text-white"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
