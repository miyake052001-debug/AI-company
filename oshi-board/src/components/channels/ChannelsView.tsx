"use client";

import { useMemo, useRef, useState } from "react";
import { PRESET_GROUPS } from "@/data/presets";
import { streamsUrl, talentActions, useTalents } from "@/lib/client/state";
import { useHydrated } from "@/lib/client/store";
import { usePolling } from "@/lib/client/usePolling";
import type { StreamsResponse, Talent } from "@/lib/types";
import { EditIcon, PlusIcon, StarIcon, TrashIcon, TwitchIcon, YouTubeIcon } from "../icons";
import { Avatar, toast } from "../ui";
import { TalentForm } from "./TalentForm";

export function ChannelsView() {
  const hydrated = useHydrated();
  const talents = useTalents();
  const [editing, setEditing] = useState<Talent | "new" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 取得エラー（IDの間違い）を表示するために配信情報も取る
  const { data } = usePolling<StreamsResponse>(hydrated ? streamsUrl(talents) : null, 300_000);
  const errorByChannel = useMemo(() => new Map((data?.errors ?? []).map((e) => [e.channel, e.message])), [data]);
  const avatarByChannel = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data?.streams ?? []) if (s.avatarUrl) map.set(s.channelId, s.avatarUrl);
    return map;
  }, [data]);

  const followedIds = new Set(talents.map((t) => t.id));

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
      const parsed: unknown = JSON.parse(await file.text());
      if (!Array.isArray(parsed)) throw new Error("配列ではありません");
      const list = parsed.filter(
        (t): t is Talent => !!t && typeof t === "object" && typeof t.id === "string" && typeof t.name === "string",
      );
      talentActions.addMany(list);
      toast(`${list.length}件を読み込みました`);
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

      <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-muted">
          <span className="mr-auto">フォロー中 {hydrated ? talents.length : "-"} 人</span>
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
            talents.map((t) => {
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
            const remaining = g.talents.filter((t) => !followedIds.has(t.id));
            return (
              <div key={g.name} className="rounded-xl border border-line bg-panel p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-muted">{g.talents.length}人</span>
                  <button
                    type="button"
                    disabled={!hydrated || remaining.length === 0}
                    onClick={() => {
                      talentActions.addMany(remaining);
                      toast(`${g.name}の${remaining.length}人を追加しました`);
                    }}
                    className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs hover:border-muted/60 disabled:opacity-40"
                  >
                    まとめて追加
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.talents.map((t) => {
                    const followed = hydrated && followedIds.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={followed}
                        onClick={() => talentActions.add(t)}
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
