/** 保存先ディレクトリの存在を確認する */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    const stat = await Deno.stat(dirPath);
    if (!stat.isDirectory) {
      throw new Error(`${dirPath} はディレクトリではありません`);
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(`保存先ディレクトリが存在しません: ${dirPath}`);
    }
    throw e;
  }
}

/** 保存先ディレクトリに書き込み権限があるか確認する */
export async function checkWritePermission(dirPath: string): Promise<void> {
  const testFile = `${dirPath}/.write_test_${Date.now()}`;
  try {
    await Deno.writeTextFile(testFile, "");
    await Deno.remove(testFile);
  } catch {
    throw new Error(`保存先ディレクトリに書き込み権限がありません: ${dirPath}`);
  }
}

/** 全保存先ディレクトリを一括検証する */
export async function validateStoragePaths(
  savePath: string,
  dirnames: string[],
): Promise<void> {
  await ensureDirectoryExists(savePath);
  await checkWritePermission(savePath);
  for (const dirname of dirnames) {
    if (!dirname) continue;
    const fullPath = `${savePath}/${dirname}`;
    await ensureDirectoryExists(fullPath);
  }
}
