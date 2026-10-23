# 推しボード（oshi-board）

YouTube と Twitch の VTuber 配信をまとめてチェックして、**2窓・4窓のマルチビュー**で同時視聴できる Web アプリです。**切り抜き**（YouTube の切り抜き動画 / Twitch クリップ）もまとめて見られます。

## できること

| 画面 | 内容 |
| --- | --- |
| **配信**（`/`） | フォロー中の VTuber・配信者の「配信中 / 予定 / アーカイブ（48時間以内）」を YouTube・Twitch 横断で一覧表示。プラットフォーム・事務所・お気に入りで絞り込み、キーワード検索。2分ごとに自動更新。カードをクリックするとマルチビューに追加。数百チャンネルのフォローにも対応（100件ずつに分けて取得） |
| **見つける**（`/discover`） | フォローしていなくても、いま配信中の VTuber（Holodex）と日本語の Twitch 配信（視聴者数順）を一覧表示。事務所・ゲームで絞り込み、ワンタップでフォロー |
| **マルチビュー**（`/multi`） | 最大9窓。「均等」配置と「メイン＋サブ」配置を切り替え。16:9 を保ったまま画面サイズに合わせて最大化。URL の貼り付けで任意の YouTube / Twitch（ライブ・アーカイブ・クリップ）を追加。チャット欄の切り替え表示、並び替え、全画面、共有リンク（`/multi?s=yt:xxx,tw:yyy`） |
| **切り抜き**（`/clips`） | 選んだ VTuber（最大6人）の YouTube 切り抜きと Twitch クリップを新着順・再生数順で表示。期間（24時間/1週間/1ヶ月）・ショート除外。その場で再生、マルチビューへの追加も可 |
| **フォロー管理**（`/channels`） | Twitch のフォロー・YouTube の登録チャンネルをまとめて取り込み（ログイン、または Google Takeout の CSV）。チャンネルURL・@ハンドル・ID から追加／編集、お気に入り★、事務所プリセット（ホロライブ・にじさんじ・ぶいすぽっ！）から一括追加、JSON でエクスポート/インポート |

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

