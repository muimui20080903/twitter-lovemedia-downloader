# Twitter Lovemedia Downloader リファクタリング企画書

> 作成日: 2026-02-08
> バージョン: 1.1（要件反映: systemd timer対応、スキーマ最適化、保存領域チェック機能）

---

## 仮定事項

本企画書は以下を仮定して作成しています：

1. **利用規模**: 個人利用を想定（同時実行ユーザーは1名）
2. **対象ユーザー数**: config.jsonに登録するユーザーは最大20名程度
3. ~~**実行頻度**: 1日1〜数回の手動実行（cron等の自動実行は想定外）~~ → **実行方式**: systemctl（systemd timer）による定期実行を前提とする（手動実行も可）
4. ~~**保存容量**: ローカルストレージに十分な空き容量がある前提~~ → **保存先**: 実行時に保存先ディレクトリの存在を事前チェックする（存在しない場合はエラー終了）
5. **ネットワーク**: 安定したインターネット接続環境
6. **開発体制**: 個人開発（無為さん1名）、Claude Codeによる支援あり
7. **Denoバージョン**: Deno 1.x系（FFI機能を使用するため）
8. **twitter-openapi-typescript**: v0.0.55を継続使用（Twitter API仕様変更による将来的な破壊的変更の可能性あり）
9. **開発期間**: リファクタリング全体で2〜3週間を想定
10. **テスト環境**: 本番と同じconfig.json・DBを使用（専用テスト環境は構築しない）
11. **config.json**: 最適な構成に再設計する（後方互換性は維持しない）
12. **SQLスキーマ**: 最適な構成に再設計する（マイグレーションスクリプトを提供）
13. **ファイル保存可否**: 保存先ディレクトリへの書き込み権限を事前チェックする

---

## 1. プロジェクト概要

### 1.1 背景

Twitter Lovemedia Downloaderは、Twitterのいいね欄・ブックマーク・メディア欄・ツイート（RT）から画像・動画を自動ダウンロードするDenoアプリケーションです。Cookie認証を使用し、鍵垢のメディアも取得可能です。

2023年9月に開発を開始し、開発記録を残しながら段階的に機能を追加してきました。現在は約240行の単一ファイル（index.ts）に全機能が集約されており、動作はしているものの、セキュリティや保守性に課題を抱えています。

### 1.2 目的

本リファクタリングの目的は以下の3点です：

1. **セキュリティの確保**: SQLインジェクション脆弱性の即時修正
2. **コード品質の向上**: モジュール分割、型安全性強化、テスト追加
3. **保守性・拡張性の確保**: 将来の機能追加に耐えうるアーキテクチャへの移行

### 1.3 ターゲットユーザー

- **エンドユーザー**: Twitterのメディアを一括保存したい個人ユーザー
- **開発者**: 本プロジェクトの保守・拡張を行う無為さん自身

### 1.4 スコープ

| 対象 | 内容 |
|------|------|
| ✅ 対象内 | セキュリティ修正、モジュール分割、型定義整備、テスト追加、技術仕様書作成、config.json再設計、SQLスキーマ最適化、保存領域チェック機能追加、systemd timer定期実行対応 |
| ❌ 対象外 | UI変更、クラウド対応、マルチユーザー対応 |

---

## 2. 現状の課題

### 2.1 重大な問題（即時対応必要）

#### セキュリティ: SQLインジェクション脆弱性
- **箇所**: index.ts 165行目
- **内容**: ファイル名を文字列補間でSQL文に埋め込んでいる
- **リスク**: 悪意あるファイル名によるDB破壊・情報漏洩の可能性
```typescript
// 現状（危険）
let sql = `SELECT COUNT(*) FROM tweet WHERE file_name = '${mediaInfo.fileName}' LIMIT 1;`;
```

#### 非同期処理の不備
- **箇所**: index.ts 221行目
- **内容**: `downloadMedia()`にawaitがなく、ダウンロード完了前にプログラムが終了する可能性
- **影響**: ファイルの書き込みが不完全になりうる

#### setTimeout誤用
- **箇所**: index.ts 26, 40, 56行目
- **内容**: `setTimeout(() => {}, 1000)` は何もせずに即座に次の処理に進む
- **影響**: レート制限対策として意図された1秒待機が機能していない

