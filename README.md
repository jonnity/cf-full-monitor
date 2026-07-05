# cf-full-monitor
Cloudflareにおける特定プロジェクトの無料枠の利用状況を定期的にチェックする。

## 仕組み

- Cloudflare Workers の Cron Trigger（毎時0分）で実行
- Cloudflare GraphQL API / REST API でメトリクスを取得
- 結果を Discord Webhook に通知
- インフラ管理は [Alchemy](https://github.com/sam-goodwin/alchemy) を使用

## セットアップ

`.env` を作成し、以下を設定する：

```
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
ENVIRONMENT_NAMES=staging,prod   # カンマ区切りで複数環境を指定

# 各環境ごとに以下を設定（例: STAGING, PROD）
STAGING_SCRIPT_NAME=...
STAGING_D1_DB_ID=...
STAGING_DISCORD_WEBHOOK_URL=...

PROD_SCRIPT_NAME=...
PROD_D1_DB_ID=...
PROD_DISCORD_WEBHOOK_URL=...
```

## デプロイ

> **⚠️ `wrangler deploy` は使わない。**
> `wrangler deploy` は `wrangler.jsonc` の設定でWorkerを上書きするため、
> Alchemy が管理している変数バインディング（`ENVIRONMENT_NAMES`、`*_SCRIPT_NAME` 等）が消える。

必ず Alchemy 経由でデプロイする：

```bash
export $(grep -v '^#' .env | xargs) && npx tsx infra/index.ts
```

## インフラの破棄

```bash
export $(grep -v '^#' .env | xargs) && npx tsx infra/index.ts --destroy
```
