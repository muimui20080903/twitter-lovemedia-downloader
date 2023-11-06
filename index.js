import { writeFile, readFile } from "fs/promises"
const config = JSON.parse(await readFile("./config.json"))
import path from "path"
import { TwitterOpenApi } from "twitter-openapi-typescript"
import fetch from "node-fetch"
const api = new TwitterOpenApi({ fetchApi: fetch })
const client = await api.getClientFromCookies(config.ct0, config.authToken)
import sqlite3 from "sqlite3"
const db = new sqlite3.Database(config.dbdir)

// メディア情報を集めて返す
const getAllMedia = async () => {
  const allPictures = []
  // ユーザごとに処理を実行し、画像を取得する Process the users and get their pictures
  for await (const user of config["UserList"]) {
    const userPictures = []
    const tweets = await getLikesMedia(user.userId); // メディアツイート情報取得
    for await (const tweet of tweets) { // ツイート個々に対して処理
      // ツイートのデータから保存するのに必要なurlとファイル名を抜き出し
      const mediaInfoArray = []
      const mediaInfo = await getMediaInfo(tweet)
      mediaInfoArray.push(...mediaInfo)
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
    console.log(`${user.username}の画像を${userPictures.filter((e) => e.media_type === "photo").length}枚、動画を${userPictures.filter((e) => e.media_type === "video").length}個取得しました`)
  }
  db.close()
  return allPictures;
}

// ユーザーIDからいいね欄のツイートを取得し、メディアを含んでいるもののみ返す
const getLikesMedia = async (userId) => {
  const response = await client.getTweetApi().getLikes({ userId: userId }) // userIDからいいね欄を取得
  const CheckHas_Media = (e) => {
    const Ispromoted = e.promotedMetadata
    let has_websiteVideo
    const hasTweet_Card = !!e.tweet.card
    if (hasTweet_Card) {
      has_websiteVideo = !!e.tweet.card.legacy.bindingValues[0].value.stringValue
      // console.log(e.tweet.card.legacy.bindingValues[0].value.stringValue)
      // stringValue = JSON.parse(e.tweet.card.legacy.bindingValues[0].value.stringValue)
      // stringValue = stringValue.media_entities
    }
    const has_Media = (!!e.tweet.legacy.entities.media || !!e.tweet.legacy.extendedEntities || !!has_websiteVideo)
    return !Ispromoted && has_Media
  }
  // response.data.data.forEach((e) => {
  //   if (e.user.legacy.screenName === "hameham2525") {
  //     // console.log(e.tweet.core.userResults.result.legacy)
  //     let stringValueOBJ = JSON.parse(e.tweet.card.legacy.bindingValues[0].value.stringValue)
  //     console.log(stringValueOBJ)
  //     // console.log(e.tweet.card.legacy.bindingValues[0].value.stringValue)
  //   }
  // })

  // console.log(response.data.data.length)
  const LikesMediatweets = response.data.data.filter((e) => CheckHas_Media(e)) // プロモーションツイートと画像のないツイートを除外
  return LikesMediatweets;
}
// ツイートから保存に必要な情報のみ取得して返す
const getMediaInfo = async (data) => {
  // メディア情報の初期化
  const mediaInfo = []
  // ツイートから必要なデータを抽出
  const tweet = data.tweet.legacy
  const hasVideo = tweet.extendedEntities && tweet.extendedEntities.media && tweet.extendedEntities.media.length > 0;
  const hasPhoto = tweet.entities && tweet.entities.media && tweet.entities.media.length > 0;
  const hasTweet_Card = !!data.tweet.card
  let  has_websiteVideo 
  if(hasTweet_Card){
    if(!!data.tweet.card.legacy.bindingValues[0].value.stringValue){
      has_websiteVideo = !!data.tweet.card.legacy.bindingValues[0].value.stringValue
    }
  }
  

  // 画像情報を取得
  if (hasPhoto) {
    tweet.entities.media.forEach((media, index) => {
      // if (media.type === "photo" || media.type === "video"||media.type === "animated_gif") {
      const extname = path.extname(media.mediaUrlHttps)
      mediaInfo.push({
        media_type: "photo", //media.type, // 動画のサムネのmedia.typeは"photo"ではなく"video""
        file_name: `${data.user.legacy.screenName}-${data.tweet.restId}-${index}${extname}`,
        url: media.mediaUrlHttps
      })
      // }
    })
  }
  if (has_websiteVideo) {
    let media = data.tweet.card.legacy.bindingValues[0].value.stringValue
    media = JSON.parse(media).media_entities
    media = media[Object.keys(media)]
    const ext = path.extname(media.media_url_https)
    mediaInfo.push({
      media_type: "photo",
      file_name: `${data.user.legacy.screenName}-${data.tweet.restId}-0.${ext}`,
      url: media.media_url_https
    })
  }

  // 動画情報を取得
  if (hasVideo || has_websiteVideo) {
    // if (hasVideo) {
    let medias = []
    if (has_websiteVideo) {
      let media = data.tweet.card.legacy.bindingValues[0].value.stringValue
      media = JSON.parse(media).media_entities
      media = media[Object.keys(media)]
      medias.push(media)
    } else {
      medias = tweet.extendedEntities.media
    }
    medias.forEach((media, index) => {
      if (media.type === "video" || media.type === "animated_gif") {
        // 動画の場合、各バリアントのなかから一番ビットレートの高いURLを取得
        let maxBitrate = 0
        let maxBitrateUrl
        const variants = has_websiteVideo ? media.video_info.variants : media.videoInfo.variants
        variants.forEach((variant) => {
          if (variant.bitrate >= maxBitrate) { // animated_gifはビットレートが0になるので、`maxBitrate = 0`にしておく
            maxBitrate = variant.bitrate
            maxBitrateUrl = variant.url
          }
        })
        mediaInfo.push({
          media_type: media.type, // "video"
          file_name: `${data.user.legacy.screenName}-${data.tweet.restId}-${index}.mp4`,
          url: maxBitrateUrl
        })
      }
    })
  }
  return mediaInfo;
}

const checkSQL = async (data, mediaInfo) => {
  // resultがすでにSQliteに載ってるかを確認
  let sql = "SELECT COUNT(*) FROM tweet WHERE file_name = ? LIMIT 1;"
  return new Promise((resolve, reject) => {
    db.get(sql, [mediaInfo.file_name], (err, row) => { // ツイートIDとインデックスで検索
      if (err) {
        reject("sql error\n" + err.message);
        return;
      }
      const IsNewData = row["COUNT(*)"] === 0
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

const downloadPic = async (picInfo) => {
  try {
    const response = await fetch(picInfo.url)
    if (!response.ok) {
      throw new Error(`Failed to download ${picInfo.url}, status: ${response.status}`)
    }
    const outputPath = `${config.savepath}/${picInfo.file_name}`
    const imageBuffer = Buffer.from(await response.arrayBuffer())
    await writeFile(outputPath, imageBuffer)
    // if(picInfo.media_type === "animated_gif"){
    //   // mp4で保存されるからgifに変換する
    //   const input = `${config.savepath}/${picInfo.file_name}`
    //   const output = `${config.savepath}/${path.basename(picInfo.file_name)}.gif`
    // }
  } catch (error) {
    console.error(`Failed to download ${picInfo.url}: ${error.message}`)
  }
}

const main = async () => {
  const allPictures = await getAllMedia()
  // すべての画像をダウンロードする Download all the pictures
  for (const picInfo of allPictures) {
    await downloadPic(picInfo)
  }
  // console.log("おわり 保存場所:" + config.savepath)
}

main()