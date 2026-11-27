import { afterAll, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { asksForStoryPictures } from "../../shared/pictureRecall";

const temp = await mkdtemp(path.join(os.tmpdir(), "picture-recall-test-"));
vi.stubEnv("LOCAL_PERSIST_PATH", path.join(temp, "state.json"));
vi.stubEnv("DATABASE_URL", "");
const { createStory, updateStory } = await import("../repositories/stories");
const { createGeneratedImage, createImageSignal } = await import(
  "../repositories/images"
);
const { markAccountImageOpened, trashMemoryStory, openedAccountImages } =
  await import("../repositories/memorySpace");
const { findStoryPictures } = await import("./storyPictureRecall");
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(temp, { recursive: true, force: true });
});
it("finds relevant authored, supplied, explicitly adopted and opened pictures; a receipt or an assistant mention alone never qualifies", async () => {
  const owner = 718,
    story = await createStory({ userId: owner, title: "沿江", body: {} });
  const add = (
    i: number,
    origin: "user_import" | "generation" = "generation"
  ) =>
    createGeneratedImage(
      {
        userId: owner,
        storyId: story.id,
        imageUrl: "/api/images/boat-" + i + ".png",
        prompt: "渔船码头",
        isCurrent: false,
      },
      origin
    );
  const [ignored, opened, used, provided, mentioned, rejected, automatic] =
    await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        add(i, i === 3 ? "user_import" : "generation")
      )
    );
  const signal = (
    imageId: number,
    action: "swipe_right" | "swipe_left",
    source: string
  ) =>
    createImageSignal({
      userId: owner,
      storyId: story.id,
      imageId,
      action,
      metadata: { source },
    });
  await signal(used.id, "swipe_right", "chat_art_preview_choice");
  await signal(automatic.id, "swipe_right", "generate_for_mobile_auto_select");
  await signal(rejected.id, "swipe_left", "explicit");
  await markAccountImageOpened(owner, rejected.id);
  await markAccountImageOpened(owner, opened.id);
  await markAccountImageOpened(owner, opened.id);
  expect(
    [...(await openedAccountImages(owner))].filter(id => id === opened.id)
  ).toHaveLength(1);
  await updateStory(story.id, owner, {
    body: {
      messages: [
        { who: "u", text: `这是渔船 [[ref:image%3A${mentioned.id}]]` },
        { role: "assistant", content: `渔船 [[ref:image%3A${ignored.id}]]` },
        {
          role: "user",
          content: "手写的渔船日记",
          photoUrl: "/uploads/boat.jpg",
        },
      ],
    },
  });
  const hits = await findStoryPictures(owner, story.id, "帮我找之前的渔船照片");
  expect(
    hits
      .map(h => h.imageId)
      .filter(Boolean)
      .sort()
  ).toEqual([opened.id, used.id, provided.id, mentioned.id].sort());
  expect(hits.find(h => h.imageId === used.id)?.reason).toBe("已采用");
  expect(hits.find(h => h.imageId === opened.id)?.reason).toBe("已点开");
  expect(hits.find(h => h.url === "/uploads/boat.jpg")?.reason).toBe("已提供");
  expect(hits.find(h => h.imageId === provided.id)?.reason).toBe("已提供");
  expect(
    await findStoryPictures(owner, story.id, "找之前的雪山照片")
  ).toHaveLength(0);
});
it("searches other non-trashed stories of only the same account", async () => {
  const owner = 791;
  const current = await createStory({ userId: owner, title: "新稿", body: {} });
  const other = await createStory({
    userId: owner,
    title: "故乡",
    body: {
      messages: [
        { who: "u", text: "老屋天井", photoUrl: "/uploads/courtyard.jpg" },
      ],
    },
  });
  const foreign = await createStory({
    userId: owner + 1,
    title: "朋友",
    body: {
      messages: [
        { who: "u", text: "老屋天井", photoUrl: "/uploads/private.jpg" },
      ],
    },
  });
  const image = await createGeneratedImage({
    storyId: other.id,
    userId: owner,
    imageUrl: "/api/images/owned.png",
  });
  await expect(markAccountImageOpened(owner + 1, image.id)).rejects.toThrow();
  await expect(
    findStoryPictures(owner, foreign.id, "找图片")
  ).rejects.toThrow();
  const find = () =>
    findStoryPictures(owner, current.id, "找其他故事里的天井照片");
  expect((await find()).map(p => p.storyId)).toEqual([other.id]);
  await trashMemoryStory(owner, other.id);
  expect(await find()).toEqual([]);
});
it("does not commandeer an explicit render request", () => {
  expect(asksForStoryPictures("帮我找其他故事里的合影照片")).toBe(true);
  expect(asksForStoryPictures("用照片生成视频给我看看")).toBe(false);
  expect(asksForStoryPictures("不要再找这些照片了")).toBe(false);
});
