import { afterEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { createGeneratedImage, createStory } from "../db";
import { chaptersRouter } from "../routers/chapters";
import { bookVideoRouter } from "../routers/bookVideo";
import { readPreviewArtBasis } from "./artPreview";

afterEach(() => vi.unstubAllEnvs());

it("retains the cover selected from the story warehouse when the author imports the book into video", async () => {
  vi.stubEnv("CHAPTER_PACKAGE_ENABLED", "true");
  const userId = 71;
  const story = await createStory({ userId, title: "纸舟", body: { shots: [] } });
  const storyId = story.id;
  const ctx = { user: { id: userId, name: "作者" }, req: {}, res: {} } as unknown as TrpcContext;
  const book = chaptersRouter.createCaller(ctx), video = bookVideoRouter.createCaller(ctx);
  const image = await createGeneratedImage({ storyId, userId, imageUrl: "/api/images/paper-boat.png",
    imageKey: "generated/paper-boat.png", isCurrent: false });
  const body = "静物场景\n桌面上的纸舟\n窗边的纸舟";
  const chapter = await book.create({ storyId, kind: "storyboard", title: "纸舟合成分镜", body });
  await book.save({ chapterId: chapter.id, expectedVersion: chapter.version, body,
    writingStyle: [{id:"s", format:"scene", parentId:null, collapsed:false},
      {id:"a", format:"shot", parentId:"s", collapsed:false}, {id:"b", format:"shot", parentId:"s", collapsed:false}],
    media:{coverKey:image.imageUrl,bodyTextureKey:null,illustrations:[]} });
  const { fingerprint } = await video.importReview({ storyId });
  await video.importStoryboard({ storyId, chapterId: chapter.id, expectedFingerprint:fingerprint, id: "sample-book-boat" });
  expect(await readPreviewArtBasis(storyId, userId)).toMatchObject({coverImageId:image.id, source: "纸舟 · 分镜稿 V1 · 视频 V1"});
});
