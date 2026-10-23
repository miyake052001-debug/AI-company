"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PRESET_GROUPS } from "@/data/presets";
import { isFollowed, sanitizeTalents, talentActions, useTalentIndex, useTalents } from "@/lib/client/state";
import { useHydrated } from "@/lib/client/store";
import { useStreamsFeed } from "@/lib/client/useStreamsFeed";
import { importErrorMessage } from "@/lib/importErrors";
import type { ImportCandidate, ImportResponse, Talent } from "@/lib/types";
import { EditIcon, PlusIcon, SearchIcon, StarIcon, TrashIcon, TwitchIcon, YouTubeIcon } from "../icons";
import { Avatar, toast } from "../ui";
import { ImportDialog } from "./ImportDialog";
import { ImportPanel } from "./ImportPanel";
import { TalentForm } from "./TalentForm";

export function ChannelsView() {
  const hydrated = useHydrated();
  const talents = useTalents();
  const [editing, setEditing] = useState<Talent | "new" | null>(null);
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState<{
    /** 取り込みのたびに変える（ダイアログの選択状態を引き継がないように） */
    id: number;
    title: string;
    candidates: ImportCandidate[];
    truncated?: boolean;
    defaultGroup?: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Twitch / Google のログインから戻ってきたら、フォロー一覧を受け取って確認ダイアログを開く
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("import");
    const error = params.get("import_error");
    if (!provider && !error) return;
    window.history.replaceState(null, "", "/channels");
    if (error) {
      // URL から来た文字列はそのまま表示しない（決まった文言に置き換える）
      toast(importErrorMessage(error, params.get("import_provider")));
      return;
    }
    if (provider !== "twitch" && provider !== "google") return;
    toast(provider === "twitch" ? "Twitch のフォローを読み込んでいます…" : "YouTube の登録チャンネルを読み込んでいます…");
    fetch(`/api/import/${provider}`, { method: "POST" })
      .then(async (res) => {
        const json = (await res.json()) as ImportResponse & { error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        if (json.candidates.length === 0) {
          toast(provider === "twitch" ? "Twitch でフォローしている人がいませんでした" : "YouTube の登録チャンネルがありませんでした");
          return;
        }
        setImporting({
          id: Date.now(),
          title: provider === "twitch" ? "Twitch でフォローしている人" : "YouTube の登録チャンネル",
          candidates: json.candidates,
          truncated: json.truncated,
        });
      })
      .catch((e: unknown) => toast(`取り込めませんでした: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  // 取得エラー（IDの間違い）を表示するために配信情報も取る
  const { data } = useStreamsFeed(hydrated ? talents : null, 300_000);
  const errorByChannel = useMemo(() => new Map((data?.errors ?? []).map((e) => [e.channel, e.message])), [data]);
  const avatarByChannel = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data?.streams ?? []) if (s.avatarUrl) map.set(s.channelId, s.avatarUrl);
    return map;
  }, [data]);

  // プリセットの「フォロー済み」はチャンネルで判定する（取り込みや「見つける」で追加した人も含めるため）。
  // YouTube と Twitch の両方を持つ人は、両方フォローしていてはじめて済みにする（片方だけなら追加で足せる）
  const index = useTalentIndex(talents);
  const presetFollowed = (t: Talent) =>
    (!!t.youtubeChannelId || !!t.twitchLogin) &&
    (!t.youtubeChannelId || isFollowed(index, { platform: "youtube", id: t.youtubeChannelId })) &&
    (!t.twitchLogin || isFollowed(index, { platform: "twitch", id: t.twitchLogin }));
  const showFilter = talents.length > 10 || filter !== "";
  const q = showFilter ? filter.trim().toLowerCase() : "";
  const shown = q
    ? talents.filter((t) =>
        [t.name, t.group, t.youtubeChannelId, t.twitchLogin].some((v) => v?.toLowerCase().includes(q)),
      )
    : talents;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(talents, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "oshiboard-follows.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const list = sanitizeTalents(JSON.parse(await file.text()));
      if (!list) throw new Error("配列ではありません");
      const added = talentActions.addMany(list);
      toast(
        added === list.length
          ? `${added}件を読み込みました`
          : `${added}件を読み込みました（${list.length - added}件はフォロー済みのため飛ばしました）`,
      );
    } catch (e) {
      toast(`読み込めませんでした: ${e instanceof Error ? e.message : e}`);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-3 pb-16 pt-4 sm:px-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-lg font-bold">フォロー管理</h1>
          <p className="text-xs text-muted">
            ここに登録したチャンネルの配信・切り抜きが表示されます。データはこのブラウザに保存されます。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white hover:bg-accent-strong"
        >
          <PlusIcon size={14} /> チャンネルを追加
        </button>
      </div>

      {editing && (
        <div className="mt-4">
          <TalentForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSave={(t) => {
              if (editing === "new") talentActions.add(t);
              else talentActions.update(t.id, t);
              toast(editing === "new" ? `「${t.name}」をフォローしました` : "保存しました");
              setEditing(null);
            }}
          />
        </div>
      )}

      <ImportPanel
        onCandidates={(title, candidates, defaultGroup) => setImporting({ id: Date.now(), title, candidates, defaultGroup })}
      />

      {importing && (
        <ImportDialog
          key={importing.id}
          title={importing.title}
          candidates={importing.candidates}
          truncated={importing.truncated}
          defaultGroup={importing.defaultGroup}
          onClose={() => setImporting(null)}
        />
      )}

      <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-xs text-muted">
          <span>フォロー中 {hydrated ? talents.length : "-"} 人</span>
          {hydrated && showFilter && (
            <label className="flex min-w-32 flex-1 items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-1 sm:max-w-56">
              <SearchIcon size={12} />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="絞り込み"
                className="w-full bg-transparent text-xs text-white outline-none placeholder:text-muted/70"
              />
            </label>
          )}
          <span className="ml-auto" />
          <button type="button" onClick={exportJson} className="hover:text-white">
            エクスポート
          </button>
          <span>/</span>
          <button type="button" onClick={() => fileRef.current?.click()} className="hover:text-white">
            インポート
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = "";
            }}
          />
          <span>/</span>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("フォローを初期状態に戻しますか？")) talentActions.reset();
            }}
            className="hover:text-white"
          >
            初期化
          </button>
        </div>
        {hydrated && talents.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted">まだ誰もいません。下のプリセットか「チャンネルを追加」から登録しましょう。</p>
        )}
        <ul className="divide-y divide-line">
          {hydrated &&
            shown.map((t) => {
              const ytError = t.youtubeChannelId ? errorByChannel.get(`yt:${t.youtubeChannelId}`) : undefined;
              const twError = t.twitchLogin ? errorByChannel.get(`tw:${t.twitchLogin}`) : undefined;
              const avatar =
                t.avatarUrl ??
                (t.youtubeChannelId && avatarByChannel.get(t.youtubeChannelId)) ??
                (t.twitchLogin && avatarByChannel.get(t.twitchLogin)) ??
                undefined;
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => talentActions.toggleFavorite(t.id)}
                    title={t.favorite ? "お気に入りを外す" : "お気に入りにする"}
                    className={t.favorite ? "text-amber-300" : "text-muted/50 hover:text-amber-300"}
                  >
                    <StarIcon size={16} filled={t.favorite} />
                  </button>
                  <Avatar name={t.name} url={avatar} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{t.name}</span>
                      {t.group && <span className="shrink-0 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-muted">{t.group}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      {t.youtubeChannelId && (
                        <a
                          href={`https://www.youtube.com/channel/${t.youtubeChannelId}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex items-center gap-1 hover:text-white ${ytError ? "text-amber-300" : ""}`}
                          title={ytError}
                        >
                          <YouTubeIcon size={12} /> YouTube{ytError && " ⚠ 取得エラー"}
                        </a>
                      )}
                      {t.twitchLogin && (
                        <a
                          href={`https://www.twitch.tv/${t.twitchLogin}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex items-center gap-1 hover:text-white ${twError ? "text-amber-300" : ""}`}
                          title={twError}
                        >
                          <TwitchIcon size={12} /> {t.twitchLogin}
                          {twError && " ⚠ 取得エラー"}
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="rounded p-1.5 text-muted hover:bg-panel-2 hover:text-white"
                    aria-label="編集"
                  >
                    <EditIcon size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      talentActions.remove(t.id);
                      toast(`「${t.name}」のフォローを外しました`);
                    }}
                    className="rounded p-1.5 text-muted hover:bg-panel-2 hover:text-red-300"
                    aria-label="削除"
                  >
                    <TrashIcon size={15} />
                  </button>
                </li>
              );
            })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-bold">プリセットから追加</h2>
        <p className="text-xs text-muted">公開情報をもとに登録したチャンネル一覧です。卒業・移籍などで古くなっている場合があります。</p>
        <div className="mt-3 flex flex-col gap-4">
          {PRESET_GROUPS.map((g) => {
            const remaining = g.talents.filter((t) => !presetFollowed(t));
            return (
              <div key={g.name} className="rounded-xl border border-line bg-panel p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-muted">{g.talents.length}人</span>
                  <button
                    type="button"
                    disabled={!hydrated || remaining.length === 0}
                    onClick={() => {
                      const added = talentActions.addMany(remaining);
                      toast(`${g.name}の${added}人を追加しました`);
                    }}
                    className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs hover:border-muted/60 disabled:opacity-40"
                  >
                    まとめて追加
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.talents.map((t) => {
                    const followed = hydrated && presetFollowed(t);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={followed}
                        onClick={() => talentActions.addMany([t])}
                        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                          followed ? "border-accent/40 bg-accent/10 text-white/70" : "border-line hover:border-muted/60"
                        }`}
                      >
                        {followed ? "✓" : "+"} {t.name}
                        {t.twitchLogin && <TwitchIcon size={11} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

