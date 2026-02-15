import type { UserConfig, ResponseType, AppConfig } from "../types/index.ts";
import type { Database } from "https://deno.land/x/sqlite3@0.12.0/mod.ts";
import { sleep } from "../utils/common.ts";
import { API_TIMEOUT_MS } from "../constants/index.ts";
import { downloadMediaByResponse } from "../utils/download.ts";

/** ユーザーリストを巡回してメディアをダウンロードする */
export async function processUserList(
  userList: UserConfig[],
  // deno-lint-ignore no-explicit-any
  fetchFunction: (userId: string) => Promise<any>,
  responseType: ResponseType,
  config: AppConfig,
  db: Database,
): Promise<void> {
  for (const user of userList) {
    if (!user.userId) continue;
    try {
      await sleep(API_TIMEOUT_MS);
      const response = await fetchFunction(user.userId);
      await downloadMediaByResponse({
        responseType,
        response,
        dirname: user.dirname,
        userName: `${user.displayName}(${user.screenName})`,
        db,
        savePath: config.storage.savePath,
      });
    } catch (e) {
      if (user.errorIgnore) continue;
      console.error(
        `${e}\n${user.screenName}さんの${responseType}から取得中にエラーが発生しました\n`,
      );
    }
  }
}
