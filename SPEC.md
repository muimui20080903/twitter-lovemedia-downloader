# SPEC.md - 技術仕様書

> Twitter Lovemedia Downloader v2.0（リファクタリング後）
> 最終更新: 2026-02-15

---

## 1. システム概要

### 1.1 目的

Twitterのいいね欄、ブックマーク、メディア欄、ツイート（RT）から画像・動画を自動ダウンロードする。Cookie認証を使用することで、鍵垢のメディアも取得可能。systemd timerによる定期実行を前提として設計されている。

### 1.2 実行環境

| 項目 | 内容 |
|------|------|
| ランタイム | Deno 1.x系 |
| 言語 | TypeScript |
| 必要権限 | `--allow-read`, `--allow-net`, `--allow-env`, `--allow-write`, `--allow-ffi`, `--unstable-ffi` |

### 1.3 主要依存関係

| ライブラリ | バージョン | 用途 |
|-----------|-----------|------|
| `twitter-openapi-typescript` | 0.0.55（固定） | Twitter API非公式クライアント |
| `deno.land/x/sqlite3` | 0.12.0 | SQLite3 FFIバインディング |
| `node:path` | Deno組み込み | ファイルパス操作 |

---

## 2. アーキテクチャ

### 2.1 ディレクトリ構造

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
│   └── unit/
│       ├── twitter.test.ts    # hasMedia, getMediaInfoのテスト
│       ├── database.test.ts   # checkMediaExists, insertMediaのテスト
│       └── download.test.ts   # downloadMediaのテスト
├── scripts/
│   └── migrate.ts             # DBマイグレーションスクリプト
├── docs/
│   └── product-plan.md        # リファクタリング企画書
├── index.ts                   # 後方互換ラッパー
├── deno.json                  # タスク定義
├── config.json                # 設定ファイル（gitignore対象）
├── CLAUDE.md                  # Claude Code向けガイド
└── SPEC.md                    # 本ファイル（技術仕様書）
```

### 2.2 モジュール依存関係

```
index.ts
  └── src/main.ts
        ├── src/config/loader.ts       → config.json読み込み
        ├── src/utils/storage.ts       → 保存先ディレクトリ検証
        ├── src/utils/database.ts      → SQLite3
        ├── src/utils/download.ts      → downloadMediaByResponse
        │     ├── src/utils/twitter.ts → hasMedia, getMediaInfo
        │     └── src/utils/database.ts → checkMediaExists, insertMedia
        ├── src/services/mediaFetcher.ts
        │     ├── src/utils/common.ts  → sleep
        │     ├── src/constants/index.ts → API_TIMEOUT_MS
        │     └── src/utils/download.ts
        └── src/types/index.ts         → 全モジュールが参照
```

### 2.3 データフロー

```
1. 設定読み込み (config/loader.ts)
   │  config.jsonを読み込み、validateConfigで検証
   ▼
2. 保存先検証 (utils/storage.ts)
   │  savePath + 各dirnameの存在・書き込み権限を確認
   ▼
3. Twitter API初期化
   │  Cookie認証（authToken, ct0）でクライアント作成
   ▼
4. DB初期化 (utils/database.ts)
   │  mediaテーブル + インデックスを作成
   ▼
5. データ取得（4ソース）
   │  ブックマーク → いいね → ツイート → メディア の順に処理
   ▼
6. フィルタリング (utils/twitter.ts: hasMedia)
   │  プロモーションツイート除外、メディア有無判定
   ▼
7. 情報抽出 (utils/twitter.ts: getMediaInfo)
   │  画像URL・動画最高ビットレートURL・メタデータを取得
   ▼
8. 重複チェック (utils/database.ts: checkMediaExists)
   │  file_nameでDB照合、既存ならスキップ
   ▼
9. ダウンロード + DB登録 (utils/download.ts)
   │  fetchでメディア取得 → ファイル保存 → insertMediaでDB登録
   ▼
