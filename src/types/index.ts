/** メディアの種類 */
export type MediaType = "photo" | "video" | "animated_gif";

/** レスポンスのソース種別 */
export type ResponseType = "bookmark" | "likes" | "media" | "tweet";

/** メディア情報 */
export type MediaInfo = {
  userName: string;
  userScreenName: string;
  userId: string;
  tweetUrl: string;
  tweetId: string;
  createdAt: string;
  mediaType: MediaType;
  mediaUrl: string;
  fileName: string;
};

/** ユーザー設定（config.jsonのsources内の各ユーザー） */
export type UserConfig = {
  userId: string;
  screenName: string;
  displayName: string;
  dirname: string;
  errorIgnore: boolean;
};

/** ブックマーク設定 */
export type BookmarkConfig = {
  enabled: boolean;
  dirname: string;
};

/** アプリケーション設定（新config.json構造） */
export type AppConfig = {
  auth: {
    authToken: string;
    ct0: string;
  };
  storage: {
    savePath: string;
    dbPath: string;
  };
  sources: {
    bookmarks: BookmarkConfig;
    likes: UserConfig[];
    media: UserConfig[];
    tweets: UserConfig[];
  };
};

/** メディアカウント */
export type MediaCount = {
  photo: number;
  video: number;
};

/** 動画バリアント */
export type VideoVariant = {
  bitrate: number;
  url: string;
};

/** 動画メディア */
export type VideoMedia = {
  videoInfo: {
    variants: VideoVariant[];
  };
  type: string;
};
