"use client";

import { useRef } from "react";
import { usePolling } from "@/lib/client/usePolling";
import { parseSubscriptionsCsv } from "@/lib/takeout";
import type { ImportCandidate, ProviderStatus } from "@/lib/types";
import { TwitchIcon, YouTubeIcon } from "../icons";
import { toast } from "../ui";

interface Props {
  onCandidates: (title: string, candidates: ImportCandidate[], defaultGroup?: string) => void;
}

/** Twitch のフォロー / YouTube の登録チャンネルをまとめて取り込む */
export function ImportPanel({ onCandidates }: Props) {
  const { data: status } = usePolling<ProviderStatus>("/api/status", 10 * 60_000);
  const csvRef = useRef<HTMLInputElement>(null);

  const readCsv = async (file: File) => {
    const candidates = parseSubscriptionsCsv(await file.text());
    if (candidates.length === 0) {
      toast("登録チャンネルが見つかりませんでした。Google Takeout の「登録チャンネル」の CSV を選んでください");
      return;
    }
    onCandidates("YouTube の登録チャンネル（CSV）", candidates);
  };

  const button =
    "flex items-center justify-center gap-2 rounded-lg border border-line bg-bg px-3 py-2.5 text-sm hover:border-muted/60";
  const disabled = "pointer-events-none opacity-40";

  return (
    <section className="mt-5 rounded-xl border border-line bg-panel p-4">
      <h2 className="font-bold">フォローをまとめて取り込む</h2>
      <p className="text-xs text-muted">
        いつも見ている人をまとめて登録できます。取り込む前に一覧で確認できます。ログイン情報はこのアプリに保存されません。
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <a href="/api/auth/twitch/start" className={`${button} ${status && !status.twitch ? disabled : ""}`}>
          <TwitchIcon size={16} /> Twitch のフォロー
        </a>
        <a href="/api/auth/google/start" className={`${button} ${status && !status.googleLogin ? disabled : ""}`}>
          <YouTubeIcon size={16} /> YouTube の登録チャンネル
        </a>
        <button type="button" onClick={() => csvRef.current?.click()} className={button}>
          <YouTubeIcon size={16} /> 登録チャンネルの CSV
        </button>
        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readCsv(file);
            e.target.value = "";
          }}
        />
      </div>
      <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
        {status && !status.twitch && <li>・Twitch のフォロー取り込みには Twitch の API キーの設定が必要です（README 参照）</li>}
        {status && !status.googleLogin && (
          <li>・YouTube の登録チャンネルを Google ログインで取り込むには Google の OAuth 設定が必要です（README 参照）</li>
        )}
        <li>
          ・CSV は Google Takeout（takeout.google.com）で「YouTube と YouTube Music」→「登録チャンネル」だけを選んでダウンロードしたものを使います（設定不要）
        </li>
      </ul>
    </section>
  );
}
