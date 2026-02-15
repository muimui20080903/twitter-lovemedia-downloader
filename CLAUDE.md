# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

Twitterのいいね欄、ブックマーク、メディア欄、ツイートから画像・動画を自動ダウンロードするDenoアプリケーション。Cookie認証を使用して鍵垢のメディアも取得可能。systemd timerによる定期実行に対応。

## 主要コマンド

### 実行
```bash
deno task start
```
メインプログラムを実行。以下の権限が必要：
- `--allow-read`: config.json読み込み
- `--allow-net`: Twitter API通信
- `--allow-env`: 環境変数アクセス
- `--allow-write`: メディア保存
- `--allow-ffi`: SQLite3ライブラリ使用
- `--unstable-ffi`: FFI機能使用

### テスト
```bash
deno task test
```
ユニットテストを実行。`tests/`ディレクトリ内の全テストファイルを対象。

### ユーザーID取得
```bash
deno run --allow-net getUserIDByUserScreenName.ts <username>
```
例: `deno run --allow-net getUserIDByUserScreenName.ts elonmusk`

スクリーンネームからユーザーIDを取得。config.jsonに設定するuserIdの取得に使用。

### 開発モード
```bash
deno task dev
```
ファイル変更を監視して自動再実行（`--watch`フラグ使用）。

## アーキテクチャ

### ディレクトリ構造

```
twitter-lovemedia-downloader/
├── src/
│   ├── main.ts                # エントリーポイント
│   ├── types/
│   │   └── index.ts           # 型定義（MediaInfo, UserConfig, AppConfig等）
│   ├── constants/
│   │   └── index.ts           # 定数（API_TIMEOUT_MS, TWITTER_BASE_URL, VIDEO_EXTENSION）
│   ├── config/
│   │   └── loader.ts          # config.json読み込み・検証
│   ├── utils/
│   │   ├── common.ts          # 汎用ユーティリティ（sleep）
│   │   ├── database.ts        # SQLite処理（initDatabase, checkMediaExists, insertMedia）
│   │   ├── twitter.ts         # メディア情報抽出（hasMedia, getMediaInfo）
│   │   ├── download.ts        # ダウンロード処理（downloadMedia, downloadMediaByResponse）
│   │   └── storage.ts         # 保存領域チェック（ディレクトリ存在・書き込み権限）
│   └── services/
│       └── mediaFetcher.ts    # ユーザーループ統合処理（processUserList）
├── tests/
│   └── unit/                  # ユニットテスト
├── scripts/                   # マイグレーション等のスクリプト
├── docs/                      # 企画書等のドキュメント
├── index.ts                   # 後方互換ラッパー
├── deno.json                  # タスク定義
└── config.json                # 設定ファイル（gitignore対象）
```

### データフロー

1. **設定読み込み**: `config.json`を読み込み、`validateConfig()`で必須フィールドを検証
2. **保存先検証**: 全保存先ディレクトリの存在・書き込み権限を事前チェック
3. **API初期化**: Cookie情報（`authToken`、`ct0`）でTwitterOpenApiクライアントを初期化
4. **DB初期化**: mediaテーブル + インデックスを作成
5. **データ取得**: 以下4つのソースからツイートデータを取得
   - ブックマーク (`getBookmarks()`)
   - いいね欄 (`getLikes()`) - sources.likes内の各ユーザー
   - ツイート (`getUserTweets()`) - sources.tweets内の各ユーザー（RTのみ抽出）
   - メディア欄 (`getUserMedia()`) - sources.media内の各ユーザー
6. **フィルタリング**: `hasMedia()`でメディア付きツイートのみ抽出
7. **情報抽出**: `getMediaInfo()`で画像・動画URLとメタデータを取得
8. **重複チェック**: `checkMediaExists()`でSQLiteデータベースと照合
9. **ダウンロード**: `downloadMedia()`で新規メディアのみダウンロード + DB登録

### 重要な型定義

型定義は`src/types/index.ts`に集約。主要な型:

- `MediaInfo`: メディア情報（userName, userScreenName, userId, tweetUrl, tweetId, createdAt, mediaType, mediaUrl, fileName）
- `UserConfig`: ユーザー設定（userId, screenName, displayName, dirname, errorIgnore）
- `AppConfig`: アプリケーション設定（auth, storage, sources）
- `MediaType`: `"photo" | "video" | "animated_gif"`
- `ResponseType`: `"bookmark" | "likes" | "media" | "tweet"`

### SQLiteスキーマ

```sql
CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_screen_name TEXT NOT NULL,
    author_display_name TEXT NOT NULL,
    author_id TEXT NOT NULL,
    tweet_id TEXT NOT NULL,
    created_at TEXT,
    media_type TEXT NOT NULL CHECK(media_type IN ('photo', 'video', 'animated_gif')),
    media_url TEXT NOT NULL,
    file_name TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL CHECK(source IN ('bookmark', 'likes', 'media', 'tweet')),
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_file_name ON media(file_name);
CREATE INDEX IF NOT EXISTS idx_media_tweet_id ON media(tweet_id);
CREATE INDEX IF NOT EXISTS idx_media_author_id ON media(author_id);
```

`file_name`のUNIQUE制約とインデックスで重複判定を行う。

### 設定ファイル構造

`config.json`（gitignore対象）は以下の構造：

```json
{
  "auth": {
    "authToken": "Cookie認証トークン",
    "ct0": "CSRFトークン"
  },
  "storage": {
    "savePath": "メディア保存先ルートパス",
    "dbPath": "SQLiteデータベースパス"
  },
  "sources": {
    "bookmarks": { "enabled": true, "dirname": "bookmarks" },
    "likes": [{ "userId": "...", "screenName": "...", "displayName": "...", "dirname": "...", "errorIgnore": false }],
    "media": [...],
    "tweets": [...]
  }
}
```

## 依存関係

- `twitter-openapi-typescript@0.0.55`: Twitter API非公式クライアント（バージョン固定）
- `deno.land/x/sqlite3@0.12.0`: SQLite3 FFIバインディング
- `node:path`: ファイルパス操作

## 注意点

- Cookie認証を使用するため、アカウント凍結リスクあり。使い捨てアカウント推奨。
- 動画は各バリアント中で最高ビットレートのものを選択して保存。
- SQLインジェクション脆弱性は修正済み。全SQL文でパラメータバインディングを使用。
- API呼び出しは各ユーザー間で1秒のsleepを設定（レート制限対策）。
- プロモーションツイートは自動的にスキップされる。
- systemd timerでの定期実行に対応（終了コード0/1、タイムスタンプ付きログ）。
