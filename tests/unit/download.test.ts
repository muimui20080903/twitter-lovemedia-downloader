import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertSpyCalls, spy } from "https://deno.land/std@0.224.0/testing/mock.ts";
import { downloadMedia } from "../../src/utils/download.ts";
import type { MediaInfo } from "../../src/types/index.ts";

/** テスト用のMediaInfoを生成する */
function createTestMediaInfo(overrides: Partial<MediaInfo> = {}): MediaInfo {
  return {
    userName: "TestUser",
    userScreenName: "testuser",
    userId: "user123",
    tweetUrl: "https://twitter.com/testuser/status/123",
    tweetId: "123",
    createdAt: "2024-01-01",
    mediaType: "photo",
    mediaUrl: "https://pbs.twimg.com/media/test.jpg",
    fileName: "testuser-123-0.jpg",
    ...overrides,
  };
}

Deno.test("downloadMedia: 正常系 - ステータス200でファイルが保存される", async () => {
  const testData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNGヘッダの一部
  const tmpDir = await Deno.makeTempDir();

  // fetchをモック
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(testData, { status: 200, statusText: "OK" }),
    );

  try {
    const mediaInfo = createTestMediaInfo({ fileName: "test-download.jpg" });
    await downloadMedia(mediaInfo, "", tmpDir);

    // ファイルが存在し、内容が正しいことを確認
    const savedData = await Deno.readFile(`${tmpDir}/test-download.jpg`);
    assertEquals(savedData, testData);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("downloadMedia: 正常系 - dirnameありでサブディレクトリに保存される", async () => {
  const testData = new Uint8Array([0xff, 0xd8, 0xff]); // JPEGヘッダの一部
  const tmpDir = await Deno.makeTempDir();
  const subDir = `${tmpDir}/subdir`;
  await Deno.mkdir(subDir);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(testData, { status: 200, statusText: "OK" }),
    );

  try {
    const mediaInfo = createTestMediaInfo({ fileName: "test-subdir.jpg" });
    await downloadMedia(mediaInfo, "subdir", tmpDir);

    const savedData = await Deno.readFile(`${subDir}/test-subdir.jpg`);
    assertEquals(savedData, testData);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("downloadMedia: 異常系 - ステータス404でエラーログ出力（例外は投げない）", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(null, { status: 404, statusText: "Not Found" }),
    );

  // console.errorをスパイ
  const errorSpy = spy(console, "error");

  try {
    const mediaInfo = createTestMediaInfo({
      mediaUrl: "https://pbs.twimg.com/media/deleted.jpg",
    });
    // 例外を投げずに正常に完了すること
    await downloadMedia(mediaInfo, "", "/tmp");

    // console.errorが呼ばれたことを確認
    assertSpyCalls(errorSpy, 1);
  } finally {
    errorSpy.restore();
    globalThis.fetch = originalFetch;
  }
});