### 2.2 コード品質の問題

| 問題 | 詳細 | 影響 |
|------|------|------|
| 重複コード | いいね・ツイート・メディアの3箇所で同じユーザーループ処理 | 修正時に3箇所を同時変更する必要があり、バグの温床 |
| 長い関数 | getMediaInfo（65行）、downloadMediaByResponce（45行） | 可読性が低く、テストが困難 |
| 型定義不足 | anyが多用されている | コンパイル時のエラー検出ができない |
| 命名不統一 | PascalCase（BookMarks）とcamelCase（mediatweets）が混在 | コードの一貫性が欠如 |
| テスト不在 | テストファイルが存在しない | 変更時のデグレ検知が不可能 |
| エラーハンドリング | try-catchの範囲が広すぎ、DBクローズが保証されない | リソースリークの可能性 |

---

## 3. 改善後のメリット

### 3.1 ユーザー視点

- **信頼性向上**: ダウンロードの確実な完了（非同期処理修正）
- **安全性向上**: SQLインジェクション攻撃のリスク排除
- **安定性向上**: レート制限の正しい適用によるAPI呼び出しの安定化

### 3.2 開発者視点

- **保守性**: モジュール分割により変更範囲を限定できる
- **安全性**: 型チェックによりコンパイル時にバグを検出
- **テスト可能性**: ユニットテストで回帰テストが自動化できる
- **可読性**: 責任が明確な小さな関数により理解しやすいコード
- **拡張性**: 新しいデータソースの追加が容易（processUserListの再利用）
- **学習効果**: リファクタリングを通じてTypeScript・非同期処理・テストの知識を習得

---

## 4. 成功指標

| 指標 | 現状 | 目標 |
|------|------|------|
| SQLインジェクション脆弱性 | 1件 | 0件 |
| 非同期処理の不備 | 4箇所 | 0箇所 |
| setTimeout誤用 | 3箇所 | 0箇所 |
| ファイル数（src/） | 1ファイル（240行） | 9ファイル（各50行以下目安） |
| any型の使用 | 多数 | 0箇所 |
| テストカバレッジ | 0% | 主要関数（hasMedia, getMediaInfo, checkSQL）をカバー |
| テスト数 | 0 | 10件以上 |
| 技術仕様書 | なし | SPEC.md（12セクション） |
| config.json再設計 | 旧構造 | 最適化された新構造 + マイグレーション手順 |
| SQLスキーマ再設計 | 旧スキーマ | 最適化された新スキーマ + マイグレーションスクリプト |
| 保存先チェック | なし | ディレクトリ存在確認 + 書き込み権限チェック |
| cron対応 | 手動実行のみ | systemd timer定期実行対応（ログ出力、終了コード） |

---

## 5. 技術スタック

### 5.1 ランタイム・言語

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Deno | 1.x系 | ランタイム |
| TypeScript | Deno組み込み | 開発言語 |

### 5.2 主要ライブラリ

| ライブラリ | バージョン | 用途 |
|-----------|-----------|------|
| twitter-openapi-typescript | 0.0.55（固定） | Twitter API非公式クライアント |
| deno.land/x/sqlite3 | 0.12.0 | SQLite3 FFIバインディング |
| node:path | Deno組み込み | ファイルパス操作 |

### 5.3 開発ツール

| ツール | 用途 |
|--------|------|
| Deno.test | ユニットテスト |
| deno fmt | コードフォーマッタ |
| deno lint | リンター |
| deno check | 型チェック |

---

## 6. アーキテクチャ設計

### 6.1 現状（Before）

```
index.ts（240行・全機能を含む単一ファイル）
├── config読み込み・API初期化（1-10行）
├── main()（12-67行）
│   ├── ブックマーク処理
│   ├── いいね処理（ユーザーループ）
│   ├── ツイート処理（ユーザーループ）
│   └── メディア処理（ユーザーループ）
├── 型定義: MediaInfo（69-79行）
├── hasMedia()（82-93行）
├── getMediaInfo()（96-161行）
├── checkSQL()（163-177行）
├── downloadMedia()（179-190行）
└── downloadMediaByResponce()（192-236行）
```

