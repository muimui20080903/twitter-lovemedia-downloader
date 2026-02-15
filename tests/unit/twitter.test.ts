import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasMedia, getMediaInfo } from "../../src/utils/twitter.ts";

// --- モックデータ ---

/** プロモーションツイート（広告） */
const mockPromotedTweet = {
  promotedMetadata: { advertiser: "some_ad" },
  tweet: {
    card: null,
    restId: "111111",
    legacy: {
      createdAt: "2024-01-01",
      entities: {
        media: [{ mediaUrlHttps: "https://pbs.twimg.com/media/ad.jpg" }],
      },
      extendedEntities: null,
    },
  },
  user: {
    restId: "user111",
    legacy: { name: "AdUser", screenName: "aduser" },
  },
};

/** メディアなしツイート */
const mockTweetNoMedia = {
  promotedMetadata: undefined,
  tweet: {
    card: null,
    restId: "222222",
    legacy: {
      createdAt: "2024-01-02",
      entities: {},
      extendedEntities: null,
    },
  },
  user: {
    restId: "user222",
    legacy: { name: "NoMediaUser", screenName: "nomediauser" },
  },
};

/** 画像1枚のツイート */
const mockTweetWithPhoto = {
  promotedMetadata: undefined,
  tweet: {
    card: null,
    restId: "333333",
    legacy: {
      createdAt: "2024-01-03",
      entities: {
        media: [{ mediaUrlHttps: "https://pbs.twimg.com/media/test.jpg" }],
      },
      extendedEntities: null,
    },
  },
  user: {
    restId: "user333",
    legacy: { name: "PhotoUser", screenName: "photouser" },
  },
};

/** 動画ツイート */
const mockTweetWithVideo = {
  promotedMetadata: undefined,
  tweet: {
    card: null,
    restId: "444444",
    legacy: {
      createdAt: "2024-01-04",
      entities: {},
      extendedEntities: {
        media: [
          {
            type: "video",
            videoInfo: {
              variants: [
                { bitrate: 256000, url: "https://video.twimg.com/low.mp4" },
                { bitrate: 2176000, url: "https://video.twimg.com/high.mp4" },
                { bitrate: 832000, url: "https://video.twimg.com/mid.mp4" },
              ],
            },
          },
        ],
      },
    },
  },
  user: {
    restId: "user444",
    legacy: { name: "VideoUser", screenName: "videouser" },
  },
};

// --- hasMedia テスト ---

Deno.test("hasMedia: プロモーションツイートはfalseを返す", () => {
  assertEquals(hasMedia(mockPromotedTweet), false);
});

Deno.test("hasMedia: メディアなしツイートはfalseを返す", () => {
  assertEquals(hasMedia(mockTweetNoMedia), false);
});

Deno.test("hasMedia: 画像ありツイートはtrueを返す", () => {
  assertEquals(hasMedia(mockTweetWithPhoto), true);
});

Deno.test("hasMedia: 動画ありツイートはtrueを返す", () => {
  assertEquals(hasMedia(mockTweetWithVideo), true);
});

// --- getMediaInfo テスト ---

Deno.test("getMediaInfo: 画像1枚のツイートからMediaInfo配列を返す", () => {
  const result = getMediaInfo(mockTweetWithPhoto);
  assertEquals(result.length, 1);
  assertEquals(result[0].userName, "PhotoUser");
  assertEquals(result[0].userScreenName, "photouser");
  assertEquals(result[0].userId, "user333");
  assertEquals(result[0].tweetId, "333333");
  assertEquals(result[0].mediaType, "photo");
  assertEquals(result[0].mediaUrl, "https://pbs.twimg.com/media/test.jpg");
  assertEquals(result[0].fileName, "photouser-333333-0.jpg");
  assertEquals(
    result[0].tweetUrl,
    "https://twitter.com/photouser/status/333333",
  );
});

Deno.test("getMediaInfo: 動画ツイートから最高ビットレートの動画を選択する", () => {
  const result = getMediaInfo(mockTweetWithVideo);
  assertEquals(result.length, 1);
  assertEquals(result[0].mediaType, "video");
  // 最高ビットレート（2176000）のURLが選択される
  assertEquals(result[0].mediaUrl, "https://video.twimg.com/high.mp4");
  assertEquals(result[0].fileName, "videouser-444444-0.mp4");
});

Deno.test("getMediaInfo: メディアなしツイートから空配列を返す", () => {
  const result = getMediaInfo(mockTweetNoMedia);
  assertEquals(result.length, 0);
});
