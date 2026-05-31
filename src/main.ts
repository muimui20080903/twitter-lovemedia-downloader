import { TwitterOpenApi } from "npm:twitter-openapi-typescript@0.0.56";
import { loadConfig } from "./config/loader.ts";
import { initDatabase } from "./utils/database.ts";
import { validateStoragePaths } from "./utils/storage.ts";
import { downloadMediaByResponse } from "./utils/download.ts";
import { processUserList } from "./services/mediaFetcher.ts";

/** メインの実行関数 */
export async function main(): Promise<void> {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] 処理を開始します`);

  // 1. 設定読み込み
  const config = await loadConfig();

  // 2. 保存先ディレクトリの事前検証
  const allDirnames = [
    config.sources.bookmarks.dirname,
    ...config.sources.likes.map((u) => u.dirname),
    ...config.sources.media.map((u) => u.dirname),
    ...config.sources.tweets.map((u) => u.dirname),
  ];
  await validateStoragePaths(config.storage.savePath, allDirnames);

  // 3. Twitter API初期化
  const api = new TwitterOpenApi();
  const client = await api.getClientFromCookies({
    ct0: config.auth.ct0,
    auth_token: config.auth.authToken,
  });

  // 4. DB初期化
  const db = initDatabase(config.storage.dbPath);

  try {
    // 5. ブックマーク処理
    if (config.sources.bookmarks.enabled) {
      const bookmarks = await client.getTweetApi().getBookmarks();
      await downloadMediaByResponse({
        responseType: "bookmark",
        response: bookmarks,
        dirname: config.sources.bookmarks.dirname,
        userName: undefined,
        db,
        savePath: config.storage.savePath,
      });
    }

    // 6. いいね処理
    await processUserList(
      config.sources.likes,
      (userId) => client.getTweetApi().getLikes({ userId }),
      "likes",
      config,
      db,
    );

    // 7. ツイート処理（RTのみ抽出）
    await processUserList(
      config.sources.tweets,
      (userId) => client.getTweetApi().getUserTweets({ userId }),
      "tweet",
      config,
      db,
    );

    // 8. メディア処理
    await processUserList(
      config.sources.media,
      (userId) => client.getTweetApi().getUserMedia({ userId }),
      "media",
      config,
      db,
    );

    const endTime = new Date();
    console.log(`[${endTime.toISOString()}] 全ての処理が完了しました`);
  } finally {
    db.close();
  }
}

// エントリーポイント
if (import.meta.main) {
  try {
    await main();
    Deno.exit(0);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] 致命的エラー: ${e}`);
    Deno.exit(1);
  }
}