### 6.2 リファクタリング後（After）

```
twitter-lovemedia-downloader/
├── src/
│   ├── types/
│   │   └── index.ts           # 型定義（MediaInfo, UserConfig, AppConfig等）
│   ├── constants/
│   │   └── index.ts           # 定数（タイムアウト値、URL、メッセージ）
│   ├── utils/
│   │   ├── common.ts          # 汎用ユーティリティ（sleep）
│   │   ├── database.ts        # SQLite処理（checkSQL, initDatabase）
│   │   ├── twitter.ts         # メディア情報抽出（hasMedia, getMediaInfo）
│   │   ├── download.ts        # ダウンロード処理
│   │   └── storage.ts         # 保存領域チェック（ディレクトリ存在・書き込み権限）
│   ├── services/
│   │   └── mediaFetcher.ts    # ユーザーループ統合処理
│   ├── config/
│   │   └── loader.ts          # config.json読み込み・検証
│   └── main.ts                # 新エントリーポイント
├── tests/
│   └── unit/
│       ├── twitter.test.ts    # hasMedia, getMediaInfoのテスト
│       ├── database.test.ts   # checkSQLのテスト
│       └── download.test.ts   # downloadMediaのテスト
├── index.ts                   # 後方互換ラッパー
├── deno.json
├── config.json
└── SPEC.md
```

### 6.3 モジュール依存関係

```
index.ts
  └── src/main.ts
        ├── src/config/loader.ts     → config.json
        ├── src/utils/database.ts    → SQLite3
        ├── src/utils/twitter.ts     → (純粋関数)
        ├── src/utils/download.ts    → fetch API
        ├── src/services/mediaFetcher.ts
        │     ├── src/utils/twitter.ts
        │     ├── src/utils/database.ts
        │     └── src/utils/download.ts
        ├── src/types/index.ts
        └── src/constants/index.ts
```

### 6.4 設計原則

- **単一責任の原則（SRP）**: 各ファイルは1つの責任のみを持つ
- **依存性の方向**: main → services → utils → types/constants
- **副作用の分離**: 純粋関数（twitter.ts）とI/O関数（database.ts, download.ts）を分離
- **事前検証**: ダウンロード処理前に保存先・設定の整合性を検証

### 6.5 systemd timer定期実行への対応

systemd timerでの無人実行を前提として、以下を考慮した設計にします：

- **終了コード**: 正常終了は0、エラー時は1を返す（systemdのステータス検知用）
- **標準出力/エラー出力の分離**: 通常ログはstdout、エラーはstderrに出力（journalctlで確認可能）
- **冪等性**: 何度実行しても同じ結果になる（重複チェックによる保証）
- **事前検証で早期終了**: 保存先が存在しない等の致命的エラーはAPI呼び出し前に検出して終了
- **ログにタイムスタンプ付与**: journalctl実行ログの解析を容易にする

### 6.6 config.json 再設計

現状の構成を見直し、より明確で拡張しやすい構造に変更します。

**現状**:
```json
{
  "authToken": "xxx",
  "ct0": "xxx",
  "bookmarksDirname": "bookmarks",
  "LikesUserList": [{ "userId": "...", "username": "...", "name": "...", "dirname": "...", "erroIgnore": false }],
  "MediaUserList": [...],
  "TweetUserList": [...],
  "dbdir": "/path/to/twitterpic.db",
  "savepath": "/path/to/save"
}
```

**再設計後**:
```json
{
  "auth": {
    "authToken": "xxx",
    "ct0": "xxx"
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
      { "userId": "123", "screenName": "user1", "displayName": "User 1", "dirname": "user1", "errorIgnore": false }
    ],
    "media": [
      { "userId": "456", "screenName": "user2", "displayName": "User 2", "dirname": "user2", "errorIgnore": false }
    ],
    "tweets": [
      { "userId": "789", "screenName": "user3", "displayName": "User 3", "dirname": "user3", "errorIgnore": false }
    ]
  }
}
```

