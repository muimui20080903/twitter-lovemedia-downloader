const config = JSON.parse(await Deno.readTextFile("./config.json"))
import path from "node:path"
import { TwitterOpenApi} from "npm:twitter-openapi-typescript@0.0.32" //うまい感じに型を読み込んで定義したい
const api = new TwitterOpenApi()
const client = await api.getClientFromCookies({
  ct0: config.ct0,
  auth_token: config.authToken,
})
import { Database } from "https://deno.land/x/sqlite3@0.10.0/mod.ts"
const db = new Database(config.dbdir)

const main = async () => {
  // ブックマーク
  {
    // ブックマークデータを取得
    const BookMarks = await client.getTweetApi().getBookmarks()
    downloadMediaByResponce("bookmark", BookMarks, config["bookmarksDirname"], undefined)
  }
  // いいね
  for (const user of config["LikesUserList"]) {
    if (!user.userId) continue;
    try {
      // 一秒間のタイムアウト
      setTimeout(() => { }, 1000)
      const Likes = await client.getTweetApi().getLikes({ userId: user.userId })
      downloadMediaByResponce("likes", Likes, user.dirname, `${user.name}(${user.username})`) // メディアツイート情報取得
    } catch (e) {
      if(user.erroIgnore === true) continue;
      console.log(`${e}\n${user.username}さんのいいね欄から画像を取得中にエラーが発生しました\n`)
    }
  }
  // メディア
  for (const user of config["MediaUserList"]) {
    if (!user.userId) continue;
    try {
      // 一秒間のタイムアウト
      setTimeout(() => { }, 1000)
      const Media = await client.getTweetApi().getUserMedia({ userId: user.userId })
      downloadMediaByResponce("media",Media, user.dirname,`${user.name}(${user.username})`)
    } catch (e) {
      if (user.erroIgnore === true) continue;
      console.log(`${e}\n${user.username}さんのメディア欄から画像を取得中にエラーが発生しました\n`)
    }
  }
  db.close()
}

type MediaInfo = {
  userName: string, // ユーザーの表示名
  userScreenName: string, // ユーザー名(@aaa)
  userId: string, // ユーザーid
  tweetUrl: string, // ツイートのurl
  tweetId: string, // ツイートID
  createdAt: string, // ツイートの作成日時
  mediaType: string, // メディアの種類
  mediaUrl: string, // メディアのurl
  fileName: string // ファイル名
}

// ツイートのなかにメディアがあればtrueを返す
const hasMedia = (tweetData:any): boolean => {
  if (tweetData.promotedMetadata) return false; // プロモーションはリターン

  const hasTweet_Card = tweetData.tweet.card
  if (hasTweet_Card) {
    const has_websiteVideo = tweetData.tweet.card.legacy.bindingValues[0].value.stringValue
    if (has_websiteVideo) return true;
  }

  const has_Media = tweetData.tweet.legacy.entities.media || tweetData.tweet.legacy.extendedEntities
  return has_Media;
}

// ツイートから保存に必要な情報のみ取得して返す
const getMediaInfo = (tweetData: any): MediaInfo[] => {
  const mediaInfoArray: MediaInfo[] = []
  const tweet = tweetData.tweet.legacy
  const hasVideo: boolean = tweet.extendedEntities // ||tweet.extendedEntities.media.length > 0
  const hasPhoto: boolean = tweet.entities.media //.length > 0

  // 画像情報を取得
  if (hasPhoto) {
    // ツイートに含まれている画像をすべて保存
    tweet.entities.media.forEach((media: { mediaUrlHttps: string }, index: number) => {
      const extname: string = path.extname(media.mediaUrlHttps);
      const mediaInfo: MediaInfo = {
        userName: tweetData.user.legacy.name,
        userScreenName: tweetData.user.legacy.screenName,
        userId: tweetData.user.restId,
        tweetUrl: `https://twitter.com/${tweetData.user.legacy.screenName}/status/${tweetData.tweet.restId}`,
        tweetId: tweetData.tweet.restId,
        createdAt: tweetData.tweet.legacy.createdAt,
        mediaType: "photo",
        mediaUrl: media.mediaUrlHttps,
        fileName: `${tweetData.user.legacy.screenName}-${tweetData.tweet.restId}-${index}${extname}`
      }
      mediaInfoArray.push(mediaInfo)
    });
  }
  // 動画情報を取得
  if (hasVideo) {
    // ツイートに含まれている動画の情報
    type VideoMedia = {
      videoInfo: {
        variants: {
          bitrate: number,
          url: string
        }[]
      },
      type: string
    }
    // ツイートに含まれている動画をすべて保存
    tweet.extendedEntities.media.forEach((media: VideoMedia, index: number) => {
      if (!media.videoInfo) return;
      // 動画の場合、各バリアントのなかから一番ビットレートの高いURLを取得
      let maxBitrate = 0;
      let maxBitrateUrl = "";
      const variants = media.videoInfo.variants;
      variants.forEach((variant: { bitrate: number, url: string }) => {
        if (variant.bitrate >= maxBitrate) { // animated_gifはビットレートが0になるので、`maxBitrate = 0`にしておく
          maxBitrate = variant.bitrate;
          maxBitrateUrl = variant.url;
        }
      });
      const mediaInfo: MediaInfo = {
        userName: tweetData.user.legacy.name,
        userScreenName: tweetData.user.legacy.screenName,
        userId: tweetData.user.restId,
        tweetUrl: `https://twitter.com/${tweetData.user.legacy.screenName}/status/${tweetData.tweet.restId}`,
        tweetId: tweetData.tweet.restId,
        createdAt: tweetData.tweet.legacy.createdAt,
        mediaType: media.type,
        mediaUrl: maxBitrateUrl,
        fileName: `${tweetData.user.legacy.screenName}-${tweetData.tweet.restId}-${index}.mp4`
      }
      mediaInfoArray.push(mediaInfo)
    });
  }
  return mediaInfoArray;
};

