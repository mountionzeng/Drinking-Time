import { expect, it } from "vitest";
import { createStory } from "../repositories/stories";
import {
  createGeneratedImage,
  createImageSignal,
} from "../repositories/images";
import {
  getChapter,
  insertChapter,
  saveChapterContent,
  listChapterVersions,
} from "../repositories/chapters";
import { bookImageText } from "../../shared/bookImageBlock";
import {
  adoptedBookPictureChanges,
  latestBookPicture,
} from "./bookPictureVersions";
import { findStoryPictures } from "./storyPictureRecall";

it("reuses an explicitly uploaded video-keyframe edit in the book while an untouched generated sibling stays out", async () => {
  const userId = 805,
    story = await createStory({ userId, title: "普通旅行故事", body: {} });
  const base = { userId, storyId: story.id, isCurrent: false };
  const source = await createGeneratedImage(
    { ...base, imageUrl: "/uploads/wharf.jpg" },
    "user_import"
  );
  const accepted = await createGeneratedImage(
    {
      ...base,
      imageUrl: "/uploads/wharf-fixed.jpg",
      parentImageId: source.id,
      generationType: "inpaint",
    },
    "user_import"
  );
  await createGeneratedImage({
    ...base,
    imageUrl: "/uploads/wharf-candidate.jpg",
    parentImageId: source.id,
    generationType: "inpaint",
  });
  expect(await latestBookPicture(userId, story.id, source.id)).toEqual({
    imageId: accepted.id,
    url: accepted.imageUrl,
  });
  const rows = await findStoryPictures(userId, story.id, "找之前的图片");
  expect(rows.map(row => row.imageId)).toEqual([accepted.id]);
});

it("saves the photo edit with the chapter and resolves both the original and its intermediate edit to the latest adopted version", async () => {
  const userId = 708,
    story = await createStory({ userId, title: "祖父的相册", body: {} });
  const image = (name: string) =>
    createGeneratedImage({
      storyId: story.id,
      userId,
      imageUrl: "/api/images/" + name + ".jpg",
      isCurrent: false,
      prompt: "祖父的合影",
    });
  const [original, clean, cropped, ignored] = await Promise.all(
    ["scan", "clean", "crop", "unused"].map(image)
  );
  const chapter = await insertChapter({
    storyId: story.id,
    userId,
    content: {
      title: "照片",
      layout: null,
      blocks: {
        body: bookImageText(original.imageUrl),
        blockIds: ["image"],
        writingStyle: [
          { id: "same", format: "text", parentId: null, collapsed: false },
        ],
        settings: null,
        coverKey: null,
        bodyTextureKey: null,
        illustrations: [],
        containsAiText: false,
        images: {},
      },
    },
  });
  const edit = async (from: typeof original, to: typeof original) => {
    const row = (await getChapter(chapter.id, userId))!;
    const blocks = {
      ...row.blocks,
      body: bookImageText(to.imageUrl),
      writingStyle: [
        { ...row.blocks.writingStyle![0], revisedBookImageFrom: from.imageUrl },
      ],
    };
    const changes = await adoptedBookPictureChanges(
      story.id,
      userId,
      row.blocks,
      blocks
    );
    expect(changes).toEqual([{ parentImageId: from.id, imageId: to.id }]);
    await saveChapterContent({
      id: row.id,
      userId,
      content: { blocks },
      reason: "edit",
      expectedVersion: row.version,
      bookImageRevisions: changes,
    });
    await expect(
      saveChapterContent({
        id: row.id,
        userId,
        content: { blocks },
        reason: "edit",
        expectedVersion: row.version,
        bookImageRevisions: changes,
      })
    ).rejects.toThrow();
  };
  await edit(original, clean);
  await edit(clean, cropped);
  for (const start of [original, clean, cropped])
    expect((await latestBookPicture(userId, story.id, start.id)).imageId).toBe(
      cropped.id
    );
  expect(
    (await listChapterVersions(chapter.id, userId)).at(-1)?.blocks.body
  ).toBe(bookImageText(original.imageUrl));
  expect(
    (await findStoryPictures(userId, story.id, "找之前的合影照片")).map(
      p => p.imageId
    )
  ).toEqual([cropped.id]);
  expect((await latestBookPicture(userId, story.id, ignored.id)).imageId).toBe(
    ignored.id
  );
  await expect(
    latestBookPicture(userId + 1, story.id, original.id)
  ).rejects.toThrow();
  await createImageSignal({
    userId,
    storyId: story.id,
    imageId: cropped.id,
    action: "swipe_left",
  });
  expect((await latestBookPicture(userId, story.id, original.id)).imageId).toBe(
    clean.id
  );
});
