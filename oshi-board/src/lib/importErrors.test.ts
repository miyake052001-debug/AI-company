import { describe, expect, it } from "vitest";
import { importErrorMessage } from "./importErrors";

describe("importErrorMessage", () => {
  it("決まったコードはサービス名入りの文言にする", () => {
    expect(importErrorMessage("cancelled", "twitch")).toBe("Twitch へのログインがキャンセルされました");
    expect(importErrorMessage("disabled", "google")).toContain("Google ログインが設定されていません");
    expect(importErrorMessage("exchange", "google")).toContain("リダイレクトURL");
  });

  it("知らないコードや任意の文字列はそのまま表示しない", () => {
    expect(importErrorMessage("<script>偽のお知らせ</script>", "twitch")).toBe("取り込みに失敗しました。もう一度お試しください");
  });
});