**主な変更点**:
- 認証情報を`auth`オブジェクトにグループ化
- 保存先設定を`storage`オブジェクトにグループ化
- ユーザーリストを`sources`オブジェクトに統合
- 命名を統一（camelCase、`erroIgnore` → `errorIgnore` のtypo修正）
- ブックマークに`enabled`フラグを追加（定期実行時に個別ON/OFF可能）

### 6.7 SQLスキーマ再設計

**現状**:
```sql
CREATE TABLE IF NOT EXISTS tweet (
    id INTEGER PRIMARY KEY,
    author_screenname TEXT,
    author_name TEXT,
    author_ID TEXT,
    tweet_ID INTEGER,
    media_url TEXT,
    file_name TEXT,
    save_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**再設計後**:
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

**主な変更点**:
- テーブル名: `tweet` → `media`（実態に合わせた命名）
- カラム名: snake_caseに統一、命名を明確化
- `tweet_id`: INTEGER → TEXT（巨大なIDのオーバーフロー防止）
- `file_name`: UNIQUE制約を追加（重複チェックの整合性保証）
- `media_type`: CHECK制約で有効値を制限
- `source`: どのソースから取得したかを記録（ブックマーク/いいね等）
- `created_at`: ツイート作成日時を保存
- インデックス追加: file_name、tweet_id、author_idで検索高速化

**マイグレーション**: 既存DBから新DBへのデータ移行スクリプトを提供します。

---

## 7. 主要機能の実装方針

### 7.1 認証・初期化（src/config/loader.ts）

```typescript
export async function loadConfig(): Promise<AppConfig> {
  const raw = JSON.parse(await Deno.readTextFile("./config.json"));
  validateConfig(raw);
  return raw as AppConfig;
}
```
- config.jsonの読み込みと型検証を分離
- 必須フィールドの欠落時にわかりやすいエラーメッセージ

### 7.2 データ取得・フィルタリング（src/utils/twitter.ts）

- `hasMedia()`: プロモーションツイート除外、メディア有無判定
- `getMediaInfo()`: 画像・動画情報の抽出を内部関数に分割
  - `extractPhotoInfo()`: 画像URL・拡張子の取得
  - `extractVideoInfo()`: 最高ビットレート動画の選択
- any型を排除し、TweetData型で型安全性を確保

### 7.3 重複チェック・DB管理（src/utils/database.ts）

- パラメータバインディングによるSQLインジェクション対策
- `initDatabase()`: テーブル作成の分離
- `checkSQL()`: 重複チェック + 新規登録を1関数で実行
- try-finallyでDB接続のクローズを保証

### 7.4 ダウンロード処理（src/utils/download.ts）

- `downloadMedia()`: await付きで確実に完了を待機
- `downloadMediaByResponse()`: async関数として正しく定義
- メディアカウントの集計とログ出力

### 7.5 保存領域チェック（src/utils/storage.ts）【新機能】

ダウンロード開始前に保存先の状態を検証する機能を追加します。

```typescript
/** 保存先ディレクトリの存在を確認する */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    const stat = await Deno.stat(dirPath);
    if (!stat.isDirectory) {
      throw new Error(`${dirPath} はディレクトリではありません`);
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(`保存先ディレクトリが存在しません: ${dirPath}`);
    }
    throw e;
  }
}

/** 保存先ディレクトリに書き込み権限があるか確認する */
export async function checkWritePermission(dirPath: string): Promise<void> {
  const testFile = `${dirPath}/.write_test_${Date.now()}`;
  try {
    await Deno.writeTextFile(testFile, "");
    await Deno.remove(testFile);
  } catch {
    throw new Error(`保存先ディレクトリに書き込み権限がありません: ${dirPath}`);
  }
}

