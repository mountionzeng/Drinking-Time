import {
  getStoryById,
  updateStoryBodyIfRevision,
} from "../repositories/stories";
import { getStoryGeneratedImages } from "../repositories/images";
import {
  jsonRecord,
  persistedStoryBodyRevision,
} from "../repositories/storyValues";
import { shotIdentityFromShot } from "../../shared/shotIdentity";

export type ShotConversationMedia = {
  stableShotId: string;
  imageIds: number[];
  instruction: string;
  createdAt: number;
  editorUserId: number;
};
/** Provenance only. Never promotes, assigns, or moves an image on the timeline. */
export async function recordShotConversationMedia(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  imageIds: number[];
  instruction: string;
}) {
  const imageIds = [...new Set(input.imageIds)];
  if (!imageIds.length) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const story = await getStoryById(input.storyId, input.userId);
    if (!story) throw new Error("故事不存在或无权访问");
    const body = jsonRecord(story.body);
    const shots = Array.isArray(body.shots) ? body.shots : [];
    if (
      !shots.some(
        (s, i) =>
          shotIdentityFromShot(s as Record<string, unknown>, i) ===
          input.stableShotId
      )
    )
      throw new Error("镜头不存在，图片仍保留在仓库");
    const images = await getStoryGeneratedImages(input.storyId, input.userId);
    if (imageIds.some(id => !images.some(image => image.id === id)))
      throw new Error("图片不属于当前故事");
    const records = (
      Array.isArray(body.shotConversationMedia)
        ? body.shotConversationMedia
        : []
    ) as ShotConversationMedia[];
    const remaining = imageIds.filter(
      id =>
        !records.some(
          r => r.stableShotId === input.stableShotId && r.imageIds.includes(id)
        )
    );
    if (!remaining.length) return;
    const revision = persistedStoryBodyRevision(body);
    if (
      await updateStoryBodyIfRevision({
        id: input.storyId,
        userId: input.userId,
        expectedRevision: revision,
        body: {
          ...body,
          _revision: revision + 1,
          shotConversationMedia: [
            ...records,
            {
              stableShotId: input.stableShotId,
              imageIds: remaining,
              instruction: input.instruction,
              createdAt: Date.now(),
              editorUserId: input.userId,
            },
          ],
        },
      })
    )
      return;
  }
  throw new Error("镜头记录保存冲突，图片仍保留在仓库");
}