10. 完了
```

---

## 3. API仕様

### 3.1 src/config/loader.ts

#### `loadConfig(configPath?: string): Promise<AppConfig>`
- **引数**: `configPath` - 設定ファイルパス（デフォルト: `"./config.json"`）
- **返り値**: `Promise<AppConfig>` - 検証済みの設定オブジェクト
- **処理**: JSON読み込み → `validateConfig()`で必須フィールド検証 → AppConfigとして返却
- **エラー**: ファイル読み込み失敗時・検証失敗時にErrorをスロー

#### `validateConfig(config: unknown): asserts config is AppConfig`（内部関数）
- **処理**: `auth`（authToken, ct0）、`storage`（savePath, dbPath）、`sources`（bookmarks, likes, media, tweets）の存在と型を検証
- **エラー**: 各フィールド欠落時に具体的なエラーメッセージ付きErrorをスロー

### 3.2 src/utils/database.ts

#### `initDatabase(dbPath: string): Database`
- **引数**: `dbPath` - SQLiteデータベースファイルパス
- **返り値**: `Database` - 初期化済みのDatabaseインスタンス
- **処理**: mediaテーブル作成（IF NOT EXISTS）+ 3つのインデックス作成

#### `checkMediaExists(db: Database, fileName: string): boolean`
- **引数**: `db` - Databaseインスタンス、`fileName` - チェック対象のファイル名
- **返り値**: `boolean` - 存在する場合true
- **処理**: パラメータバインディング（`?`）を使用してfile_nameで検索

#### `insertMedia(db: Database, record: MediaRecord, source: string): void`
- **引数**: `db` - Databaseインスタンス、`record` - メディア情報、`source` - ソース種別
- **返り値**: なし
- **処理**: パラメータバインディングでmediaテーブルにINSERT

### 3.3 src/utils/twitter.ts

#### `hasMedia(tweetData: TweetData): boolean`
- **引数**: `tweetData` - ツイートデータ（any型）
- **返り値**: `boolean` - メディアを含む場合true
- **処理**: プロモーション除外 → カード（動画埋め込み）チェック → entities.media / extendedEntitiesチェック

#### `getMediaInfo(tweetData: TweetData): MediaInfo[]`
- **引数**: `tweetData` - ツイートデータ
- **返り値**: `MediaInfo[]` - 抽出されたメディア情報の配列
- **処理**: `extractPhotoInfo()` + `extractVideoInfo()` の結果を結合して返却

#### `extractPhotoInfo(tweetData: TweetData): MediaInfo[]`（内部関数）
- **処理**: `entities.media`から画像URL・拡張子を取得し、MediaInfoを構築

#### `extractVideoInfo(tweetData: TweetData): MediaInfo[]`（内部関数）
- **処理**: `extendedEntities.media`から動画情報を取得、`getBestVideoUrl()`で最高ビットレートを選択

#### `getBestVideoUrl(variants: { bitrate: number; url: string }[]): string`（内部関数）
- **処理**: variantsからbitrateが最大のURLを返す

### 3.4 src/utils/download.ts

#### `downloadMedia(mediaInfo: MediaInfo, dirname: string, savePath: string): Promise<void>`
- **引数**: `mediaInfo` - メディア情報、`dirname` - サブディレクトリ名、`savePath` - 保存先ルート
- **処理**: fetch → arrayBuffer → Deno.writeFile。エラー時はconsole.errorでログ出力（処理は継続）

#### `downloadMediaByResponse(params: {...}): Promise<void>`
- **引数**: `responseType`, `response`, `dirname`, `userName`, `db`, `savePath` をオブジェクトで受け取り
- **処理**:
  1. `hasMedia()`でフィルタリング
  2. ツイートソースの場合、`extractRetweets()`でRTのみ抽出
  3. `getMediaInfo()`で情報抽出
  4. `checkMediaExists()`で重複チェック
  5. 新規メディアのみ `insertMedia()` + `downloadMedia()` を実行
  6. `printResult()`で結果ログ出力

#### `extractRetweets(tweets: any[]): any[]`（内部関数）
- **処理**: `retweeted`プロパティを持つツイートのみ抽出し、RT元データを返す

### 3.5 src/utils/storage.ts

#### `ensureDirectoryExists(dirPath: string): Promise<void>`
- **引数**: `dirPath` - 確認対象ディレクトリパス
- **処理**: `Deno.stat()`で存在確認。未存在またはファイルの場合にErrorをスロー

#### `checkWritePermission(dirPath: string): Promise<void>`
- **引数**: `dirPath` - 確認対象ディレクトリパス
- **処理**: テストファイルの書き込み・削除で権限を確認

#### `validateStoragePaths(savePath: string, dirnames: string[]): Promise<void>`
- **引数**: `savePath` - 保存先ルート、`dirnames` - サブディレクトリ名の配列
- **処理**: savePath存在確認 + 書き込み権限確認 + 各dirnameの存在確認

### 3.6 src/services/mediaFetcher.ts

#### `processUserList(userList, fetchFunction, responseType, config, db): Promise<void>`
- **引数**:
  - `userList: UserConfig[]` - 処理対象ユーザーリスト
  - `fetchFunction: (userId: string) => Promise<any>` - API呼び出し関数
  - `responseType: ResponseType` - ソース種別
  - `config: AppConfig` - 設定
  - `db: Database` - Databaseインスタンス
- **処理**: ユーザーリストを順次処理。各ユーザー間に`sleep(API_TIMEOUT_MS)`（1秒）を挿入。`errorIgnore`がtrueのユーザーはエラー時にスキップ

### 3.7 src/utils/common.ts

#### `sleep(ms: number): Promise<void>`
- **引数**: `ms` - 待機ミリ秒
- **処理**: `setTimeout`をPromiseでラップして正しく待機する

### 3.8 src/main.ts

#### `main(): Promise<void>`
- **処理**: 上記データフロー（設定読み込み → 保存先検証 → API初期化 → DB初期化 → 4ソース処理 → DB close）を実行
- **エントリーポイント**: `import.meta.main`で直接実行時に`main()`を呼び出し、終了コード0（正常）/1（エラー）を返す

---

## 4. データモデル

`src/types/index.ts`に定義された型:

```typescript
/** メディアの種類 */
export type MediaType = "photo" | "video" | "animated_gif";

