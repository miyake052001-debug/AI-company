const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 12345 → "1.2万" */
export function formatCount(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "";
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}億`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return n.toLocaleString("ja-JP");
}

export function formatDuration(sec: number | undefined): string {
  if (!sec || sec < 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** ISO 8601 の期間（"PT1H2M3S"）を秒に変換 */
export function parseIsoDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return undefined;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Math.round(Number(s ?? 0));
}

/** "3分前" / "2時間前" / "5日前" */
export function formatAgo(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}日前`;
  return `${Math.floor(d / 30)}ヶ月前`;
}

/** 配信経過時間 "1:23:45" */
export function formatElapsed(iso: string | undefined, now: number): string {
  if (!iso) return "";
  return formatDuration(Math.max(0, (now - Date.parse(iso)) / 1000)) || "0:00";
}

/** 予定時刻 "今日 21:00" / "明日 20:00" / "10/24(金) 19:00" */
export function formatSchedule(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const date = new Date(iso);
  const today = new Date(now);
  const dayDiff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (dayDiff === 0) return `今日 ${time}`;
  if (dayDiff === 1) return `明日 ${time}`;
  if (dayDiff === -1) return `昨日 ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]}) ${time}`;
}

/** 予定までの残り時間 "あと15分" / "まもなく" / "開始待ち" */
export function formatCountdown(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const diff = Date.parse(iso) - now;
  if (diff <= 0) return "開始待ち";
  const min = Math.ceil(diff / 60_000);
  if (min <= 1) return "まもなく";
  if (min < 60) return `あと${min}分`;
  const h = Math.floor(min / 60);
  if (h < 24) return `あと${h}時間${min % 60 ? `${min % 60}分` : ""}`;
  return `あと${Math.floor(h / 24)}日`;
}
