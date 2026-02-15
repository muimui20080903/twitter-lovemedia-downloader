import type { AppConfig } from "../types/index.ts";

/** config.jsonを読み込んで検証する */
export async function loadConfig(configPath = "./config.json"): Promise<AppConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Deno.readTextFile(configPath));
  } catch (e) {
    throw new Error(`設定ファイルの読み込みに失敗しました: ${configPath}\n${e}`);
  }
  validateConfig(raw);
  return raw as AppConfig;
}

/** 設定ファイルの必須フィールドを検証する */
function validateConfig(config: unknown): asserts config is AppConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("設定ファイルが不正です: オブジェクトではありません");
  }

  const c = config as Record<string, unknown>;

  // auth検証
  if (!c.auth || typeof c.auth !== "object") {
    throw new Error("設定エラー: authセクションがありません");
  }
  const auth = c.auth as Record<string, unknown>;
  if (!auth.authToken || typeof auth.authToken !== "string") {
    throw new Error("設定エラー: auth.authTokenが必要です");
  }
  if (!auth.ct0 || typeof auth.ct0 !== "string") {
    throw new Error("設定エラー: auth.ct0が必要です");
  }

  // storage検証
  if (!c.storage || typeof c.storage !== "object") {
    throw new Error("設定エラー: storageセクションがありません");
  }
  const storage = c.storage as Record<string, unknown>;
  if (!storage.savePath || typeof storage.savePath !== "string") {
    throw new Error("設定エラー: storage.savePathが必要です");
  }
  if (!storage.dbPath || typeof storage.dbPath !== "string") {
    throw new Error("設定エラー: storage.dbPathが必要です");
  }

  // sources検証
  if (!c.sources || typeof c.sources !== "object") {
    throw new Error("設定エラー: sourcesセクションがありません");
  }
  const sources = c.sources as Record<string, unknown>;
  if (!sources.bookmarks || typeof sources.bookmarks !== "object") {
    throw new Error("設定エラー: sources.bookmarksが必要です");
  }
  if (!Array.isArray(sources.likes)) {
    throw new Error("設定エラー: sources.likesは配列である必要があります");
  }
  if (!Array.isArray(sources.media)) {
    throw new Error("設定エラー: sources.mediaは配列である必要があります");
  }
  if (!Array.isArray(sources.tweets)) {
    throw new Error("設定エラー: sources.tweetsは配列である必要があります");
  }
}