/** レスポンスのソース種別 */
export type ResponseType = "bookmark" | "likes" | "media" | "tweet";

/** メディア情報 */
export type MediaInfo = {
  userName: string;        // ユーザーの表示名
  userScreenName: string;  // ユーザー名(@xxx)
  userId: string;          // ユーザーID
  tweetUrl: string;        // ツイートURL
  tweetId: string;         // ツイートID
  createdAt: string;       // 作成日時
  mediaType: MediaType;    // "photo" | "video" | "animated_gif"
  mediaUrl: string;        // メディアURL
  fileName: string;        // 保存ファイル名
};

/** ユーザー設定（config.jsonのsources内の各ユーザー） */
export type UserConfig = {
  userId: string;          // ユーザーID
  screenName: string;      // スクリーンネーム
  displayName: string;     // 表示名
  dirname: string;         // 保存サブディレクトリ名
  errorIgnore: boolean;    // エラー時にスキップするか
};

/** ブックマーク設定 */
export type BookmarkConfig = {
  enabled: boolean;        // ブックマーク取得の有効/無効
  dirname: string;         // 保存サブディレクトリ名
};

/** アプリケーション設定（新config.json構造） */
export type AppConfig = {
  auth: {
    authToken: string;
    ct0: string;
  };
  storage: {
    savePath: string;
    dbPath: string;
  };
  sources: {
    bookmarks: BookmarkConfig;
    likes: UserConfig[];
    media: UserConfig[];
    tweets: UserConfig[];
  };
};

/** メディアカウント */
export type MediaCount = {
  photo: number;
  video: number;
};

/** 動画バリアント */
export type VideoVariant = {
  bitrate: number;
  url: string;
};

/** 動画メディア */
export type VideoMedia = {
  videoInfo: {
    variants: VideoVariant[];
  };
  type: string;
};
```

---

## 5. データベース仕様

### 5.1 テーブル定義

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
```

### 5.2 インデックス

```sql
CREATE INDEX IF NOT EXISTS idx_media_file_name ON media(file_name);
CREATE INDEX IF NOT EXISTS idx_media_tweet_id ON media(tweet_id);
CREATE INDEX IF NOT EXISTS idx_media_author_id ON media(author_id);
```

### 5.3 カラム説明

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | 自動連番 |
| `author_screen_name` | TEXT | NOT NULL | ツイート投稿者のスクリーンネーム |
| `author_display_name` | TEXT | NOT NULL | ツイート投稿者の表示名 |
| `author_id` | TEXT | NOT NULL | ツイート投稿者のユーザーID |
| `tweet_id` | TEXT | NOT NULL | ツイートID（TEXT型でオーバーフロー防止） |
| `created_at` | TEXT | - | ツイート作成日時 |
| `media_type` | TEXT | NOT NULL, CHECK | "photo" / "video" / "animated_gif" |
| `media_url` | TEXT | NOT NULL | メディアの元URL |
| `file_name` | TEXT | NOT NULL, UNIQUE | 保存ファイル名（重複判定キー） |
| `source` | TEXT | NOT NULL, CHECK | 取得元ソース（"bookmark" / "likes" / "media" / "tweet"） |
| `saved_at` | DATETIME | DEFAULT CURRENT_TIMESTAMP | DB登録日時 |

### 5.4 重複判定ロジック

`file_name`カラムのUNIQUE制約により重複を防止。ダウンロード前に`checkMediaExists()`で`file_name`をパラメータバインディングで照合し、既存の場合はスキップする。

---

## 6. エラーハンドリング

### 6.1 エラー分類

