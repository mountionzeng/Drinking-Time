import { beforeEach, expect, it } from "vitest";
process.env.DATABASE_URL = "";
import { resetMemoryStateForTesting } from "../repositories/runtime";
import { createStory, getStoryById } from "../repositories/stories";
import {
  createGeneratedImage,
  getStoryGeneratedImages,
} from "../repositories/images";
import { recordShotConversationMedia } from "./shotConversationMedia";
import { readChatImageRevisions } from "./chatImageRevision";
beforeEach(() => resetMemoryStateForTesting());
it("archives unassigned candidates durably without changing their assignment or current image", async () => {
  const story = await createStory({
    userId: 123,
    title: "history",
    body: { shots: [{ shotNo: 1, stableShotId: "s1" }] },
  });
  const current = await createGeneratedImage({
    storyId: story.id,
    userId: 123,
    shotNo: "SH01",
    shotIdentity: "s1",
    imageUrl: "/current",
    isCurrent: true,
  });
  const candidate = await createGeneratedImage({
    storyId: story.id,
    userId: 123,
    imageUrl: "/candidate",
    isCurrent: false,
  });
  const input = {
    storyId: story.id,
    userId: 123,
    stableShotId: "s1",
    imageIds: [candidate.id],
    instruction: "brighter",
  };
  await Promise.all([
    recordShotConversationMedia(input),
    recordShotConversationMedia(input),
  ]);
  const images = await getStoryGeneratedImages(story.id, 123);
  expect(images.find(i => i.id === current.id)?.isCurrent).toBe(true);
  expect(images.find(i => i.id === candidate.id)).toMatchObject({
    isCurrent: false,
    shotIdentity: null,
    shotNo: null,
  });
  const history = await readChatImageRevisions(story.id, 123);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    stableShotId: "s1",
    instruction: "brighter",
    candidates: [{ imageId: candidate.id, imageUrl: "/candidate" }],
  });
  expect(history[0].decision).toBeUndefined();
  await expect(
    recordShotConversationMedia({ ...input, userId: 124 })
  ).rejects.toThrow();
  await expect(
    recordShotConversationMedia({ ...input, stableShotId: "missing" })
  ).rejects.toThrow();
  const other = await createStory({
    userId: 123,
    title: "other",
    body: { shots: [{ shotNo: 1, stableShotId: "s1" }] },
  });
  await expect(
    recordShotConversationMedia({ ...input, storyId: other.id })
  ).rejects.toThrow("图片不属于当前故事");
  expect((await getStoryById(other.id, 123))?.body).not.toHaveProperty(
    "shotConversationMedia"
  );
});
