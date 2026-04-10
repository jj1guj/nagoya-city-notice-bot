# nagoya-city-notice-bot

名古屋市公式 RSS を監視し、新着のお知らせを Misskey に投稿する Cloudflare Workers ボットです。

差分投稿で取りこぼしを最小化するために、以下を利用しています。

- Cloudflare KV: 投稿済みアイテムの記録
- Durable Object: 同時実行時の排他制御

## 仕組み

1. Cron で定期実行（現在は 1 分ごと）
2. RSS 全件を取得
3. 各 item の link をキー化し、KV に投稿済みか照会
4. 未投稿のみ Misskey へ投稿
5. 投稿成功後に KV へ記録

## 必要要件

- Node.js 20 以上（推奨）
- npm
- Cloudflare アカウント
- Wrangler CLI（`npm run deploy` で利用）
- Misskey アクセストークン

## セットアップ

### 1. 依存関係をインストール

```bash
npm install
```

### 2. Cloudflare にログイン

```bash
npx wrangler login
```

### 3. KV Namespace を作成

本番用:

```bash
npx wrangler kv namespace create POSTED_ITEMS
```

プレビュー用:

```bash
npx wrangler kv namespace create POSTED_ITEMS --preview
```

出力された `id` / `preview_id` を `wrangler.toml` の以下へ反映してください。

- `REPLACE_WITH_KV_NAMESPACE_ID`
- `REPLACE_WITH_KV_PREVIEW_NAMESPACE_ID`

### 4. Misskey トークンを Secret に設定

`wrangler.toml` に平文で置くのではなく Secret を使うことを推奨します。

```bash
npx wrangler secret put MISSKEY_TOKEN
```

補足:

- `wrangler.toml` の `[vars]` に `MISSKEY_TOKEN` がある場合は削除して運用してください。
- `MISSKEY_HOST` は `[vars]` のままで問題ありません。

## デプロイ

```bash
npm run deploy
```

## テスト

```bash
npm test -- --run
```

## 主要設定

`wrangler.toml`:

- `name`: Worker 名
- `triggers.crons`: 実行間隔（現在 `*/1 * * * *`）
- `vars.RSS_URL`: 監視対象 RSS URL
- `vars.MISSKEY_HOST`: 投稿先 Misskey ホスト
- `kv_namespaces`: 投稿済み管理の KV
- `durable_objects.bindings`: 排他制御用 Durable Object
- `migrations`: Durable Object クラスのマイグレーション

## 運用メモ

- この実装は「未投稿差分」を投稿するため、時刻ずれに強い構成です。
- RSS 提供側が item を削除/差し替えした場合の挙動は提供側仕様に依存します。
- 初回デプロイ時は RSS の未投稿分をまとめて投稿するため、必要なら運用前にシード処理を検討してください。

## ライセンス

MIT License.
