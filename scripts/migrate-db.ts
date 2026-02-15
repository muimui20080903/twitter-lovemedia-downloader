/**
 * DBマイグレーションスクリプト
 * 旧tweetテーブルから新mediaテーブルへデータを移行する
 *
 * 使用方法:
 *   deno run --allow-read --allow-write --allow-ffi --unstable-ffi scripts/migrate-db.ts <旧DBパス> <新DBパス>
 */
import { Database } from "https://deno.land/x/sqlite3@0.12.0/mod.ts";
import { initDatabase } from "../src/utils/database.ts";

const oldDbPath = Deno.args[0];
const newDbPath = Deno.args[1];

if (!oldDbPath || !newDbPath) {
  console.error("使用方法: deno run --allow-read --allow-write --allow-ffi --unstable-ffi scripts/migrate-db.ts <旧DBパス> <新DBパス>");
  Deno.exit(1);
}

console.log(`マイグレーション開始: ${oldDbPath} → ${newDbPath}`);

// 旧DBを開く
const oldDb = new Database(oldDbPath);
const newDb = initDatabase(newDbPath);

// 旧テーブルからデータを取得
const rows = oldDb.prepare(
  "SELECT author_screenname, author_name, author_ID, tweet_ID, media_url, file_name, save_time FROM tweet"
).all() as Array<{
  author_screenname: string;
  author_name: string;
  author_ID: string;
  tweet_ID: number;
  media_url: string;
  file_name: string;
  save_time: string;
}>;

console.log(`${rows.length}件のレコードを移行します...`);

let migrated = 0;
let skipped = 0;

const insertStmt = newDb.prepare(
  `INSERT OR IGNORE INTO media (author_screen_name, author_display_name, author_id, tweet_id, created_at, media_type, media_url, file_name, source, saved_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

// トランザクションで一括処理（パフォーマンス向上）
newDb.exec("BEGIN TRANSACTION");

for (const row of rows) {
  // ファイル名の拡張子からメディアタイプを推定
  const mediaType = row.file_name.endsWith(".mp4") ? "video" : "photo";
  // ソースは不明なため'likes'をデフォルトとする
  const source = "likes";

  try {
    insertStmt.run(
      row.author_screenname ?? "",
      row.author_name ?? "",
      row.author_ID ?? "",
      String(row.tweet_ID),
      "",
      mediaType,
      row.media_url ?? "",
      row.file_name ?? "",
      source,
      row.save_time ?? new Date().toISOString()
    );
    migrated++;
  } catch {
    skipped++;
  }
}

newDb.exec("COMMIT");

oldDb.close();
newDb.close();

console.log(`マイグレーション完了: ${migrated}件移行、${skipped}件スキップ`);