1. [Twitch Developer Console](https://dev.twitch.tv/console/apps) で「アプリケーションを登録」（Twitch アカウントの2段階認証が必要）
2. OAuth のリダイレクト URL に次を登録（「フォローを取り込む」で使います。複数登録できます）
   - `https://<公開URL>/api/auth/twitch/callback`（例: `https://oshi-board.vercel.app/api/auth/twitch/callback`）
   - 手元で試すなら `http://localhost:3000/api/auth/twitch/callback`
3. カテゴリは「Website Integration」、クライアントタイプは「機密（Confidential）」
4. 作成後の「管理」画面で Client ID を確認し、「新しい秘密」で Client Secret を発行

### Holodex（任意・`HOLODEX_API_KEY`）

[Holodex](https://holodex.net) にログイン →「設定」→ API Key を発行。VTuber の切り抜きを元配信者に紐づけて管理しているサービスなので、YouTube 検索よりずっと正確に「その人の切り抜き」が取れます（クォータも消費しません）。「見つける」タブの「いま配信中の VTuber」一覧にも使います。

### Google ログイン（任意・`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`）

YouTube の登録チャンネルを「Google でログイン」して取り込むときだけ必要です（CSV で取り込むなら不要）。YouTube の API キーと同じ Google Cloud のプロジェクトで設定します。

1. 「API とサービス」→「OAuth 同意画面」（Google Auth Platform）で、ユーザーの種類「外部」を選んでアプリ名などを入力
2. 「対象」でテストユーザーに **自分の Google アカウント** を追加（公開ステータスは「テスト」のままで大丈夫。審査は不要で、ログイン時に「未確認のアプリ」と出たら「続行」）
   - 「テスト」の間は、**ここに登録したアカウント（最大100件）だけ** が Google ログインで取り込めます。家族や友だちにも使ってもらうなら、その人のアカウントも追加してください。それ以外の人は CSV で取り込めます
   - 誰でも使えるように一般公開するには、アプリを「本番」にして Google の審査（YouTube の読み取り権限は審査が必要な権限です）を通す必要があります
3. 「データアクセス」でスコープ `https://www.googleapis.com/auth/youtube.readonly` を追加
4. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」→ 種類「ウェブ アプリケーション」
   - 承認済みのリダイレクト URI: `https://<公開URL>/api/auth/google/callback`（手元なら `http://localhost:3000/api/auth/google/callback`）
5. 表示されたクライアント ID とクライアント シークレットを `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` に設定

取り込みのときだけ読み取り専用の権限を使い、終わったらすぐ権限を取り消します（アプリ側にログイン情報は残りません）。

### Google Takeout の CSV（設定不要）

1. [Google Takeout](https://takeout.google.com) で「選択をすべて解除」→「YouTube と YouTube Music」だけ選ぶ
2. 「すべての YouTube データが含まれます」を押して「登録チャンネル」だけにチェック → エクスポート
3. ダウンロードした zip の中の「登録チャンネル.csv」（英語なら `subscriptions.csv`）を、フォロー管理の「登録チャンネルの CSV」で選ぶ

## デプロイ（Vercel）

1. Vercel でこのリポジトリをインポート
2. **Root Directory** を `oshi-board` に設定
3. Environment Variables に上のキーを登録してデプロイ
4. Twitch アプリ / Google の OAuth クライアントに、公開URLのリダイレクトURL（上の手順）を追加

プレビューデプロイなど別のURLで取り込みを使う場合は、そのURLのリダイレクトURLも登録してください。

**Vercel 以外**（`next start`・Docker・Render・Railway など）で動かす場合は、`APP_URL` に公開URL（例: `https://board.example.com`、`https://` から）を必ず設定してください。設定しないとログイン後の戻り先が `localhost` になり、取り込みが失敗します。Twitch・Google に登録するリダイレクトURLも、この `APP_URL` から始まるものにします。

Twitch の埋め込みは HTTPS のページでしか動かないので、本番は必ず HTTPS で配信してください（Vercel なら自動）。

API には IP ごとの簡易レート制限があります。接続元IPは、クライアントが書き換えられない値だけから取ります（`src/lib/server/rateLimit.ts`）。

- **Vercel**: 設定不要（Vercel が上書きするヘッダーを使います）。`TRUSTED_IP_HEADER` は Vercel 上では使いません。`*.vercel.app` に直接アクセスされると偽装できてしまうためです。そのため Cloudflare などを Vercel の前に置くと、IPごとの制限は Cloudflare の中継サーバー単位になります。
- **自分のサーバー**: プロキシを前に置き、接続元を `X-Forwarded-For` に付けてください。既定では右端（直前のプロキシが付けた値）を使います。nginx なら次の1行です。
  ```nginx
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  ```
  - `TRUSTED_IP_HEADER`: プロキシが必ず上書きするヘッダーを使いたい場合に指定します。例: nginx で `proxy_set_header X-Real-IP $remote_addr;` としているなら `x-real-ip`、Cloudflare Tunnel なら `cf-connecting-ip`。プロキシがクライアントの値をそのまま通すヘッダー（Caddy の既定の `X-Real-IP` など）は指定しないでください。
  - `TRUST_PROXY_HOPS`: 手前に並んでいるプロキシの数です（CDN → nginx なら `2`。既定 `1`）。
  - nginx で `X-Real-IP` だけを設定している場合は、上の1行を足すか `TRUSTED_IP_HEADER=x-real-ip` を設定してください（どちらもないと全員がプロキシのアドレスに見えて同じ制限を共有します。サーバーのログに警告が出ます）。
  - プロキシなしで `next start` すると、クライアントが `X-Forwarded-For` を偽装して制限をすり抜けられます。

IP ごとの制限とは別に、次の高コストな呼び出しにはサーバー全体の上限があります。

- YouTube の切り抜き検索
- YouTube のチャンネルURLの解決と、チャンネル名・アイコンの取得
- YouTube の RSS が使えないときの代替取得
- Twitch の予定取得

ただし、配信状況の取得（`videos.list`）は全体の上限なしで動きます（存在するチャンネルの動画だけが対象です）。一般公開して不特定多数に使わせる場合は、プロキシの設定を正しく行ってください。

## 仕組み

```
ブラウザ（フォロー一覧は localStorage）
  └─ /api/streams?yt=UC..,UC..&tw=login,..   ← Next.js Route Handler（APIキーはサーバー側だけ）
        ├─ YouTube: チャンネルRSS → videos.list でライブ/予定/終了を判定
        └─ Twitch:  Helix /streams（配信中）+ /schedule（予定）
  └─ /api/clips?id=..&name=..&yt=..&tw=..&period=7d
        ├─ YouTube切り抜き: Holodex → なければ YouTube 検索「<名前> 切り抜き」
        └─ Twitch: Helix /clips（期間内の再生数上位）
  └─ /api/discover（見つける）
        ├─ Holodex /live（配信中の VTuber）
        └─ Twitch: Helix /streams?language=ja（日本語の配信・視聴者数順）
  └─ /api/auth/{twitch,google}/start → callback → /api/import/{twitch,google}（フォローの取り込み）
  └─ /api/resolve（@ハンドル・URL → チャンネルID）, /api/meta（貼り付け動画のタイトル）
```

- フォローの取り込みは OAuth の認可コードフローです。アクセストークンは取り込み API にしか送られない HttpOnly cookie に10分だけ置き、一覧を取ったらすぐ失効させて消します。

- サーバー側はプロセス内キャッシュ（`src/lib/server/cache.ts`）＋ CDN 向け `Cache-Control` でクォータを節約しています。存在しないチャンネルなどの失敗もキャッシュし、外部から叩ける高コストな呼び出しには回数上限を、API ルートには IP ごとの簡易レート制限（`src/lib/server/rateLimit.ts`）をかけています。
- マルチビューは iframe を DOM 上で動かすと再読み込みされるので、描画順は固定して位置（absolute）だけを変えています（`src/components/multi/MultiView.tsx`）。
- Next.js 16 の Cache Components では、別ページに移っても前のページが非表示のまま残ります（React の Activity）。iframe は非表示でも音が鳴り続けるので、マルチビューと切り抜きプレイヤーは非表示になったら iframe を外しています（戻ると読み込み直します）。

## 注意・既知の制限

- 配信者が「埋め込み無効」にしている配信や、メンバー限定配信はマルチビューで再生できないことがあります（各プレイヤーの ↗ から元ページで開けます）。
- プリセットのチャンネルID・Twitch ID は公開情報からの手入力です。卒業・移籍などで古くなっている場合は、フォロー管理で ⚠ が付くので編集してください。
- YouTube のチャットに書き込むには、ブラウザで YouTube にログインしている必要があります（サードパーティ Cookie の設定によっては表示のみになります）。
- Twitch の埋め込みプレイヤーは 400×300 より小さいと自動再生されません。4窓以上で枠が小さくなったら ▶ を押してください。
- YouTube の切り抜きは YouTube チャンネルを登録した人だけが対象です（Twitch だけの人は Twitch クリップのみ）。
- 「見つける」の YouTube 側は Holodex が追跡している VTuber だけです。YouTube の一般の配信者の「いま配信中」一覧は、API の利用枠の都合で作れません（フォローすれば配信一覧に出ます）。
- 取り込みは Twitch 1000人・YouTube 2000チャンネルまでです。同じ人の YouTube と Twitch は別々に登録されます（必要ならフォロー管理で1つにまとめてください）。

## 今後の拡張案

- 配信開始のプッシュ通知（PWA）
- 切り抜きチャンネルの登録（RSS で無料取得）
- マルチビューの音声コントロール（ソロ再生・一括ミュート）
