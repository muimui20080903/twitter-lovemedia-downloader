//  todo :動画の保存
//       :一回の読み込みで20ツイートまでしか取得できない、50～100くらい欲しい

import { writeFile, readFile } from "fs/promises"
const config = JSON.parse(await readFile("./config.json"))
console.log(config)
import { TwitterOpenApi } from "twitter-openapi-typescript"
import fetch from "node-fetch"
const api = new TwitterOpenApi({ fetchApi: fetch })
const client = await api.getClientFromCookies(config.ct0, config.authToken)
import sqlite3 from "sqlite3"
const db = new sqlite3.Database(config.dbdir)
let sql

const getLikes = (async (userId) => {
  const results = []
  const response = await client.getTweetApi().getLikes({ userId: userId }) // userIDからいいね欄を取得
  // console.log(response.data.data.length)
  response.data.data.filter((e) => !e.promotedMetadata && !!e.tweet.legacy.entities.media) // プロモーションツイートと画像のないツイートを除外
    .forEach((data) => {
      // 複数枚画像のあるツイートについて、一枚ずつ処理
      data.tweet.legacy.entities.media.forEach((media, index) => {
        const file_name = `${data.user.legacy["screenName"]}-${data.tweet.restId}-${index}`
        // sqlの中のデータと照合して、存在しなかったら保存する
        checkSQL(data, media, file_name)
          .then((existInSQL) => {
            if (existInSQL) {
              const result = {
                media_type: media.type,
                file_name,
                url: media.mediaUrlHttps
              }
              results.push(result)
            }
          })
      })
    })
  return results;
})

const checkSQL = (async (data, media, file_name) => {
  //resultがすでにSQliteに載ってるかを確認
  sql = "SELECT COUNT(*) FROM tweet WHERE tweet_id = ? LIMIT 1;"
  db.get(sql, [media.idStr], (err, row) => {
    if (err) return console.log("sql error\n" + err.message);
    if (row['COUNT(*)'] !== 0) return;//console.log("すでにSQliteにあるデータです");
    //新規のデータであった場合resultをSQliteに格納
    sql = "INSERT INTO tweet (author_screenname,author_name, author_id, tweet_id, media_url, file_name) VALUES(?,?,?,?,?,?);"
    const a = [
      data.user.legacy.name, // ユーザーの表示名
      `@${data.user.legacy.screenName}`, //ユーザー名(@hogehoge)
      data.user.restId, // ユーザーid
      media.idStr, // ツイートID
      media.mediaUrlHttps, // 画像のurl
      file_name, // ファイル名
    ]
    db.run(sql, a, (err) => {
      if (err) return console.log("sql error\n" + err.message);
      return true;
    })
  })
})

const downloadPic = async (pic) => {
  try {
    const response = await fetch(pic.url)
    if (!response.ok) {
      throw new Error(`Failed to download ${pic.url}, status: ${response.status}`)
    }
    // todo 動画の保存
    const outputPath = pic.media_type === "photo" ? `${savepath}/${pic.file_name}.jpg` : `${savepath}/${pic.file_name}.mp4`
    const imageBuffer = Buffer.from(await response.arrayBuffer())
    await writeFile(outputPath, imageBuffer)
  } catch (error) {
    console.error(`Failed to download ${pic.url}: ${error.message}`)
  }
}


const main = async () => {
  const allPictures = []
  // ユーザごとに処理を実行し、画像を取得する Process the users and get their pictures
  for await (const user of config["UserList"]) {
    const userPictures = await getLikes(user.userId)
    allPictures.push(...userPictures)
    console.log(`${user.username}の画像を取得しました\n${userPictures.length}枚取得`)
  }
  db.close()
  // すべての画像をダウンロードする Download all the pictures
  for await (const pic of allPictures) {
    await downloadPic(pic)
  }
  console.log("おわり")
}

main()