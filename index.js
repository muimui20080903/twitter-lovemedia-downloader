//  todo :一回の読み込みで20ツイートまでしか取得できない、50～100くらい欲しい

import { writeFile, readFile } from "fs/promises"
const config = JSON.parse(await readFile("./config.json"))
import { TwitterOpenApi } from "twitter-openapi-typescript"
import fetch from "node-fetch"
const api = new TwitterOpenApi({ fetchApi: fetch })
const client = await api.getClientFromCookies(config.ct0, config.authToken)
import sqlite3 from "sqlite3"
const db = new sqlite3.Database(config.dbdir)

const getMediaInfo = async (data) => {
  // メディア情報の初期化
  const mediaInfo = []
  const tweet = data.tweet.legacy
  const hasVideo = tweet.extendedEntities && tweet.extendedEntities.media && tweet.extendedEntities.media.length > 0;
  const hasPhoto = tweet.entities && tweet.entities.media && tweet.entities.media.length > 0;

  // 画像情報を取得
  if (hasPhoto) {
    tweet.entities.media.forEach((media, index) => {
      if (media.type === 'photo') {
        mediaInfo.push({
          media_type: media.type, // 'photo'
          file_name: `${data.user.legacy.screenName}-${data.tweet.restId}-${index}.jpg`,
          url: media.mediaUrlHttps
        })
      }
    })
  }

  // 動画情報を取得
  if (hasVideo) {
    tweet.extendedEntities.media.forEach((media, index) => {
      if (media.type === 'video') {
        // 動画の場合、各バリアントのなかから一番ビットレートの高いURLを取得
        let maxBitrate = 0
        let maxBitrateUrl
        media.videoInfo.variants.forEach((variant) => {
          if (variant.bitrate > maxBitrate) {
            maxBitrate = variant.bitrate
            maxBitrateUrl = variant.url
          }
        })
        mediaInfo.push({
          media_type: media.type, // 'video'
          file_name: `${data.user.legacy.screenName}-${data.tweet.restId}-${index}.mp4`,
          url: maxBitrateUrl
        })
      }
    })
  }

  return mediaInfo;
}

const getLikesMedia = async (userId) => {
  const response = await client.getTweetApi().getLikes({ userId: userId }) // userIDからいいね欄を取得
  // console.log(response.data.data.length)
  const LikesMediatweets = response.data.data.filter((e) => !e.promotedMetadata && (!!e.tweet.legacy.entities.media || !!e.tweet.legacy.extendedEntities)) // プロモーションツイートと画像のないツイートを除外
  return LikesMediatweets;
}

const checkSQL = async (data, mediaInfo) => {
  // https://qiita.com/zaburo/items/a155cbc02832b501a8dd
  // node.jsでsqlite3を利用する
  // https://moewe-net.com/nodejs/sqlite3
  // Node.jsでSQLiteを使う
  // resultがすでにSQliteに載ってるかを確認
  let sql = "SELECT COUNT(*) FROM tweet WHERE file_name = ? LIMIT 1;"
  return new Promise((resolve, reject) => {
    db.get(sql, [mediaInfo.file_name], (err, row) => { // ツイートIDとインデックスで検索
      if (err) {
        reject("sql error\n" + err.message);
        return;
      }
      const IsNewData = row['COUNT(*)'] === 0
      if (IsNewData) {
        //新規のデータであった場合resultをSQliteに格納
        sql = "INSERT INTO tweet (author_screenname,author_name, author_id, tweet_id, media_url, file_name) VALUES(?,?,?,?,?,?);"
        const param = [
          data.user.legacy.name, // ユーザーの表示名
          `@${data.user.legacy.screenName}`, //ユーザー名(@hogehoge)
          data.user.restId, // ユーザーid
          data.tweet.restId, // ツイートID
          mediaInfo.url, // 画像のurl
          mediaInfo.file_name, // ファイル名
        ]
        db.run(sql, param, (err) => {
          if (err) return console.log("sql error\n" + err.message);
        })
      }
      resolve(IsNewData);
    })
  })
}

const downloadPic = async (pic) => {
  try {
    const response = await fetch(pic.url)
    if (!response.ok) {
      throw new Error(`Failed to download ${pic.url}, status: ${response.status}`)
    }
    const outputPath = `${config.savepath}/${pic.file_name}`
    const imageBuffer = Buffer.from(await response.arrayBuffer())
    await writeFile(outputPath, imageBuffer)
  } catch (error) {
    console.error(`Failed to download ${pic.url}: ${error.message}`)
  }
}


const getAllMedia = async () => {
  const allPictures = []
  // ユーザごとに処理を実行し、画像を取得する Process the users and get their pictures
  for await (const user of config["UserList"]) {
    const userPictures = []
    const tweets = await getLikesMedia(user.userId); // メディアツイート情報取得
    for await (const tweet of tweets) { // ツイート個々に対して処理
      // ツイートのデータから保存するのに必要なurlとファイル名を抜き出し
      const mediaInfoArray = await getMediaInfo(tweet)
      // ツイートひとつひとつに対して、メディアの情報を抜き出し
      for await (const mediaInfo of mediaInfoArray) {
        // sqlの中のデータと照合して、存在しなかったらallPicturesに保存する
        const IsNewData = await checkSQL(tweet, mediaInfo)
        if (IsNewData) {
          userPictures.push(mediaInfo)
        }
      }
    }
    allPictures.push(...userPictures)
    console.log(`${user.username}の画像を取得しました\n${userPictures.length}枚取得`)
  }
  db.close()
  return allPictures;
}
const main = async () => {
  const allPictures = await getAllMedia()
  // すべての画像をダウンロードする Download all the pictures
  for (const pic of allPictures) {
    await downloadPic(pic)
  }
  console.log("おわり")
}

main()