# 推しボード（oshi-board）

YouTube と Twitch の VTuber 配信をまとめてチェックして、**2窓・4窓のマルチビュー**で同時視聴できる Web アプリです。**切り抜き**（YouTube の切り抜き動画 / Twitch クリップ）もまとめて見られます。

## できること

| 画面 | 内容 |
| --- | --- |
| **配信**（`/`） | フォロー中の VTuber の「配信中 / 予定 / アーカイブ（48時間以内）」を YouTube・Twitch 横断で一覧表示。プラットフォーム・事務所・お気に入りで絞り込み、キーワード検索。2分ごとに自動更新。カードをクリックするとマルチビューに追加 |
| **マルチビュー**（`/multi`） | 最大9窓。「均等」配置と「メイン＋サブ」配置を切り替え。16:9 を保ったまま画面サイズに合わせて最大化。URL の貼り付けで任意の YouTube / Twitch（ライブ・アーカイブ・クリップ）を追加。チャット欄の切り替え表示、並び替え、全画面、共有リンク（`/multi?s=yt:xxx,tw:yyy`） |
| **切り抜き**（`/clips`） | 選んだ VTuber（最大6人）の YouTube 切り抜きと Twitch クリップを新着順・再生数順で表示。期間（24時間/1週間/1ヶ月）・ショート除外。その場で再生、マルチビューへの追加も可 |
| **フォロー管理**（`/channels`） | チャンネルURL・@ハンドル・ID から追加／編集、お気に入り★、事務所プリセット（ホロライブ・にじさんじ・ぶいすぽっ！）から一括追加、JSON でエクスポート/インポート |

- ログイン不要。フォローやマルチビューの状態はブラウザ（localStorage）に保存されます。
- マルチビューの2枠目以降はミュートで始まります（音が重ならないように）。音量は各プレイヤーで調整できます。
- API キー未設定でも**デモデータ**で画面を確認できます。マルチビューへの URL 貼り付けはキーなしでも動きます。

## 起動

```bash
cd oshi-board
npm install
cp .env.example .env.local   # キーを入れる（あとからでもOK）
npm run dev                  # http://localhost:3000
```

その他のコマンド: `npm run build` / `npm start` / `npm test` / `npm run lint` / `npm run typecheck`

## API キーの取り方

### YouTube Data API v3（`YOUTUBE_API_KEY`）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「API とサービス」→「ライブラリ」で **YouTube Data API v3** を有効化
3. 「認証情報」→「認証情報を作成」→「API キー」
4. （推奨）キーの「API の制限」で YouTube Data API v3 のみに制限

無料枠は 1日 10,000 ユニット。このアプリは配信状況の判定を RSS（無料）＋ `videos.list`（50本で1ユニット）で行うので、数十チャンネルを2分ごとに更新しても枠内に収まります。

重いのは Holodex を使わない場合の切り抜き検索（`search.list`、1日100回程度が上限）です。チャンネル×期間ごとに検索結果をキャッシュし（24時間=新着順で3時間、1週間・1ヶ月=再生数順で12〜24時間）、1日の検索回数も `YOUTUBE_SEARCH_DAILY_LIMIT`（既定 80）で制限しています。上限に達したら前回の結果を表示します。切り抜きをたくさん見るなら Holodex のキーを入れるのがおすすめです。

### Twitch（`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`）

1. [Twitch Developer Console](https://dev.twitch.tv/console/apps) で「アプリケーションを登録」
2. OAuth のリダイレクト URL は `http://localhost`（このアプリでは使いません）、カテゴリは「Website Integration」
3. 作成後の「管理」画面で Client ID を確認し、「新しい秘密」で Client Secret を発行

### Holodex（任意・`HOLODEX_API_KEY`）

[Holodex](https://holodex.net) にログイン →「設定」→ API Key を発行。VTuber の切り抜きを元配信者に紐づけて管理しているサービスなので、YouTube 検索よりずっと正確に「その人の切り抜き」が取れます（クォータも消費しません）。

## デプロイ（Vercel）

1. Vercel でこのリポジトリをインポート
2. **Root Directory** を `oshi-board` に設定
3. Environment Variables に上のキーを登録してデプロイ

Twitch の埋め込みは HTTPS のページでしか動かないので、本番は必ず HTTPS で配信してください（Vercel なら自動）。

## 仕組み

```
ブラウザ（フォロー一覧は localStorage）
  └─ /api/streams?yt=UC..,UC..&tw=login,..   ← Next.js Route Handler（APIキーはサーバー側だけ）
        ├─ YouTube: チャンネルRSS → videos.list でライブ/予定/終了を判定
        └─ Twitch:  Helix /streams（配信中）+ /schedule（予定）
  └─ /api/clips?id=..&name=..&yt=..&tw=..&period=7d
        ├─ YouTube切り抜き: Holodex → なければ YouTube 検索「<名前> 切り抜き」
        └─ Twitch: Helix /clips（期間内の再生数上位）
  └─ /api/resolve（@ハンドル・URL → チャンネルID）, /api/meta（貼り付け動画のタイトル）
```

- サーバー側はプロセス内キャッシュ（`src/lib/server/cache.ts`）＋ CDN 向け `Cache-Control` でクォータを節約しています。存在しないチャンネルなどの失敗もキャッシュし、外部から叩ける高コストな呼び出しには回数上限を、API ルートには IP ごとの簡易レート制限（`src/lib/server/rateLimit.ts`）をかけています。
- マルチビューは iframe を DOM 上で動かすと再読み込みされるので、描画順は固定して位置（absolute）だけを変えています（`src/components/multi/MultiView.tsx`）。
- Next.js 16 の Cache Components では、別ページに移っても前のページが非表示のまま残ります（React の Activity）。iframe は非表示でも音が鳴り続けるので、マルチビューと切り抜きプレイヤーは非表示になったら iframe を外しています（戻ると読み込み直します）。

## 注意・既知の制限

- 配信者が「埋め込み無効」にしている配信や、メンバー限定配信はマルチビューで再生できないことがあります（各プレイヤーの ↗ から元ページで開けます）。
- プリセットのチャンネルID・Twitch ID は公開情報からの手入力です。卒業・移籍などで古くなっている場合は、フォロー管理で ⚠ が付くので編集してください。
- YouTube のチャットに書き込むには、ブラウザで YouTube にログインしている必要があります（サードパーティ Cookie の設定によっては表示のみになります）。
- Twitch の埋め込みプレイヤーは 400×300 より小さいと自動再生されません。4窓以上で枠が小さくなったら ▶ を押してください。
- YouTube の切り抜きは YouTube チャンネルを登録した人だけが対象です（Twitch だけの人は Twitch クリップのみ）。

## 今後の拡張案

- Twitch / YouTube アカウントでログインして、フォロー・登録チャンネルを自動取り込み
- 配信開始のプッシュ通知（PWA）
- 切り抜きチャンネルの登録（RSS で無料取得）
- マルチビューの音声コントロール（ソロ再生・一括ミュート）
