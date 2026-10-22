"use client";

import { chatUrl, type MediaSource } from "@/lib/media";
import type { MultiItem } from "@/lib/client/state";
import { PlatformIcon, XIcon } from "../icons";

interface Props {
  /** チャットを出せる枠だけ（追加順） */
  items: { item: MultiItem; source: MediaSource; label: string }[];
  activeUid: string | null;
  host: string;
  onSelect: (uid: string) => void;
  onClose: () => void;
}

export function ChatPanel({ items, activeUid, host, onSelect, onClose }: Props) {
  const active = items.find(({ item }) => item.uid === activeUid);
  const url = active ? chatUrl(active.source, host) : null;

  return (
    <aside className="flex h-[55dvh] w-full shrink-0 flex-col border-t border-line bg-panel md:h-auto md:w-80 md:border-l md:border-t-0 xl:w-96">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <div className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {items.map(({ item, source, label }) => (
            <button
              key={item.uid}
              type="button"
              onClick={() => onSelect(item.uid)}
              className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs ${
                item.uid === activeUid ? "bg-panel-2 text-white" : "text-muted hover:text-white"
              }`}
            >
              <PlatformIcon platform={source.kind === "yt" ? "youtube" : "twitch"} size={12} />
              <span className="max-w-28 truncate">{label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted hover:bg-panel-2 hover:text-white"
          aria-label="チャットを閉じる"
        >
          <XIcon size={16} />
        </button>
      </div>
      {url ? (
        <iframe key={url} src={url} title="チャット" className="min-h-0 w-full flex-1 border-0 bg-panel" />
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted">
          チャットを表示できる配信がありません。
          <br />
          （YouTube のライブ / Twitch のチャンネルに対応）
        </div>
      )}
    </aside>
  );
}
