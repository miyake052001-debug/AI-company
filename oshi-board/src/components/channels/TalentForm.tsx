"use client";

import { useState, type FormEvent } from "react";
import { newId } from "@/lib/client/state";
import { TWITCH_LOGIN_RE, YOUTUBE_CHANNEL_ID_RE, type ResolveResponse, type Talent } from "@/lib/types";
import { TwitchIcon, YouTubeIcon } from "../icons";

interface Props {
  initial?: Talent;
  onSave: (t: Talent) => void;
  onCancel: () => void;
}

async function resolve(platform: "youtube" | "twitch", q: string): Promise<ResolveResponse> {
  const res = await fetch(`/api/resolve?platform=${platform}&q=${encodeURIComponent(q)}`);
  const json = (await res.json()) as ResolveResponse & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

export function TalentForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [group, setGroup] = useState(initial?.group ?? "");
  const [youtube, setYoutube] = useState(initial?.youtubeChannelId ?? "");
  const [twitch, setTwitch] = useState(initial?.twitchLogin ?? "");
  const [avatarUrl, setAvatarUrl] = useState(initial?.avatarUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!youtube.trim() && !twitch.trim()) {
      setError("YouTube か Twitch のどちらかは入力してください");
      return;
    }
    setBusy(true);
    try {
      let youtubeChannelId: string | undefined;
      let twitchLogin: string | undefined;
      let resolvedName: string | undefined;
      let avatar = avatarUrl;

      const yt = youtube.trim();
      if (yt) {
        if (YOUTUBE_CHANNEL_ID_RE.test(yt)) youtubeChannelId = yt;
        else {
          const r = await resolve("youtube", yt);
          youtubeChannelId = r.id;
          resolvedName = r.name;
          avatar ??= r.avatarUrl;
        }
      }

      const tw = twitch.trim();
      if (tw) {
        const lower = tw.toLowerCase();
        if (TWITCH_LOGIN_RE.test(lower)) twitchLogin = lower;
        else {
          const r = await resolve("twitch", tw);
          twitchLogin = r.id;
          resolvedName ??= r.name;
          avatar ??= r.avatarUrl;
        }
      }

      const finalName = name.trim() || resolvedName;
      if (!finalName) {
        setError("名前を入力してください");
        return;
      }
      setAvatarUrl(avatar);
      onSave({
        id: initial?.id ?? newId("t"),
        name: finalName,
        group: group.trim() || undefined,
        youtubeChannelId,
        twitchLogin,
        avatarUrl: avatar,
        favorite: initial?.favorite,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent/60";

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-panel p-4">
      <h2 className="font-bold">{initial ? "チャンネルを編集" : "チャンネルを追加"}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          名前（空欄ならチャンネル名を使用）
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="例: 兎田ぺこら" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          グループ・事務所（任意）
          <input value={group} onChange={(e) => setGroup(e.target.value)} className={field} placeholder="例: ホロライブ / 個人勢" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <YouTubeIcon size={12} /> YouTube（チャンネルURL・@ハンドル・UCから始まるID）
          </span>
          <input
            value={youtube}
            onChange={(e) => setYoutube(e.target.value)}
            className={field}
            placeholder="https://www.youtube.com/@usadapekora"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          <span className="flex items-center gap-1">
            <TwitchIcon size={12} /> Twitch（URL またはID）
          </span>
          <input
            value={twitch}
            onChange={(e) => setTwitch(e.target.value)}
            className={field}
            placeholder="https://www.twitch.tv/xxxx"
          />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-white">
          キャンセル
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-1.5 text-sm font-bold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {busy ? "確認中…" : "保存"}
        </button>
      </div>
    </form>
  );
}
