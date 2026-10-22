"use client";

import type { ReactNode } from "react";
import type { Rect } from "@/lib/layout";
import { embedUrl, type MediaSource, watchUrl } from "@/lib/media";
import type { MultiItem } from "@/lib/client/state";
import {
  ChatIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CrownIcon,
  ExternalIcon,
  PlatformIcon,
  RefreshIcon,
  XIcon,
} from "../icons";

interface Props {
  item: MultiItem;
  source: MediaSource;
  label: string;
  rect: Rect;
  index: number;
  total: number;
  host: string;
  focusMode: boolean;
  hasChat: boolean;
  chatActive: boolean;
  reloadKey: number;
  onPromote: () => void;
  onMove: (dir: -1 | 1) => void;
  onChat: () => void;
  onReload: () => void;
  onRemove: () => void;
}

function ToolButton({ title, onClick, children, active }: { title: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`rounded p-1 transition-colors hover:bg-white/15 ${active ? "text-accent" : "text-white"}`}
    >
      {children}
    </button>
  );
}

export function PlayerTile(props: Props) {
  const { item, source, label, rect, index, total, host, focusMode, hasChat, chatActive, reloadKey } = props;
  // ミュート指定は追加時に固定する（変えると iframe が再読み込みされるため）
  const url = embedUrl(source, { host, muted: item.startMuted });
  const external = watchUrl(source);
  const platform = source.kind === "yt" ? "youtube" : source.kind === "demo" ? null : "twitch";
  // 小さい枠（スマホのサブ枠など）では補助ボタンを隠して、閉じるボタンが押せるようにする
  const compact = rect.w < 280;

  return (
    <div
      className="group absolute overflow-hidden rounded-md bg-black shadow-lg ring-1 ring-white/5 transition-[left,top,width,height] duration-200"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {url ? (
        <iframe
          key={reloadKey}
          src={url}
          title={label}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write; web-share"
          allowFullScreen
          className="size-full border-0"
        />
      ) : (
        <div className="grid size-full place-items-center bg-gradient-to-br from-fuchsia-900/60 to-indigo-950 p-4 text-center">
          <div>
            <p className="text-lg font-bold">{label}</p>
            <p className="mt-1 text-xs text-white/70">デモ枠です。APIキーを設定すると実際の配信が再生されます。</p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-1.5 flex justify-center opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-90">
        <div className="pointer-events-auto flex max-w-[calc(100%-12px)] items-center gap-0.5 rounded-full bg-black/80 py-0.5 pl-2.5 pr-1 text-xs shadow-lg backdrop-blur">
          {platform && !compact && <PlatformIcon platform={platform} size={12} />}
          <span className={`mr-1 truncate font-medium ${compact ? "max-w-16" : "ml-1 max-w-40"}`}>{label}</span>
          {focusMode && index > 0 && (
            <ToolButton title="メイン枠にする" onClick={props.onPromote}>
              <CrownIcon size={14} />
            </ToolButton>
          )}
          {!focusMode && !compact && total > 1 && (
            <>
              {index > 0 && (
                <ToolButton title="前へ移動" onClick={() => props.onMove(-1)}>
                  <ChevronLeftIcon size={14} />
                </ToolButton>
              )}
              {index < total - 1 && (
                <ToolButton title="後ろへ移動" onClick={() => props.onMove(1)}>
                  <ChevronRightIcon size={14} />
                </ToolButton>
              )}
            </>
          )}
          {hasChat && (
            <ToolButton title="このチャットを表示" onClick={props.onChat} active={chatActive}>
              <ChatIcon size={14} />
            </ToolButton>
          )}
          {url && !compact && (
            <ToolButton title="再読み込み" onClick={props.onReload}>
              <RefreshIcon size={14} />
            </ToolButton>
          )}
          {external && !compact && (
            <a
              href={external}
              target="_blank"
              rel="noreferrer"
              title="元のページで開く"
              className="rounded p-1 text-white hover:bg-white/15"
            >
              <ExternalIcon size={14} />
            </a>
          )}
          <ToolButton title="閉じる" onClick={props.onRemove}>
            <XIcon size={14} />
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
