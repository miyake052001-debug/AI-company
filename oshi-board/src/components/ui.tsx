"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import type { ProviderStatus } from "@/lib/types";

/* ---------- アバター ---------- */

function hue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export function Avatar({ name, url, size = 32 }: { name: string; url?: string; size?: number }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full bg-panel-2 object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue(name)} 55% 42%)` }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** サムネイルが無いとき（デモ・Twitch予定など）のプレースホルダー */
export function ThumbPlaceholder({ seed, children }: { seed: string; children?: ReactNode }) {
  const h = hue(seed);
  return (
    <div
      className="absolute inset-0 grid place-items-center"
      style={{ background: `linear-gradient(135deg, hsl(${h} 60% 28%), hsl(${(h + 50) % 360} 55% 16%))` }}
    >
      {children}
    </div>
  );
}

/* ---------- チップ ---------- */

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-accent/70 bg-accent/15 text-white"
          : "border-line bg-panel text-muted hover:border-muted/50 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------- お知らせ ---------- */

export function DemoNotice({ providers, needTwitch }: { providers?: ProviderStatus; needTwitch?: boolean }) {
  if (!providers) return null;
  const missing: string[] = [];
  if (!providers.youtube) missing.push("YouTube");
  if (needTwitch && !providers.twitch) missing.push("Twitch");
  if (missing.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
      <b>{missing.join(" / ")}</b> のAPIキーが未設定のため、<b>デモデータ</b>を表示しています。
      <code className="mx-1 rounded bg-black/30 px-1">.env.local</code>
      にキーを設定すると実際の配信が表示されます（手順は README）。
      マルチビューへのURL貼り付けはキーなしでも使えます。
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export function FollowLink() {
  return (
    <Link href="/channels" className="text-accent underline-offset-2 hover:underline">
      フォロー管理
    </Link>
  );
}

/* ---------- トースト ---------- */

let toastMessage: { id: number; text: string } | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();

export function toast(text: string) {
  toastMessage = { id: Date.now(), text };
  toastListeners.forEach((l) => l());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage = null;
    toastListeners.forEach((l) => l());
  }, 2200);
}

export function Toaster() {
  const message = useSyncExternalStore(
    (l) => {
      toastListeners.add(l);
      return () => toastListeners.delete(l);
    },
    () => toastMessage,
    () => null,
  );
  if (!message) return null;
  return (
    <div
      key={message.id}
      role="status"
      className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-panel-2 px-4 py-2 text-sm shadow-xl"
    >
      {message.text}
    </div>
  );
}