/** 全保存先ディレクトリを一括検証する */
export async function validateStoragePaths(
  savepath: string,
  dirnames: string[]
): Promise<void> {
  await ensureDirectoryExists(savepath);
  await checkWritePermission(savepath);
  for (const dirname of dirnames) {
    if (!dirname) continue;
    const fullPath = `${savepath}/${dirname}`;
    await ensureDirectoryExists(fullPath);
  }
}
```

**チェックタイミング**: main関数の先頭、APIコール前に全保存先を一括検証
- 保存先ルート（savepath）の存在 + 書き込み権限
- 各ユーザーのサブディレクトリ（dirname）の存在
- いずれか失敗した場合はエラーメッセージを出力して即座に終了（定期実行時に無駄なAPI呼び出しを防ぐ）

### 7.6 ユーザーループ統合（src/services/mediaFetcher.ts）

3箇所の重複ループを1つの汎用関数に統合：

```typescript
export async function processUserList(
  userList: UserConfig[],
  fetchFunction: (userId: string) => Promise<Response>,
  responseType: ResponseType,
  config: AppConfig,
  db: Database
): Promise<void> {
  for (const user of userList) {
    if (!user.userId) continue;
    try {
      await sleep(API_TIMEOUT_MS);
      const response = await fetchFunction(user.userId);
      await downloadMediaByResponse(responseType, response, user.dirname, ...);
    } catch (e) {
      if (user.erroIgnore) continue;
      console.log(`${e}\n${user.username}さんの${responseType}から取得中にエラー発生\n`);
    }
  }
}
```

---

## 8. セキュリティ対策

### 8.1 SQLインジェクション対策（最優先）

**修正前**:
```typescript
let sql = `SELECT COUNT(*) FROM tweet WHERE file_name = '${mediaInfo.fileName}' LIMIT 1;`;
```

**修正後**:
```typescript
const sql = `SELECT COUNT(*) FROM tweet WHERE file_name = ? LIMIT 1;`;
const stmt = db.prepare(sql);
const row = stmt.get(mediaInfo.fileName);
```

全てのSQL文でパラメータバインディング（プレースホルダー `?`）を使用します。INSERT文は既にパラメータバインディングを使用しているため、SELECT文のみ修正が必要です。

### 8.2 認証情報の保護

- `config.json` は `.gitignore` に含め、リポジトリに含めない
- Cookie情報（authToken, ct0）はログ出力に含めない
- ドキュメントにCookieの取り扱い注意事項を明記

### 8.3 入力値の検証

- config.jsonの必須フィールド検証（loadConfig）
- ファイルパスのトラバーサル対策（path.joinの使用）

---

## 9. 実装ロードマップ

### フェーズ1: セキュリティ修正（1日目）🔴 最優先

| ステップ | 作業内容 | 修正箇所 |
|----------|----------|----------|
| 1.1 | SQLインジェクション修正 | index.ts 165行目 |
| 1.2 | downloadMediaにawait追加 | index.ts 221行目 |
| 1.3 | downloadMediaByResponceをasync化 | index.ts 192行目 |
| 1.4 | 全呼び出しにawait追加 | index.ts 18, 28, 44, 58行目 |
| 1.5 | sleep関数実装・setTimeout置換 | index.ts 26, 40, 56行目 |
| 1.6 | 動作確認 | 手動テスト |

### フェーズ2: モジュール分割・新機能（2〜6日目）

| ステップ | 作業内容 |
|----------|----------|
| 2.1 | ディレクトリ構造の作成 |
| 2.2 | 型定義の整備（src/types/index.ts） |
| 2.3 | 定数の整理（src/constants/index.ts） |
| 2.4 | 共通ユーティリティ（src/utils/common.ts） |
| 2.5 | DB処理の分離 + スキーマ再設計（src/utils/database.ts） |
| 2.6 | Twitter処理の分離（src/utils/twitter.ts） |
| 2.7 | ダウンロード処理の分離（src/utils/download.ts） |
| 2.8 | **保存領域チェック機能の実装（src/utils/storage.ts）** 🆕 |
| 2.9 | サービス層の作成（src/services/mediaFetcher.ts） |
| 2.10 | 設定処理の分離 + config.json再設計（src/config/loader.ts） |
| 2.11 | メインエントリーポイント（src/main.ts）+ systemd対応 |
| 2.12 | 既存index.tsの更新（委譲のみ） |
| 2.13 | DBマイグレーションスクリプトの作成 |

### フェーズ3: テスト追加（6〜7日目）

| ステップ | 作業内容 |
|----------|----------|
| 3.1 | twitter.test.ts（hasMedia, getMediaInfo） |
| 3.2 | database.test.ts（checkSQL） |
| 3.3 | download.test.ts（downloadMedia） |
| 3.4 | deno.jsonにtestタスク追加 |
| 3.5 | 全テスト実行・デバッグ |

### フェーズ4: 仕様書作成（8〜10日目）

| ステップ | 作業内容 |
|----------|----------|
| 4.1 | SPEC.md作成（12セクション） |
| 4.2 | CLAUDE.md更新（新構造を反映） |
| 4.3 | README.md更新（必要に応じて） |

---

## 10. リソース計画

### 10.1 工数見積もり

| フェーズ | 作業内容 | 見積もり |
|----------|----------|----------|
| フェーズ1 | セキュリティ修正 | 1日 |
| フェーズ2 | モジュール分割・新機能・スキーマ再設計 | 5日 |
| フェーズ3 | テスト追加 | 2日 |
| フェーズ4 | 仕様書作成 | 3日 |
| **合計** | | **約11日（2〜3週間）** |

### 10.2 必要リソース

- **開発環境**: Deno 1.x + VSCode（既存環境をそのまま使用）
- **テストデータ**: 既存のtwitterpic.dbのバックアップ
- **外部リソース**: なし（追加のライブラリ導入は不要）

---

## 11. リスク管理

### 11.1 技術リスク

| リスク | 影響度 | 発生確率 | 対策 |
|--------|--------|----------|------|
| DB処理変更によるデータ損失 | 🔴 高 | 低 | 作業前にtwitterpic.dbのバックアップを取得 |
| 非同期処理修正による動作異常 | 🟡 中 | 中 | 各関数のシグネチャを型チェックで検証 |
| twitter-openapi-typescriptの破壊的変更 | 🟡 中 | 低 | バージョンを0.0.55に固定済み |
| リファクタリング中の機能デグレ | 🟡 中 | 中 | 各フェーズ後に手動テストで動作確認 |

### 11.2 スケジュールリスク

| リスク | 対策 |
|--------|------|
| モジュール分割が想定以上に複雑 | フェーズ1（セキュリティ修正）を最優先にし、最低限の安全性を確保 |
| テスト作成に時間がかかる | 主要関数（hasMedia, getMediaInfo, checkSQL）のみに絞る |
| 仕様書作成に時間がかかる | CLAUDE.mdの既存内容を活用し、差分のみ追記 |

### 11.3 回避策

- **段階的リリース**: 各フェーズ完了時点で動作する状態を維持
- **マイグレーション提供**: config.json・DBスキーマは再設計するが、移行手順とスクリプトを提供
- **ロールバック**: Gitで各フェーズをコミットし、問題発生時に即座に戻せる状態を維持

---

## 12. 今後の拡張計画

リファクタリング完了後、以下の機能拡張が容易になります：

### 短期（リファクタリング直後）
- **ページネーション対応**: 20ツイート以上のデータ取得（現在の制限の解消）
- **リトライ機能**: ダウンロード失敗時の自動リトライ
- **進捗表示**: ダウンロード中のプログレスバー表示

### 中期（1〜3ヶ月後）
- **CLI引数対応**: コマンドライン引数でソース（ブックマーク/いいね等）を指定
- **ログ出力強化**: ファイルへのログ保存、ログレベル設定
- **並列ダウンロード**: 複数ファイルの同時ダウンロード

### 長期（検討段階）
- **GUI化**: Webベースの管理画面
- **クラウドストレージ連携**: Google Drive/Dropboxへの保存
- **通知機能**: 実行結果をSlack/Discord等に通知

---

## 付録: 教育ポイント

本リファクタリングを通じて習得できる技術スキル：

| スキル | 学習内容 |
|--------|----------|
| セキュリティ | SQLインジェクションの仕組みとパラメータバインディングによる対策 |
| 非同期処理 | async/awaitの正しい使い方、Promiseの仕組み、setTimeoutとsleepの違い |
| モジュール設計 | 単一責任の原則（SRP）、依存性の方向、import/export |
| 型安全性 | TypeScriptの型システム、any排除、リテラル型、ユニオン型 |
| テスト | Deno.testの使い方、テストの構造（Arrange-Act-Assert）、モック |
| ドキュメント | 技術仕様書の書き方、コードとドキュメントの役割分担 |
| リファクタリング | 段階的改善、後方互換性の維持、安全なコード変更手法 |
