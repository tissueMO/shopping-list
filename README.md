# Slack連動買い物リスト アプリケーション

Slackの指定したチャンネルの投稿を「1投稿＝1アイテム」とみなして連動する、スマートフォン向けの買い物リストWebアプリケーションです。

## 主な機能

- **Slack双方向連携**:
  - 表示時にSlackチャンネル内のメッセージ履歴（`:heavy_check_mark:` リアクションがついていないもの）を取得して一覧表示（デフォルトは投稿日時の昇順）。
  - アプリ上でチェックしたアイテムをまとめて「購入済み」にすると、Slackの該当メッセージに自動で `:heavy_check_mark:` リアクションを付与し、リストから非表示化。
- **マルチユーザー同期**:
  - 複数ユーザーが同時に触っている場合でも、10秒間隔の自動ポーリングによって他のユーザーのチェック状態を即座に同期。
- **AI陳列順ソート**:
  - OpenAI API（`gpt-5-mini` デフォルト、その他 `o3-mini` など思考モデル対応）を活用し、アイテムを「一般的なスーパーマーケットの入店からレジへの導線」に基づいた陳列カテゴリ（野菜・果物、精肉、鮮魚など）に自動で分類・グループ化して表示。
- **スマートフォン特化 & ミニマルデザイン**:
  - 片手で操作しやすい大ぶりのタッチターゲットと、白・黒・グレーを基調としたミニマルで洗練されたモノトーンデザイン。

---

## 事前準備

### 1. Slackアプリの作成と設定

1. [Slack API Control Panel](https://api.slack.com/apps) から新しいアプリを作成します。
2. **OAuth & Permissions** メニューに移動し、**Bot Token Scopes** に以下の権限を追加します。
   - `channels:history` （パブリックチャンネルの場合。プライベートチャンネルなら `groups:history` も必要）
   - `reactions:write` （購入済みアイテムにチェックマークリアクションを付与するため）
   - `users:read` （投稿ユーザーの表示名を取得するため）
3. **Install to Workspace** をクリックし、ワークスペースにアプリをインストールします。表示された **Bot User OAuth Token** (`xoxb-...`) を控えておきます。
4. 対象とするSlackチャンネルに、作成したアプリをインポート（`/invite @アプリ名` コマンド等）します。
5. チャンネルのURLや設定から **チャンネルID** (`C...`) を取得し、控えておきます。

### 2. OpenAI APIキーの取得

1. OpenAIのアカウントから APIキー (`sk-...`) を取得し、控えておきます。

---

## 環境変数の設定

プロジェクトルート直下に `.env` ファイルを作成し、以下の変数を定義します（`.env.example` を参考にしてください）。

```bash
# Slack 設定
NUXT_SLACK_BOT_TOKEN=xoxb-your-bot-token
NUXT_SLACK_CHANNEL_ID=C0000000000

# OpenAI 設定
NUXT_OPENAI_API_KEY=sk-your-openai-key
NUXT_OPENAI_MODEL=gpt-5-mini # o3-mini などの思考モデルも指定可能

# サブディレクトリ配信（リバースプロキシ等）を行う場合のベースパス（任意、デフォルト: /）
# 例: NUXT_APP_BASE_URL=/shopping-list
NUXT_APP_BASE_URL=/
```

> [!WARNING]
> `.env` には機微情報が含まれるため、絶対に公開リポジトリにコミットしないでください（`.gitignore` に登録されています）。

---

## 起動手順 (Docker)

本プロジェクトはパッケージ管理ツールの実行やサーバーの起動をすべてコンテナ内で完結できるように設計されています。

### 開発環境の起動（ホットリロード対応）

以下のコマンドを実行すると、開発環境のコンテナがビルドされ、自動的に `npm install` が実行された後にサーバーが立ち上がります。

```bash
docker compose up app
```

- 開発用アクセスURL: [http://localhost:3010](http://localhost:3010)
- ホスト側のソースコード変更は即座にコンテナ内に反映され、ホットリロード（HMR）が動作します。

### 本番環境の起動確認

本番環境向けのマルチステージビルドをシミュレートし、スタンドアロンビルドされたSSRサーバーを起動します。

```bash
docker build -t shopping-list-production --target production .
docker run -d -p 3011:3000 --env-file .env --name shopping-list-production shopping-list-production
```

- 本番動作用アクセスURL: [http://localhost:3011](http://localhost:3011)

### パッケージの追加やコンテナ内でのコマンド実行

依存関係の追加など、シェルコマンドを実行する際は必ずコンテナ内で行ってください。

```bash
# 例：パッケージのインストール
docker compose run --rm app npm install <package_name>
```
