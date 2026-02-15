import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  initDatabase,
  checkMediaExists,
  insertMedia,
} from "../../src/utils/database.ts";

/** テスト用のMediaRecordを生成する */
function createTestRecord(overrides: Record<string, string> = {}) {
  return {
    userScreenName: "testuser",
    userName: "TestUser",
    userId: "user123",
    tweetId: "tweet456",
    createdAt: "2024-01-01",
    mediaType: "photo",
    mediaUrl: "https://pbs.twimg.com/media/test.jpg",
    fileName: "testuser-tweet456-0.jpg",
    ...overrides,
  };
}

Deno.test("initDatabase: テーブルが作成される", () => {
  const db = initDatabase(":memory:");
  const result = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='media'",
    )
    .get() as { name: string } | undefined;
  assertEquals(result !== undefined, true);
  assertEquals(result!.name, "media");
  db.close();
});

Deno.test("initDatabase: インデックスが作成される", () => {
  const db = initDatabase(":memory:");
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='media'",
    )
    .all() as { name: string }[];
  const indexNames = indexes.map((i) => i.name);
  assertEquals(indexNames.includes("idx_media_file_name"), true);
  assertEquals(indexNames.includes("idx_media_tweet_id"), true);
  assertEquals(indexNames.includes("idx_media_author_id"), true);
  db.close();
});

Deno.test("checkMediaExists: 存在しないファイルはfalseを返す", () => {
  const db = initDatabase(":memory:");
  assertEquals(checkMediaExists(db, "nonexistent-file.jpg"), false);
  db.close();
});

Deno.test("insertMedia + checkMediaExists: 登録後はtrueを返す", () => {
  const db = initDatabase(":memory:");
  const record = createTestRecord();
  insertMedia(db, record, "likes");
  assertEquals(checkMediaExists(db, record.fileName), true);
  db.close();
});

Deno.test("checkMediaExists: 別のファイル名はfalseのまま", () => {
  const db = initDatabase(":memory:");
  const record = createTestRecord();
  insertMedia(db, record, "bookmark");
  assertEquals(checkMediaExists(db, "different-file.jpg"), false);
  db.close();
});

Deno.test("SQLインジェクション: 悪意あるファイル名が正常に処理される", () => {
  const db = initDatabase(":memory:");
  const maliciousFileName = "'; DROP TABLE media; --";
  const record = createTestRecord({ fileName: maliciousFileName });
  // SQLインジェクションが防がれ、正常に登録される
  insertMedia(db, record, "likes");
  assertEquals(checkMediaExists(db, maliciousFileName), true);

  // mediaテーブルがまだ存在することを確認（DROPされていない）
  const tableExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='media'",
    )
    .get() as { name: string } | undefined;
  assertEquals(tableExists !== undefined, true);
  db.close();
});