| エラー種別 | 発生箇所 | 処理 |
|-----------|----------|------|
| **設定検証エラー** | `config/loader.ts: validateConfig()` | 具体的なフィールド名を含むErrorをスロー。プログラム終了（exit 1） |
| **設定読み込みエラー** | `config/loader.ts: loadConfig()` | ファイルパスを含むErrorをスロー。プログラム終了（exit 1） |
| **保存先未存在エラー** | `utils/storage.ts: ensureDirectoryExists()` | ディレクトリパスを含むErrorをスロー。プログラム終了（exit 1） |
| **書き込み権限エラー** | `utils/storage.ts: checkWritePermission()` | ディレクトリパスを含むErrorをスロー。プログラム終了（exit 1） |
| **APIエラー** | `services/mediaFetcher.ts: processUserList()` | `errorIgnore`がtrueならスキップ、falseならconsole.errorでログ出力して処理継続 |
| **ダウンロードエラー** | `utils/download.ts: downloadMedia()` | console.errorでログ出力し、処理を継続（他のメディアのDLに影響しない） |
| **致命的エラー** | `src/main.ts: エントリーポイント` | console.errorでタイムスタンプ付きログ出力、exit 1 |

### 6.2 リソース管理

- DB接続は`try-finally`で確実にクローズ（`src/main.ts`内）
- API呼び出し前に保存先を事前検証し、無駄なAPI消費を防止

---

## 7. 設定ファイル仕様

### 7.1 config.json構造

```json
{
  "auth": {
    "authToken": "Cookie認証トークン",
    "ct0": "CSRFトークン"
  },
  "storage": {
    "savePath": "/path/to/save",
    "dbPath": "/path/to/twitterpic.db"
  },
  "sources": {
    "bookmarks": {
      "enabled": true,
      "dirname": "bookmarks"
    },
    "likes": [
      {
        "userId": "123456789",
        "screenName": "user1",
        "displayName": "User 1",
        "dirname": "user1",
        "errorIgnore": false
      }
    ],
    "media": [
      {
        "userId": "987654321",
        "screenName": "user2",
        "displayName": "User 2",
        "dirname": "user2",
        "errorIgnore": false
      }
    ],
    "tweets": [
      {
        "userId": "111222333",
        "screenName": "user3",
        "displayName": "User 3",
        "dirname": "user3",
        "errorIgnore": false
      }
    ]
  }
}
```

### 7.2 フィールド説明

| セクション | フィールド | 型 | 必須 | 説明 |
|-----------|-----------|-----|------|------|
| `auth` | `authToken` | string | Yes | ブラウザCookieの`auth_token`値 |
| `auth` | `ct0` | string | Yes | ブラウザCookieの`ct0`値（CSRFトークン） |
| `storage` | `savePath` | string | Yes | メディア保存先ルートディレクトリの絶対パス |
| `storage` | `dbPath` | string | Yes | SQLiteデータベースファイルの絶対パス |
| `sources.bookmarks` | `enabled` | boolean | Yes | ブックマーク取得の有効/無効 |
| `sources.bookmarks` | `dirname` | string | Yes | ブックマーク保存先サブディレクトリ名 |
| `sources.likes[]` | `userId` | string | Yes | ユーザーID |
| `sources.likes[]` | `screenName` | string | Yes | スクリーンネーム |
| `sources.likes[]` | `displayName` | string | Yes | 表示名 |
| `sources.likes[]` | `dirname` | string | Yes | 保存先サブディレクトリ名 |
| `sources.likes[]` | `errorIgnore` | boolean | Yes | エラー時にスキップするか |
| `sources.media[]` | （likesと同じ） | | | |
| `sources.tweets[]` | （likesと同じ） | | | |

### 7.3 Cookie取得方法

1. ブラウザでTwitter（x.com）にログイン
2. 開発者ツール → Application → Cookies → `https://x.com`
3. `auth_token`と`ct0`の値をconfig.jsonに転記

> **注意**: config.jsonは`.gitignore`に登録し、リポジトリにコミットしないこと。

---

## 8. ファイル命名規則

### 8.1 画像

```
{screenName}-{tweetId}-{index}{extname}
```

- `screenName`: ツイート投稿者のスクリーンネーム
- `tweetId`: ツイートのID
- `index`: 同一ツイート内のメディアインデックス（0始まり）
- `extname`: 元画像の拡張子（`.jpg`, `.png`等）

**例**: `elonmusk-1234567890-0.jpg`

### 8.2 動画・GIF

```
{screenName}-{tweetId}-{index}.mp4
```

- 拡張子は常に`.mp4`（`VIDEO_EXTENSION`定数で定義）

