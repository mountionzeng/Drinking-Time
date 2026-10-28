import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./_core/env", () => ({ ENV: { cookieSecret: "test-only-chapter-secret" } }));
import { putChapterMedia, readChapterMedia, chapterMediaUrl, handleChapterMedia } from "./chapterMediaStore";
let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), "chapter-media-test-")); vi.stubEnv("CHAPTER_MEDIA_DIR", dir); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
const key = `chapters/10/${"a".repeat(64)}.webp`;
async function get(query: Record<string, string>) {
  const res = { setHeader: vi.fn(), sendStatus: vi.fn(), type: vi.fn(), send: vi.fn() };
  await handleChapterMedia({ query } as any, res as any); return res;
}
it("persists across reads, and serves bytes only under an unexpired key-bound signature", async () => {
  await putChapterMedia(key, Buffer.from("pixels"));
  expect((await readChapterMedia(key))?.toString()).toBe("pixels");
  const query = Object.fromEntries(new URL(chapterMediaUrl(key), "https://test.invalid").searchParams);
  expect((await get(query)).send).toHaveBeenCalledWith(Buffer.from("pixels"));
  expect((await get({ ...query, key: key.replace("/10/", "/11/") })).sendStatus).toHaveBeenCalledWith(404);
  expect((await get({ ...query, e: String(Date.now() - 1) })).sendStatus).toHaveBeenCalledWith(404);
  expect((await get({ ...query, token: "b".repeat(43) })).sendStatus).toHaveBeenCalledWith(404);
});
it("rejects paths outside chapter storage and oversized bytes", async () => {
  await expect(putChapterMedia("../../secret", Buffer.from("x"))).rejects.toThrow();
  expect(await readChapterMedia("../../secret")).toBeNull();
  await expect(putChapterMedia(key, Buffer.alloc(2 * 1024 * 1024 + 1))).rejects.toThrow("limit");
});
