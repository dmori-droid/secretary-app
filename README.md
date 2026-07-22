# 秘書アプリ

自分専用のシンプルな秘書アプリです。メモ・タスク管理・週次の振り返りを、ブラウザから操作できます。
**Cloudflare Pages + D1（データベース）** で動作し、ログインパスワードで保護されています。

## 機能

- **ダッシュボード**: メモ件数 / タスク件数 / 未完了タスク件数 / 最新の振り返り
- **メモ**: タイトルと本文で追加、一覧表示（作成日時）、削除
- **タスク**: 追加、一覧表示、完了/未完了の切り替え、削除
- **週次の振り返り**: 週ごとにコメントを記録（同じ週は上書き更新）、一覧表示、削除
- **ログイン**: パスワードで保護（未ログインでは中身を見られません）
- **保存**: データは Cloudflare D1 に保存されます

## 構成

| ファイル | 役割 |
|---|---|
| `public/index.html` | 画面（ログイン・ダッシュボード・メモ・タスク・振り返り） |
| `functions/api/[[path]].js` | API（Pages Functions）。D1への読み書きと認証 |
| `schema.sql` | D1 のテーブル定義 |
| `wrangler.toml` | Cloudflare 設定（D1 バインディング） |
| `.dev.vars.example` | ローカル用の環境変数サンプル |

## 必要な環境変数（Cloudflare側で設定）

| 変数名 | 用途 |
|---|---|
| `APP_PASSWORD` | ログインパスワード |
| `AUTH_SECRET` | セッションCookieの署名に使うランダムな秘密文字列 |

## ローカルで動かす

```bash
npm install                 # 初回のみ（wrangler を導入）
cp .dev.vars.example .dev.vars   # 値を自分で設定
npm run db:init:local       # ローカルD1にテーブルを作成
npm run dev                 # http://localhost:8788 で起動
```

## Cloudflare へのデプロイ

デプロイ手順は、プロジェクトを作成したときの案内、または以下の概要を参照してください。

1. D1 データベースを作成し、`schema.sql` を適用する
2. Cloudflare Pages プロジェクトを GitHub リポジトリと連携させる
3. Pages プロジェクトに D1 バインディング（`DB`）と環境変数（`APP_PASSWORD`, `AUTH_SECRET`）を設定する
4. デプロイ