const checkSQL = (mediaInfo: MediaInfo): boolean => {
  // resultがすでにSQliteに載ってるかを確認
  let sql = `SELECT COUNT(*) FROM tweet WHERE file_name = '${mediaInfo.fileName}' LIMIT 1;`;
  const stmt = db.prepare(sql);
  const row: { "COUNT(*)": number } | undefined = stmt.get(1);
  if (!row) return false
  // データがあったらfalseを返す
  if (row["COUNT(*)"] !== 0) return false;
  //新規のデータであった場合resultをSQliteに格納
  sql = `INSERT INTO tweet (author_screenname,author_name, author_id, tweet_id, create_at, media_url, file_name) 
   VALUES(
    '${mediaInfo.userName}',
    '@${mediaInfo.userScreenName}',
     ${mediaInfo.userId},
     ${mediaInfo.tweetId},
    '${mediaInfo.createdAt}',
    '${mediaInfo.mediaUrl}',
    '${mediaInfo.fileName}'
    );`
  db.exec(sql);
  return true;
};

const downloadMedia = async (mediaInfo: MediaInfo, dirname: string): Promise<void> => {
  try {
    const response = await fetch(mediaInfo.mediaUrl);
    if (!response.ok) { throw new Error(`Failed to download ${mediaInfo.mediaUrl}, status: ${response.status}`); }
    const outputPath = dirname ? `${config.savepath}/${dirname}/${mediaInfo.fileName}` : `${config.savepath}/${mediaInfo.fileName}`;
    const MediaData = await response.arrayBuffer();
    const uint8Array = new Uint8Array(MediaData);
    await Deno.writeFile(outputPath, uint8Array);
  } catch (error) {
    console.error(`Failed to download ${mediaInfo.mediaUrl}: ${error.message}`);
  }
};

const downloadMediaByResponce = (responseBy: string, response: { data: { data: object[] } }, dirname: string, userName: string | undefined): Promise<void> => {
  // 返り値のオブジェクトの設定
  const mediaCount: { photo: number, video: number } = {
    photo: 0,
    video: 0,
  };
  // メディアツイートのみを抽出
  const mediatweets = response.data.data.filter((tweetData: object) => hasMedia(tweetData))
  // メディアツイートからメディア情報を取得
  const mediaInfoArray = mediatweets.flatMap((tweetData: object) => getMediaInfo(tweetData))
  // すでにダウンロード済みのものを除外
  const newMediaInfoArray = mediaInfoArray.filter((mediaInfo: MediaInfo) => checkSQL(mediaInfo))
  // 新規のメディアがなければ終了
  if(newMediaInfoArray.length === 0) return Promise.resolve();
  // メディアをダウンロード
  for (const mediaInfo of newMediaInfoArray) {
    if (mediaInfo.mediaType === "photo") {
      mediaCount.photo += 1;
    } else if (mediaInfo.mediaType === "video") {
      mediaCount.video += 1;
    }
    downloadMedia(mediaInfo, dirname);
  }

  switch (responseBy) {
    case "bookmark":
      console.log(`ブックマークから画像を${mediaCount.photo}枚、動画を${mediaCount.video}個取得しました`);
      break;
    case "likes":
      console.log(`${userName}さんのいいね欄から画像を${mediaCount.photo}枚、動画を${mediaCount.video}個取得しました`);
      break;
    case "media":
      console.log(`${userName}さんのメディア欄から画像を${mediaCount.photo}枚、動画を${mediaCount.video}個取得しました`);
      break;
  }
  return Promise.resolve();
}

main()
