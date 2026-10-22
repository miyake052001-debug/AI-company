"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { computeLayout } from "@/lib/layout";
import { chatUrl, fallbackLabel, parseMediaInput, parseSourceKey, sourceKey, type MediaSource } from "@/lib/media";
import {
  MAX_MULTI,
  multiActions,
  multiPrefsStore,
  streamsUrl,
  useMulti,
  useMultiPrefs,
  useTalentIndex,
  useTalents,
  type MultiItem,
} from "@/lib/client/state";
import { useHost, useHydrated } from "@/lib/client/store";
import { usePolling } from "@/lib/client/usePolling";
import type { StreamsResponse, Talent } from "@/lib/types";
import { ChatIcon, FocusIcon, FullscreenIcon, GridIcon, LinkIcon, PlusIcon, TrashIcon } from "../icons";
import { toggleInMulti } from "../MultiDock";
import { toast } from "../ui";
import { ChatPanel } from "./ChatPanel";
import { LivePicker } from "./LivePicker";
import { PlayerTile } from "./PlayerTile";

const GAP = 4;

function labelFor(item: MultiItem, source: MediaSource, index: Map<string, Talent>): string {
  if (item.label) return item.label;
  if (source.kind === "tw") return index.get(`tw:${source.id}`)?.name ?? source.id;
  return fallbackLabel(source);
}

