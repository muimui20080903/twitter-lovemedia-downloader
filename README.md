# twitter-lovemedia-downloader
いいね欄からメディアを引っ張ってきて保存する  
cookieでログインしているから鍵垢の画像も見られる  
凍結の可能性があるのでどうでもいいアカウントでログインする

# 設定
1. `config.json`に取得したい`username`と`userId`、保存先のディレクトリとかを書く
2. `config.json`にログイン情報である`authToken`および`ct0`をcookieから探して書く  
[cookieの取り方](https://belltree.life/tweet-camouflage-by-cookie/)
1. `default-twitterpic.db`のファイル名を`twitterpic.db`に変える

# 実行
```
$ npm install
$ npm start
```
___

# 開発の記録
## 2023/9/18(日)
前に使ってたTwitterいいね画像保存するやつ使えなくなっちゃったから新しく作る  
使ってたのはtwitter-api-sdk  
### 候補
* twitter-api-v2
* [twitter-openapi-typescript](https://github.com/fa0311/twitter-openapi-typescript)

twitter-api-v2はよくわからなかった
### 手順  
1. いいね欄取得  
→画像のurlとかのデータ抜き出す
2. tweetIDをキーにSQLの中にデータあるか確認して、  
   既に保存したやつか判定
3. urlから画像のDL
```SQLite3
$ sqlite3 twitterpic.db
sqlite3>
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
とりあえずはできたけど
* 動画が保存できない
* いいね欄のデータ取得が20ツイートしかできない
## 動画保存
レスポンスのデータの中にはツイートのurlとサムネイルの画像しかなかった  
動画のurlが欲しい  
よさげな文献探す
#### 文献その1
* [Pythonを使いTwitterの動画を保存する方法](https://note.com/rukusepo/n/nb6afd1e0e71c)  
2023年2月16日  
pythonのコードだから試せない
```
# <前略>
download_url = f"https://twitter.com/i/videos/tweet/{video_id}?src=5"

# Send a GET request to the download URL
response = requests.get(download_url)

# Extract the video URL from the response JSON data
data = response.json()
video_url = data['track']['playbackUrl']
```
ツイートIDからdownload_urlを生成するところまではできた
tweet_url:https://x.com/Blue_ArchiveJP/status/1702230881363234877  
download_url:https://twitter.com/i/videos/tweet/1702230881363234877?src=5
> ダウンロード URL に GET リクエストを送信し、レスポンスの JSON データから動画 URL を抽出します。最後に、動画の URL に GET リクエストを送信し、動画を MP4 ファイルとして保存します。

download_urlにGETリクエスト送った後レスポンプのJSONデータから動画URLが抽出できない
#### 文献その2
* [Twitterの動画をPCで保存する](https://leafcage.hateblo.jp/entry/20161108/1478537510)  
2016-11-08

>※下記内容は2017/6/1現在、Twitterの仕様が変わったので、HTMLソースからエスケープされたjsonを得ることはできません。  
>代わりにHTMLソースから、div.PlayableMedia-playerのbackground-image:url('https://pbs.twimg.com/tweet_video_thumb/XXXXXX.jpg')のXXXXXXの部分をコピーしてhttps://video.twimg.com/tweet_video/XXXXXX.mp4にすればダウンロードできると思います。  
>またはTwitterのAPIからjsonを得ることができます。

やってみる
> ('https://pbs.twimg.com/tweet_video_thumb/XXXXXX.jpg')のXXXXXXの部分をコピーしてhttps://video.twimg.com/tweet_video/XXXXXX.mp4に  

(https://pbs.twimg.com/ext_tw_video_thumb/1702230797372317696/pu/img/EmV_yT3U_wAVaOvm.jpg)の`1702230797372317696`の部分をコピーして
(https://video.twimg.com/tweet_video/1702230797372317696.mp4)に  
→このサイトにアクセスできません

>またはTwitterのAPIからjsonを得ることができます。

→TwitterのAPIは停止中