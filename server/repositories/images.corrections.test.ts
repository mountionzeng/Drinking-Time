import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";

const dir = await mkdtemp(path.join(os.tmpdir(), "image-correction-scope-"));
const previousPath = process.env.LOCAL_PERSIST_PATH;
const previousDb = process.env.DATABASE_URL;
process.env.LOCAL_PERSIST_PATH = path.join(dir, "db.json");
process.env.DATABASE_URL = "";
const { createImageSignal, getRecentChatCorrections } = await import("./images");
afterAll(async () => {
  if (previousPath === undefined) delete process.env.LOCAL_PERSIST_PATH;
  else process.env.LOCAL_PERSIST_PATH = previousPath;
  if (previousDb === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDb;
  await rm(dir, { recursive: true, force: true });
});
it("filters story scope before the limit, excluding legacy project-wide and other-story corrections", async () => {
  for (const storyId of [1217, 0, 1202]) await createImageSignal({
    userId: 48, storyId, imageId: null, action: "chat_correction",
    metadata: { projectId: 1129, correction: storyId === 1217 ? "保留手绘" : "旧故事的窒息感" },
  });
  const signals = await getRecentChatCorrections(1129, 1, 1217);
  expect(signals).toHaveLength(1);
  expect(signals[0].storyId).toBe(1217);
  expect(signals[0].metadata).toMatchObject({ correction: "保留手绘" });
  expect(await getRecentChatCorrections(1129, 10)).toHaveLength(3);
});
