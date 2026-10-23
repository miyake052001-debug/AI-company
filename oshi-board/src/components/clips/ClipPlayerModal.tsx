"use client";

import { useEffect } from "react";
import { useMulti } from "@/lib/client/state";
import { useHost } from "@/lib/client/store";
import { embedUrl, parseSourceKey } from "@/lib/media";
import type { Clip } from "@/lib/types";
import { CheckIcon, ExternalIcon, PlusIcon, XIcon } from "../icons";
import { toggleInMulti } from "../MultiDock";

export function ClipPlayerModal({ clip, talentName, onClose }: { clip: Clip; talentName?: string; onClose: () => void }) {
  const host = useHost();
  const multi = useMulti();
  const source = parseSourceKey(clip.source);
  const url = source && host ? embedUrl(source, { host, muted: false }) : null;
  const added = multi.some((m) => m.source === clip.source);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-3" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-5xl overflow-hidden rounded-xl border border-line bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="aspect-video bg-black">
          {url ? (
            <iframe
              src={url}
              title={clip.title}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              className="size-full border-0"
            />
          ) : (
            <div className="grid size-full place-items-center text-sm text-muted">
              デモデータのため再生できません。APIキーを設定すると実際の切り抜きが再生されます。
            </div>
          )}
        </div>
        <div className="flex items-start gap-3 p-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-medium leading-snug">{clip.title}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {clip.channelName}
              {talentName && ` ・ ${talentName}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => toggleInMulti({ source: clip.source, label: talentName ?? clip.channelName, title: clip.title, chat: false })}
            className={`flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-sm ${
              added ? "bg-accent text-white" : "border border-line hover:border-muted/60"
            }`}
          >
            {added ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
            マルチビュー
          </button>
          {!clip.demo && (
            <a
              href={clip.url}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-muted/60"
            >
              <ExternalIcon size={14} />
              開く
            </a>
          )}
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-panel-2 hover:text-white" aria-label="閉じる">
            <XIcon size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
