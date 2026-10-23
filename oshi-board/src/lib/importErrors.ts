/** 取り込み画面に返すエラーの種類（画面側で決まった文言に置き換える。任意の文字列は表示しない） */
export type ImportErrorCode = "disabled" | "cancelled" | "state" | "exchange";

/** 取り込みのエラーコード → 表示する文言（知らないコードは汎用の文言にする） */
export function importErrorMessage(code: string, provider: string | null): string {
  const name = provider === "google" ? "Google" : provider === "twitch" ? "Twitch" : "ログイン";
  switch (code) {
    case "disabled":
      return provider === "google"
        ? "Google ログインが設定されていません（README 参照）"
        : "Twitch の API キーが設定されていません（README 参照）";
    case "cancelled":
      return `${name} へのログインがキャンセルされました`;
    case "state":
      return "ログインの確認に失敗しました。もう一度お試しください";
    case "exchange":
      return `${name} へのログインに失敗しました（リダイレクトURLの設定を確認してください）`;
    default:
      return "取り込みに失敗しました。もう一度お試しください";
  }
}