export function MultiView() {
  const hydrated = useHydrated();
  const host = useHost();
  const multi = useMulti();
  const prefs = useMultiPrefs();
  const talents = useTalents();
  const index = useTalentIndex(talents);

  const [input, setInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chatUid, setChatUid] = useState<string | null>(null);
  const [reloads, setReloads] = useState<Record<string, number>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const metaRequested = useRef(new Set<string>());

  // 配信中リストは「空のとき」か「配信中から追加」を開いているときだけ取得する
  const wantStreams = hydrated && (pickerOpen || multi.length === 0);
  const live = usePolling<StreamsResponse>(wantStreams ? streamsUrl(talents) : null, 120_000);

  // 共有リンク（/multi?s=yt:xxx,tw:yyy）から復元
  useEffect(() => {
    const shared = new URLSearchParams(window.location.search).get("s");
    if (!shared) return;
    const sources = shared
      .split(",")
      .map((k) => parseSourceKey(k.trim()) ?? parseMediaInput(k))
      .filter((s): s is MediaSource => !!s)
      .map(sourceKey);
    if (sources.length > 0) multiActions.replaceWithSources([...new Set(sources)]);
    window.history.replaceState(null, "", "/multi");
  }, []);

  // 貼り付けた YouTube 動画のタイトルを取得してラベルにする
  useEffect(() => {
    for (const item of multi) {
      const s = parseSourceKey(item.source);
      if (!s || s.kind !== "yt" || item.label || metaRequested.current.has(item.uid)) continue;
      metaRequested.current.add(item.uid);
      fetch(`/api/meta?src=${encodeURIComponent(item.source)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((meta: { title: string; author: string } | null) => {
          if (meta) multiActions.update(item.uid, { label: meta.author || "YouTube", title: meta.title });
        })
        .catch(() => {});
    }
  }, [multi]);

  /*
   * Cache Components ではページ遷移しても前のページは display:none で残る（React の Activity）。
   * iframe は非表示でも再生し続けて音が鳴るので、非表示になったら iframe ごと外し、戻ったら付け直す。
   */
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Activity から戻ったときにプレイヤーを復帰させる
    setActive(true);
    return () => setActive(false);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // 非表示（display:none）の間は 0 になるので無視する
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ステージ内側に GAP 分の余白（inset-1）を取るので、その分を引いて計算する
  const rects = useMemo(
    () => computeLayout(prefs.layout, multi.length, size.w - GAP * 2, size.h - GAP * 2, GAP),
    [prefs.layout, multi.length, size.w, size.h],
  );

  // iframe は DOM 上で移動すると再読み込みされるので、描画順は追加順に固定し、位置だけ並び順で決める
  const domOrder = useMemo(() => [...multi].sort((a, b) => a.addedAt - b.addedAt), [multi]);
  const position = useMemo(() => new Map(multi.map((m, i) => [m.uid, i])), [multi]);

  const labeled = multi.flatMap((item) => {
    const source = parseSourceKey(item.source);
    return source ? [{ item, source, label: labelFor(item, source, index) }] : [];
  });
  const labelByUid = new Map(labeled.map((l) => [l.item.uid, l.label]));

  // チャットを出せる枠（切り抜き・アーカイブは除く）。並び替えでチャットが切り替わらないよう追加順で並べる
  const hasChat = (item: MultiItem, source: MediaSource) => host !== null && item.chat !== false && !!chatUrl(source, host);
  const chatItems = labeled
    .filter(({ item, source }) => hasChat(item, source))
    .sort((a, b) => a.item.addedAt - b.item.addedAt);
  const activeChatUid = chatItems.find(({ item }) => item.uid === chatUid)?.item.uid ?? chatItems[0]?.item.uid ?? null;
  const hasTwitch = labeled.some(({ source }) => source.kind !== "yt" && source.kind !== "demo");

  const addInput = (e: FormEvent) => {
    e.preventDefault();
    const source = parseMediaInput(input);
    if (!source) {
      toast("YouTube か Twitch のURLを入力してください");
      return;
    }
    const label = source.kind === "tw" ? (index.get(`tw:${source.id}`)?.name ?? source.id) : undefined;
    const result = multiActions.add({ source: sourceKey(source), label });
    if (result === "full") toast(`マルチビューは最大${MAX_MULTI}枠までです`);
    else if (result === "exists") toast("すでに追加されています");
    else setInput("");
  };

  const copyShareLink = async () => {
    const url = `${window.location.origin}/multi?s=${multi.map((m) => m.source).join(",")}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("共有リンクをコピーしました");
    } catch {
      window.prompt("このリンクをコピーしてください", url);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen?.();
  };

  const openChat = (uid: string) => {
    setChatUid(uid);
    multiPrefsStore.set((p) => ({ ...p, chat: true }));
  };


  return (
    <main className="flex min-h-[calc(100dvh-3.5rem)] flex-col md:h-[calc(100dvh-3.5rem)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
        <form onSubmit={addInput} className="flex min-w-60 flex-1 items-center gap-1.5 sm:max-w-xl">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="YouTube / Twitch のURLを貼り付けて追加"
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm outline-none placeholder:text-muted/70 focus:border-accent/60"
          />
          <button
            type="submit"
            className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-sm font-bold text-white hover:bg-accent-strong"
          >
            <PlusIcon size={14} />
            追加
          </button>
        </form>

        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            className="rounded-lg border border-line bg-panel px-3 py-1.5 text-sm hover:border-muted/50"
          >
            <span className="mr-1 text-live">●</span>配信中から追加
          </button>
          {pickerOpen && (
            <>
              <button
                type="button"
                aria-label="閉じる"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setPickerOpen(false)}
              />
              <div className="absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-[min(92vw,380px)] overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl">
                <LivePicker
                  streams={live.data?.streams}
                  loading={live.loading}
                  index={index}
                  multi={multi}
                  onToggle={(s, label) => toggleInMulti({ source: s.source, label, title: s.title, chat: true })}
                />
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <div className="flex rounded-lg border border-line bg-panel p-0.5">
            <button
              type="button"
              title="均等に並べる"
              onClick={() => multiPrefsStore.set((p) => ({ ...p, layout: "grid" }))}
              className={`rounded-md p-1.5 ${prefs.layout === "grid" ? "bg-panel-2 text-white" : "text-muted"}`}
            >
              <GridIcon size={16} />
            </button>
            <button
              type="button"
              title="メイン＋サブ（先頭を大きく）"
              onClick={() => multiPrefsStore.set((p) => ({ ...p, layout: "focus" }))}
              className={`rounded-md p-1.5 ${prefs.layout === "focus" ? "bg-panel-2 text-white" : "text-muted"}`}
            >
              <FocusIcon size={16} />
            </button>
          </div>
          <button
            type="button"
            title="チャット"
            onClick={() => multiPrefsStore.set((p) => ({ ...p, chat: !p.chat }))}
            className={`rounded-lg border border-line p-1.5 ${prefs.chat ? "bg-panel-2 text-white" : "bg-panel text-muted"}`}
          >
            <ChatIcon size={16} />
          </button>
          <button
            type="button"
            title="共有リンクをコピー"
            onClick={copyShareLink}
            disabled={multi.length === 0}
            className="rounded-lg border border-line bg-panel p-1.5 text-muted hover:text-white disabled:opacity-40"
          >
            <LinkIcon size={16} />
          </button>
          <button
            type="button"
            title="全画面"
            onClick={toggleFullscreen}
            className="rounded-lg border border-line bg-panel p-1.5 text-muted hover:text-white"
          >
            <FullscreenIcon size={16} />
          </button>
          <button
            type="button"
            title="すべて閉じる"
            onClick={() => multiActions.clear()}
            disabled={multi.length === 0}
            className="rounded-lg border border-line bg-panel p-1.5 text-muted hover:text-white disabled:opacity-40"
          >
            <TrashIcon size={16} />
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="flex min-h-0 flex-1 flex-col bg-bg md:flex-row">
        <div ref={stageRef} className="relative h-[62dvh] min-w-0 md:h-auto md:flex-1">
          {active && hydrated && host && size.w > 0 && multi.length > 0 && (
            <div className="absolute inset-1">
              {domOrder.map((item) => {
                const i = position.get(item.uid) ?? 0;
                const source = parseSourceKey(item.source);
                const rect = rects[i];
                if (!source || !rect) return null;
                return (
                  <PlayerTile
                    key={item.uid}
                    item={item}
                    source={source}
                    label={labelByUid.get(item.uid) ?? ""}
                    rect={rect}
                    index={i}
                    total={multi.length}
                    host={host}
                    focusMode={prefs.layout === "focus"}
                    hasChat={hasChat(item, source)}
                    chatActive={prefs.chat && activeChatUid === item.uid}
                    reloadKey={reloads[item.uid] ?? 0}
                    onPromote={() => multiActions.promote(item.uid)}
                    onMove={(dir) => multiActions.move(item.uid, dir)}
                    onChat={() => openChat(item.uid)}
                    onReload={() => setReloads((r) => ({ ...r, [item.uid]: (r[item.uid] ?? 0) + 1 }))}
                    onRemove={() => multiActions.remove(item.uid)}
                  />
                );
              })}
            </div>
          )}

          {hydrated && multi.length === 0 && (
            <div className="absolute inset-0 overflow-y-auto p-4">
              <div className="mx-auto mt-4 max-w-xl">
                <h1 className="text-xl font-bold">マルチビュー</h1>
                <p className="mt-1 text-sm text-muted">
                  YouTube と Twitch の配信を並べて同時に見られます（最大{MAX_MULTI}窓）。
                  <Link href="/" className="text-accent hover:underline">
                    配信一覧
                  </Link>
                  で選ぶか、上の欄にURLを貼り付けてください。
                </p>
                <div className="mt-4 overflow-hidden rounded-xl border border-line bg-panel">
                  <div className="border-b border-line px-3 py-2 text-xs text-muted">フォロー中の配信</div>
                  <LivePicker
                    streams={live.data?.streams}
                    loading={live.loading}
                    index={index}
                    multi={multi}
                    onToggle={(s, label) => toggleInMulti({ source: s.source, label, title: s.title, chat: true })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {active && prefs.chat && host && (
          <ChatPanel
            items={chatItems.map(({ item, source, label }) => ({ item, source, label }))}
            activeUid={activeChatUid}
            host={host}
            onSelect={setChatUid}
            onClose={() => multiPrefsStore.set((p) => ({ ...p, chat: false }))}
          />
        )}
      </div>

      {hydrated && multi.length > 0 && (
        <p className="hidden px-4 py-1 text-[11px] text-muted md:block">
          ヒント: 各プレイヤーにカーソルを合わせると、並び替え・チャット表示・削除ができます。音声は2枠目以降ミュートで始まります。
          {hasTwitch && " Twitch は 400×300 より小さい枠だと自動再生されないので、▶ を押してください。"}
        </p>
      )}
    </main>
  );
}
