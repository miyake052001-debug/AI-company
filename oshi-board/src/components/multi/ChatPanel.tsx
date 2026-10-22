"use client";

import { chatUrl, parseSourceKey } from "@/lib/media";
import type { MultiItem } from "@/lib/client/state";
import { PlatformIcon, XIcon } from "../icons";

interface Props {
  items: { item: MultiItem; label: string }[];
  activeUid: string | null;
  host: string;
  onSelect: (uid: string) => void;
  onClose: () => void;
}

export function ChatPanel({ items, activeUid, host, onSelect, onClose }: Props) {
  const chats = items.filter(({ item }) => {
    const s = parseSourceKey(item.source);
    return s && chatUrl(s, host);
  });
  const active = chats.find(({ item }) => item.uid === activeUid) ?? chats[0];
  const activeSource = active ? parseSourceKey(active.item.source) : null;
  const url = activeSource ? chatUrl(activeSource, host) : null;

  return (
    <aside className="flex h-[55dvh] w-full shrink-0 flex-col border-t border-line bg-panel md:h-auto md:w-80 md:border-l md:border-t-0 xl:w-96">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <div className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {chats.map(({ item, label }) => {
            const s = parseSourceKey(item.source)!;
            const selected = item.uid === active?.item.uid;
            return (
              <button
                key={item.uid}
                type="button"
                onClick={() => onSelect(item.uid)}
                className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs ${
                  selected ? "bg-panel-2 text-white" : "text-muted hover:text-white"
                }`}
              >
                <PlatformIcon platform={s.kind === "yt" ? "youtube" : "twitch"} size={12} />
                <span className="max-w-28 truncate">{label}</span>
              </button>
            );
          })}
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
