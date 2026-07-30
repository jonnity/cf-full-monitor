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

# 任意: HTTPステータスコードベースの5xx検知（httpRequestsAdaptiveGroups）を有効にする場合、
# 環境ごとに両方セットする（片方だけでは無効のまま）。
# STAGING_ZONE_ID=...   # 対象ゾーンのZone ID（ゾーン名ではなく16進のID）
# STAGING_HOSTNAME=...  # 例: oogiri-doc-staging.jonnity.com
# PROD_ZONE_ID=...
# PROD_HOSTNAME=...     # 例: oogiri-doc.jonnity.com
```

`*_ZONE_ID` / `*_HOSTNAME` は、Workerランタイム内で捕捉済みの例外（`console.error` してから正常な
`Response` として500を返すケース）を検知するための指標。既存の `workersInvocationsAdaptive.errors`
（Discord通知の「Worker invocation errors」）は未捕捉例外のみを数えるため、アプリ側でエラーハンドリング
してから500を返した場合は増加しない。両方の指標を見て初めて「クライアントに実際に返っている5xx」を
網羅できる。

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
