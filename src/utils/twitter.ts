import path from "node:path";
import type { MediaInfo, VideoMedia } from "../types/index.ts";
import { TWITTER_BASE_URL, VIDEO_EXTENSION } from "../constants/index.ts";

// deno-lint-ignore no-explicit-any
type TweetData = any;

/** ツイートにメディアが含まれているかを判定する（プロモーション除外） */
export const hasMedia = (tweetData: TweetData): boolean => {
  if (tweetData.promotedMetadata) return false;

  const hasTweetCard = tweetData.tweet.card;
  if (hasTweetCard) {
    const hasWebsiteVideo =
      tweetData.tweet.card.legacy.bindingValues[0].value.stringValue;
    if (hasWebsiteVideo) return true;
  }

  const hasMediaContent =
    tweetData.tweet.legacy.entities.media ||
    tweetData.tweet.legacy.extendedEntities;
  return !!hasMediaContent;
};

/** 画像情報を抽出する */
function extractPhotoInfo(tweetData: TweetData): MediaInfo[] {
  const tweet = tweetData.tweet.legacy;
  if (!tweet.entities.media) return [];

  return tweet.entities.media.map(
    (media: { mediaUrlHttps: string }, index: number) => {
      const extname = path.extname(media.mediaUrlHttps);
      return {
        userName: tweetData.user.legacy.name,
        userScreenName: tweetData.user.legacy.screenName,
        userId: tweetData.user.restId,
        tweetUrl: `${TWITTER_BASE_URL}/${tweetData.user.legacy.screenName}/status/${tweetData.tweet.restId}`,
        tweetId: tweetData.tweet.restId,
        createdAt: tweetData.tweet.legacy.createdAt,
        mediaType: "photo" as const,
        mediaUrl: media.mediaUrlHttps,
        fileName: `${tweetData.user.legacy.screenName}-${tweetData.tweet.restId}-${index}${extname}`,
      };
    }
  );
}

/** 最高ビットレートの動画URLを取得する */
function getBestVideoUrl(variants: { bitrate: number; url: string }[]): string {
  let maxBitrate = 0;
  let maxBitrateUrl = "";
  for (const variant of variants) {
    if (variant.bitrate >= maxBitrate) {
      maxBitrate = variant.bitrate;
      maxBitrateUrl = variant.url;
    }
  }
  return maxBitrateUrl;
}

/** 動画情報を抽出する */
function extractVideoInfo(tweetData: TweetData): MediaInfo[] {
  const tweet = tweetData.tweet.legacy;
  if (!tweet.extendedEntities) return [];

  const results: MediaInfo[] = [];
  tweet.extendedEntities.media.forEach(
    (media: VideoMedia, index: number) => {
      if (!media.videoInfo) return;
      const bestUrl = getBestVideoUrl(media.videoInfo.variants);
      results.push({
        userName: tweetData.user.legacy.name,
        userScreenName: tweetData.user.legacy.screenName,
        userId: tweetData.user.restId,
        tweetUrl: `${TWITTER_BASE_URL}/${tweetData.user.legacy.screenName}/status/${tweetData.tweet.restId}`,
        tweetId: tweetData.tweet.restId,
        createdAt: tweetData.tweet.legacy.createdAt,
        mediaType: media.type as MediaInfo["mediaType"],
        mediaUrl: bestUrl,
        fileName: `${tweetData.user.legacy.screenName}-${tweetData.tweet.restId}-${index}${VIDEO_EXTENSION}`,
      });
    }
  );
  return results;
}

/** ツイートデータからメディア情報を抽出する */
export const getMediaInfo = (tweetData: TweetData): MediaInfo[] => {
  const photos = extractPhotoInfo(tweetData);
  const videos = extractVideoInfo(tweetData);
  return [...photos, ...videos];
};
