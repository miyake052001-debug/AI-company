"use client";

import { formatAgo, formatCount, formatCountdown, formatElapsed, formatSchedule } from "@/lib/format";
import type { Stream, Talent } from "@/lib/types";
import { CheckIcon, ExternalIcon, PlatformIcon, PlusIcon } from "./icons";
import { Avatar, ThumbPlaceholder } from "./ui";

interface Props {
  stream: Stream;
  talent?: Talent;
  selected: boolean;
  now: number | null;
  onToggle: () => void;
}

export function StreamCard({ stream, talent, selected, now, onToggle }: Props) {
  const name = talent?.name ?? stream.channelName;
  const avatar = stream.avatarUrl ?? talent?.avatarUrl;

  return (
    <article className="group flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        title={selected ? "マルチビューから外す" : "マルチビューに追加"}
        className={`relative aspect-video overflow-hidden rounded-lg bg-panel-2 text-left outline-offset-2 transition ${
          selected ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-muted/60"
        }`}
      >
        {stream.thumbnailUrl ? (
          <img
            src={stream.thumbnailUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <ThumbPlaceholder seed={stream.channelId}>
            <span className="px-4 text-center text-sm font-bold text-white/80">{name}</span>
          </ThumbPlaceholder>
        )}

        <span
          className={`absolute inset-0 grid place-items-center bg-black/45 transition-opacity ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <span
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white ${
              selected ? "bg-accent" : "bg-black/70"
            }`}
          >
            {selected ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
            {selected ? "マルチビューに追加済み" : "マルチビューに追加"}
          </span>
        </span>

        <div className="absolute left-2 top-2 flex items-center gap-1.5">
          {stream.status === "live" && (
            <span className="flex items-center gap-1 rounded bg-live px-1.5 py-0.5 text-[11px] font-bold text-white">
              <span className="live-dot size-1.5 rounded-full bg-white" />
              LIVE
            </span>
          )}
          {stream.status === "upcoming" && (
            <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-bold text-white">予定</span>
          )}
          {stream.status === "ended" && (
            <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] font-bold text-white">アーカイブ</span>
          )}
          {stream.viewers !== undefined && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
              {formatCount(stream.viewers)}人
            </span>
          )}
        </div>

        {now !== null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] text-white">
            {stream.status === "live" && formatElapsed(stream.startAt, now)}
            {stream.status === "upcoming" && `${formatSchedule(stream.startAt, now)}・${formatCountdown(stream.startAt, now)}`}
            {stream.status === "ended" && formatAgo(stream.endAt ?? stream.startAt, now)}
          </span>
        )}

      </button>

      <div className="flex gap-2.5">
        <Avatar name={name} url={avatar} size={34} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm leading-snug font-medium" title={stream.title}>
            {stream.title}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <PlatformIcon platform={stream.platform} size={13} />
            <span className="truncate">{name}</span>
            {talent?.group && <span className="shrink-0 truncate">・{talent.group}</span>}
          </div>
          {stream.category && <div className="mt-0.5 truncate text-xs text-muted/80">{stream.category}</div>}
        </div>
        {!stream.demo && (
          <a
            href={stream.url}
            target="_blank"
            rel="noreferrer"
            title="配信ページを開く"
            className="h-fit shrink-0 rounded p-1 text-muted hover:bg-panel-2 hover:text-white"
          >
            <ExternalIcon size={14} />
          </a>
        )}
      </div>
    </article>
  );
}
