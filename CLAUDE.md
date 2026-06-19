# CLAUDE.md

Cloudflare の無料枠使用状況を定期チェックし Discord に通知する Workers プロジェクト。

## 方針

- **自動テストは追加しない。** テストファイル・テストスクリプト・テストフレームワークを導入しないこと。テストの追加を必須フォローアップとして提案しない。
- 変更の検証は `npm run typecheck` で行う。

## デプロイ

Alchemy でデプロイする。`.env` に認証情報と環境別バインディングを設定したうえで実行する。

```bash
npm run deploy    # デプロイ / 更新
npm run destroy   # 削除
```

### API トークンに必要な権限

`.env` の `CLOUDFLARE_API_TOKEN` には以下が必要（不足すると `401 [10000] Authentication error`）。

- **Account → Workers KV Storage → Edit**（メトリクス保存用 KV namespace `cf-monitor-metrics` の作成・更新）
- **Account → Workers Scripts → Edit**（Worker 本体のデプロイ）
- Analytics 取得用に GraphQL/Analytics の Read 権限
