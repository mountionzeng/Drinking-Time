import { afterAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const temp = await mkdtemp(path.join(os.tmpdir(), "book-storyboard-atomic-"));
const previous = {
  path: process.env.LOCAL_PERSIST_PATH,
  db: process.env.DATABASE_URL,
};
process.env.LOCAL_PERSIST_PATH = path.join(temp, "data.json");
process.env.DATABASE_URL = "";
const chapters = await import("./chapters");
const { saveBookStoryboard } = await import("./bookStoryboard");
const { createStory } = await import("./stories");
afterAll(async () => {
  if (previous.path === undefined) delete process.env.LOCAL_PERSIST_PATH;
  else process.env.LOCAL_PERSIST_PATH = previous.path;
  if (previous.db === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous.db;
  await rm(temp, { recursive: true, force: true });
});
async function fixture() {
  const story = await createStory({
    userId: 41,
    title: "分镜稿回归",
    body: {},
  });
  await Promise.all(
    ["小雨的故事", "老陈的故事"].map(body =>
      chapters.insertChapter({
        storyId: story.id,
        userId: 41,
        content: {
          title: body,
          layout: null,
          blocks: {
            body,
            blockIds: ["original"],
            containsAiText: false,
            settings: null,
            coverKey: null,
            bodyTextureKey: null,
            images: {},
            illustrations: [],
          },
        },
      })
    )
  );
  const rows = await chapters.listChapters(story.id, 41);
  return {
    storyId: story.id,
    userId: 41,
    expected: rows.map(({ id, version }) => ({ id, version })),
    updates: rows.map(row => ({
      id: row.id,
      blocks: { ...row.blocks, body: `分镜稿\n${row.blocks.body}` },
    })),
    rows,
  };
}
it("writes all chapters with recoverable exact source versions and refuses stale retry", async () => {
  const input = await fixture();
  await saveBookStoryboard(input);
  for (const original of input.rows) {
    expect((await chapters.getChapter(original.id, 41))?.version).toBe(2);
    expect(
      (await chapters.listChapterVersions(original.id, 41))[0]
    ).toMatchObject({ version: 1, blocks: original.blocks });
  }
  await expect(saveBookStoryboard(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
});
it("a conflicting later chapter prevents every update", async () => {
  const input = await fixture();
  const later = input.rows[1];
  await chapters.saveChapterContent({
    id: later.id,
    userId: 41,
    expectedVersion: later.version,
    content: { blocks: { ...later.blocks, body: "用户刚写的新内容" } },
    reason: "manual",
  });
  await expect(saveBookStoryboard(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await chapters.getChapter(input.rows[0].id, 41))?.blocks).toEqual(
    input.rows[0].blocks
  );
  expect((await chapters.getChapter(later.id, 41))?.blocks.body).toBe(
    "用户刚写的新内容"
  );
});
it("another account cannot write these chapters", async () => {
  const input = await fixture();
  await expect(
    saveBookStoryboard({ ...input, userId: 99 })
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await chapters.getChapter(input.rows[0].id, 41))?.version).toBe(1);
});
