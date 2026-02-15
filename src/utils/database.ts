import { Database } from "https://deno.land/x/sqlite3@0.12.0/mod.ts";

/** メディア情報（DB登録用） */
type MediaRecord = {
  userScreenName: string;
  userName: string;
  userId: string;
  tweetId: string;
  createdAt: string;
  mediaType: string;
  mediaUrl: string;
  fileName: string;
};

/** データベースを初期化し、テーブルとインデックスを作成する */
export function initDatabase(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec(`
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
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_file_name ON media(file_name);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_tweet_id ON media(tweet_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_media_author_id ON media(author_id);`);
  return db;
}

/** ファイル名でメディアの重複を確認する（存在すればtrue） */
export function checkMediaExists(db: Database, fileName: string): boolean {
  const sql = `SELECT COUNT(*) as count FROM media WHERE file_name = ? LIMIT 1;`;
  const stmt = db.prepare(sql);
  const row = stmt.get(fileName) as { count: number } | undefined;
  return row !== undefined && row.count > 0;
}

/** 新規メディア情報をデータベースに登録する */
export function insertMedia(db: Database, record: MediaRecord, source: string): void {
  const sql = `INSERT INTO media (author_screen_name, author_display_name, author_id, tweet_id, created_at, media_type, media_url, file_name, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`;
  db.exec(sql, [
    record.userScreenName,
    record.userName,
    record.userId,
    record.tweetId,
    record.createdAt,
    record.mediaType,
    record.mediaUrl,
    record.fileName,
    source,
  ]);
}
