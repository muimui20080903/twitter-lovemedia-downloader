import type { MediaInfo, MediaCount, ResponseType } from "../types/index.ts";
import type { Database } from "https://deno.land/x/sqlite3@0.12.0/mod.ts";
import { hasMedia, getMediaInfo } from "./twitter.ts";
import { checkMediaExists, insertMedia } from "./database.ts";

/** 1件のメディアをダウンロードして保存する */
export async function downloadMedia(
  mediaInfo: MediaInfo,
  dirname: string,
  savePath: string,
): Promise<void> {
  try {
    const response = await fetch(mediaInfo.mediaUrl);
    if (!response.ok) {
      throw new Error(`ダウンロード失敗 ${mediaInfo.mediaUrl}, ステータス: ${response.status}`);
    }
    const outputPath = dirname
      ? `${savePath}/${dirname}/${mediaInfo.fileName}`
      : `${savePath}/${mediaInfo.fileName}`;
    const data = await response.arrayBuffer();
    await Deno.writeFile(outputPath, new Uint8Array(data));
  } catch (error) {
    console.error(`ダウンロードエラー ${mediaInfo.mediaUrl}: ${(error as Error).message}`);
  }
}

/** RTのみを抽出する */
// deno-lint-ignore no-explicit-any
function extractRetweets(tweets: any[]): any[] {
  return tweets
    .filter((tweetData) => tweetData.retweeted)
    .map((tweetData) => tweetData.retweeted);
}

/** 結果メッセージを出力する */
function printResult(
  responseType: ResponseType,
  mediaCount: MediaCount,
  userName?: string,
): void {
  const { photo, video } = mediaCount;
  switch (responseType) {
    case "bookmark":
      console.log(`ブックマークから画像を${photo}枚、動画を${video}個取得しました`);
      break;
    case "likes":
      console.log(`${userName}さんのいいね欄から画像を${photo}枚、動画を${video}個取得しました`);
      break;
    case "media":
      console.log(`${userName}さんのメディア欄から画像を${photo}枚、動画を${video}個取得しました`);
      break;
    case "tweet":
      console.log(`${userName}さんのツイートから画像を${photo}枚、動画を${video}個取得しました`);
      break;
  }
}

/** APIレスポンスから複数メディアを処理してダウンロードする */
export async function downloadMediaByResponse(params: {
  responseType: ResponseType;
  // deno-lint-ignore no-explicit-any
  response: { data: { data: any[] } };
  dirname: string;
  userName: string | undefined;
  db: Database;
  savePath: string;
}): Promise<void> {
  const { responseType, response, dirname, userName, db, savePath } = params;
  const mediaCount: MediaCount = { photo: 0, video: 0 };

  // メディア付きツイートのみ抽出
  // deno-lint-ignore no-explicit-any
  let mediaTweets = response.data.data.filter((tweetData: any) =>
    hasMedia(tweetData)
  );

  // ツイートの場合、RTのみを抽出
  if (responseType === "tweet") {
    mediaTweets = extractRetweets(mediaTweets);
  }

  // メディア情報を取得
  const mediaInfoArray = mediaTweets.flatMap((tweetData: object) =>
    getMediaInfo(tweetData)
  );

  // 新規メディアのみフィルタ
  const newMediaInfoArray = mediaInfoArray.filter(
    (mediaInfo: MediaInfo) => !checkMediaExists(db, mediaInfo.fileName)
  );

  if (newMediaInfoArray.length === 0) return;

  // ダウンロードとDB登録
  for (const mediaInfo of newMediaInfoArray) {
    if (mediaInfo.mediaType === "photo") {
      mediaCount.photo += 1;
    } else {
      mediaCount.video += 1;
    }
    // DB登録
    insertMedia(db, mediaInfo, responseType);
    // ダウンロード
    await downloadMedia(mediaInfo, dirname, savePath);
  }

  printResult(responseType, mediaCount, userName);
}