**例**: `elonmusk-1234567890-0.mp4`

### 8.3 保存パス

```
{savePath}/{dirname}/{fileName}
```

- `savePath`: config.jsonの`storage.savePath`
- `dirname`: 各ソースの`dirname`
- `fileName`: 上記命名規則で生成されたファイル名

---

## 9. セキュリティ考慮事項

### 9.1 SQLインジェクション対策（修正済み）

全てのSQL文でパラメータバインディング（`?`プレースホルダー）を使用。

```typescript
// SELECT（重複チェック）
const sql = `SELECT COUNT(*) as count FROM media WHERE file_name = ? LIMIT 1;`;
const stmt = db.prepare(sql);
const row = stmt.get(fileName);

// INSERT（新規登録）
db.exec(sql, [screenName, displayName, userId, tweetId, ...]);
```

### 9.2 認証情報の保護

- `config.json`は`.gitignore`で管理し、リポジトリに含めない
- Cookie情報（authToken, ct0）はログ出力に含めない
- CLAUDE.mdやSPEC.mdに実際の認証情報を記載しない

### 9.3 入力値の検証

- `config/loader.ts`で設定ファイルの必須フィールドと型を検証
- `path.extname()`によるファイル拡張子の安全な取得

---

## 10. パフォーマンス

### 10.1 ダウンロード戦略

- **順次ダウンロード**: メディアは1件ずつ順次ダウンロード（並列ダウンロードは未実装）
- **API間待機**: 各ユーザー間に`API_TIMEOUT_MS`（1秒）のsleepを挿入（レート制限対策）
- **重複スキップ**: `checkMediaExists()`でDB照合し、既存メディアはダウンロードをスキップ

### 10.2 DB最適化

- `file_name`のUNIQUE制約 + インデックスにより、重複チェックを高速化
- `tweet_id`、`author_id`にもインデックスを設定

### 10.3 事前検証

- API呼び出し前に保存先ディレクトリの存在・権限を一括検証し、無駄なAPI消費を防止

---

## 11. テスト戦略

### 11.1 テストフレームワーク

`Deno.test`を使用。実行コマンド:

```bash
deno task test
```

### 11.2 テストファイル構成

| ファイル | テスト対象 |
|---------|-----------|
| `tests/unit/twitter.test.ts` | `hasMedia()`, `getMediaInfo()` |
| `tests/unit/database.test.ts` | `checkMediaExists()`, `insertMedia()`, `initDatabase()` |
| `tests/unit/download.test.ts` | `downloadMedia()` |

### 11.3 テスト対象関数

| 関数 | テスト観点 |
|------|-----------|
| `hasMedia()` | プロモーションツイート除外、メディア有ツイートのtrue判定、メディア無ツイートのfalse判定、カード付きツイート |
| `getMediaInfo()` | 画像情報の正確な抽出、動画最高ビットレート選択、ファイル名生成規則 |
| `checkMediaExists()` | 存在するファイル名でtrue、未登録ファイル名でfalse |
| `insertMedia()` | 正常登録、重複登録時のUNIQUE制約エラー |
| `downloadMedia()` | 正常ダウンロード、HTTPエラー時の処理 |

---

## 12. 既知の制約・今後の改善点

### 12.1 既知の制約

| 制約 | 詳細 |
|------|------|
| **20ツイート制限** | Twitter APIのレスポンスが1リクエストあたり約20ツイートに制限される。ページネーション未実装のため、古いツイートは取得できない |
| **TweetData型のany使用** | `twitter-openapi-typescript`の型定義が不十分なため、`TweetData`は`any`として扱っている（`src/utils/twitter.ts`） |
| **順次ダウンロード** | メディアを1件ずつダウンロードするため、大量のメディアがある場合は時間がかかる |
| **リトライ未実装** | ダウンロード失敗時の自動リトライ機能がない |
| **ログファイル未対応** | ログはstdout/stderrへの出力のみ（ファイル出力はjournalctl等に委任） |

### 12.2 今後の改善点

| 優先度 | 改善項目 | 概要 |
|--------|---------|------|
| 高 | ページネーション対応 | 20ツイート以上のデータ取得 |
| 高 | TweetData型の厳密化 | twitter-openapi-typescriptの型定義活用 |
| 中 | リトライ機能 | ダウンロード失敗時の自動リトライ |
| 中 | 並列ダウンロード | 複数ファイルの同時ダウンロード |
| 中 | CLI引数対応 | ソース指定・ドライラン等のオプション |
| 低 | 進捗表示 | プログレスバー・進捗率の表示 |
| 低 | 通知機能 | 実行結果のSlack/Discord通知 |
