import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV } from "../_core/env";
import {
  createImageSignal,
  createGeneratedImage,
  createStory,
  createVideoTake,
  resetMemoryStateForTesting,
} from "../db";
import {
  confirmPromptCandidateForStory,
  createPromptCandidateForStory,
  getStoryPromptProjection,
} from "./promptLineage";
import { migrateStoryPromptLineage } from "./promptLineageMigration";
import { normalizeTimelineItems, getStoryMaterialState } from "./storyMaterials";
import { selectVideoTimelineSegment } from "./videoTimeline";

const savedDatabaseUrl = ENV.databaseUrl;

async function seedPromptStory() {
  const body = {
    shots: [
      {
        stableShotId: "shot-01",
        shotIdentity: "shot-01",
        shotNo: 1,
        subject: "主角站在窗边",
        dialogue: "没关系，就这样吧",
        promptDraft: "窗边，纪录片写实，克制构图",
        cameraMove: "固定机位",
      },
    ],
  };
  const story = await createStory({
    userId: 1,
    projectId: null,
    title: "故事",
    body,
  });
  await migrateStoryPromptLineage({
    storyId: story.id,
    userId: 1,
    body,
    source: "initial",
  });
  return { id: story.id, body };
}

async function getPromptProjection(storyId: number) {
  const projection = await getStoryPromptProjection({ storyId, userId: 1 });
  expect(projection).not.toBeNull();
  return projection!;
}

async function selectImage(storyId: number, imageId: number) {
  await createImageSignal({
    userId: 1,
    storyId,
    imageId,
    action: "swipe_right",
    metadata: null,
  });
}

beforeEach(() => {
  resetMemoryStateForTesting();
  ENV.databaseUrl = "";
});

afterEach(() => {
  ENV.databaseUrl = savedDatabaseUrl;
});

describe("normalizeTimelineItems", () => {
  const facts = [
    { stableShotId: "shot-a", shotNo: 1, plannedDurationMs: 1800 },
    { stableShotId: "shot-b", shotNo: 2, plannedDurationMs: 2400 },
  ];

  it("bootstraps all story shots in canonical order", () => {
    expect(normalizeTimelineItems(undefined, facts)).toMatchObject([
      { stableShotId: "shot-a", included: true, position: 0 },
      { stableShotId: "shot-b", included: true, position: 1 },
    ]);
  });

  it("keeps persisted order and transform while appending a new shot", () => {
    const items = normalizeTimelineItems(
      [
        {
          stableShotId: "shot-b",
          included: false,
          transform: { zoom: 2, cropWidth: 0.5 },
        },
      ],
      facts
    );
    expect(items[0]).toMatchObject({
      stableShotId: "shot-b",
      included: false,
      position: 0,
      transform: { zoom: 2, cropWidth: 0.5 },
    });
    expect(items[1]).toMatchObject({
      stableShotId: "shot-a",
      included: true,
      position: 1,
    });
  });
});

describe("getStoryMaterialState", () => {
  it("matches imported genji assets to legacy shot identities by shot number", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "旧素材故事",
      body: {
        shots: [
          {
            stableShotId: "legacy-sh01-shot",
            shotIdentity: "legacy-sh01-shot",
            shotNo: 1,
            subject: "蒙眼的女主",
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: null,
      shotIdentity: "genji-s01",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "旧导入首帧",
      generationType: "initial",
      isCurrent: true,
    });
    const take = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "genji-s01",
      sourceImageId: image.id,
      status: "available",
      provider: "local",
      model: "imported",
      prompt: "旧导入视频",
      durationSec: 8,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/take-1.mp4",
      extractionCapability: "available",
    });
    await selectImage(story.id, image.id);

    const materials = await getStoryMaterialState(story.id, 1);
    const shot = materials?.shots[0];

    expect(shot).toMatchObject({
      stableShotId: "legacy-sh01-shot",
      shotNo: 1,
    });
    expect(shot?.currentImage?.id).toBe(image.id);
    expect(shot?.videoTakes.map(item => item.id)).toContain(take.id);
  });

  it("returns unassigned imported images for the material warehouse", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "素材仓库故事",
      body: {
        shots: [
          {
            stableShotId: "shot-01",
            shotIdentity: "shot-01",
            shotNo: 1,
            subject: "主角看向窗外",
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: null,
      shotIdentity: null,
      imageUrl: "data:image/png;base64,BBBB",
      imageKey: null,
      prompt: "从 Finder 导入",
      generationType: "initial",
      isCurrent: false,
    });

    const materials = await getStoryMaterialState(story.id, 1);

    expect(materials?.unassignedImages.map(item => item.id)).toContain(
      image.id
    );
    expect(materials?.shots[0]?.imageVersions).toEqual([]);
  });

  it("returns unmatched video takes for the material warehouse", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "旧视频素材故事",
      body: {
        shots: [
          {
            stableShotId: "shot-01",
            shotIdentity: "shot-01",
            shotNo: 1,
            subject: "主角看向窗外",
          },
        ],
      },
    });
    const matchedTake = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "shot-01",
      sourceImageId: null,
      status: "available",
      provider: "local",
      model: "imported",
      prompt: "当前镜头视频",
      durationSec: 5,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/take-current.mp4",
      extractionCapability: "available",
    });
    const unmatchedTake = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "old-shot-99",
      sourceImageId: null,
      status: "available",
      provider: "local",
      model: "imported",
      prompt: "旧镜头视频",
      durationSec: 8,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/take-old.mp4",
      extractionCapability: "available",
    });

    const materials = await getStoryMaterialState(story.id, 1);

    expect(materials?.shots[0]?.videoTakes.map(item => item.id)).toContain(
      matchedTake.id
    );
    expect(materials?.shots[0]?.videoTakes.map(item => item.id)).not.toContain(
      unmatchedTake.id
    );
    expect(materials?.unassignedVideoTakes.map(item => item.id)).toContain(
      unmatchedTake.id
    );
    expect(materials?.unassignedVideoTakes.map(item => item.id)).not.toContain(
      matchedTake.id
    );
  });

  it("returns reusable video takes from the user's other stories", async () => {
    const currentStory = await createStory({
      userId: 1,
      projectId: null,
      title: "当前故事",
      body: {
        shots: [
          {
            stableShotId: "shot-01",
            shotIdentity: "shot-01",
            shotNo: 1,
            subject: "主角看向窗外",
          },
        ],
      },
    });
    const oldStory = await createStory({
      userId: 1,
      projectId: null,
      title: "旧故事",
      body: { shots: [] },
    });
    const reusableTake = await createVideoTake({
      storyId: oldStory.id,
      userId: 1,
      stableShotId: "genji-s04",
      sourceImageId: null,
      status: "available",
      provider: "local",
      model: "imported",
      prompt: "旧故事可复用视频",
      durationSec: 6,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/take-reusable.mp4",
      extractionCapability: "available",
    });
    const unusableTake = await createVideoTake({
      storyId: oldStory.id,
      userId: 1,
      stableShotId: "genji-s05",
      sourceImageId: null,
      status: "unfollowable",
      provider: "local",
      model: "imported",
      prompt: "旧故事不可用视频",
      durationSec: 6,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/take-bad.mp4",
      extractionCapability: "available",
    });

    const materials = await getStoryMaterialState(currentStory.id, 1);

    expect(materials?.reusableVideoTakes.map(item => item.id)).toContain(
      reusableTake.id
    );
    expect(materials?.reusableVideoTakes.map(item => item.id)).not.toContain(
      unusableTake.id
    );
  });

  it("projects selected reusable takes back onto matching current story shots", async () => {
    const currentStory = await createStory({
      userId: 1,
      projectId: null,
      title: "当前故事",
      body: {
        shots: [
          {
            stableShotId: "legacy-sh02-shot",
            shotIdentity: "legacy-sh02-shot",
            shotNo: 3,
            subject: "插入镜头后的原 SH02",
          },
          {
            stableShotId: "manual-sh02-extra",
            shotIdentity: "manual-sh02-extra",
            shotNo: 2,
            subject: "手动插入镜头",
          },
        ],
      },
    });
    const oldStory = await createStory({
      userId: 1,
      projectId: null,
      title: "旧故事",
      body: { shots: [] },
    });
    const selectedTake = await createVideoTake({
      storyId: oldStory.id,
      userId: 1,
      stableShotId: "genji-s02",
      sourceImageId: null,
      status: "available",
      provider: "local",
      model: "imported",
      prompt: "旧故事已选视频",
      durationSec: 6,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/take-selected.mp4",
      extractionCapability: "available",
    });
    await selectVideoTimelineSegment(
      {
        storyId: oldStory.id,
        stableShotId: "genji-s02",
        takeId: selectedTake.id,
        selectionType: "full_take",
      },
      1
    );

    const materials = await getStoryMaterialState(currentStory.id, 1);
    const legacyShot = materials?.shots.find(
      shot => shot.stableShotId === "legacy-sh02-shot"
    );
    const manualShot = materials?.shots.find(
      shot => shot.stableShotId === "manual-sh02-extra"
    );

    expect(legacyShot?.currentVideo).toMatchObject({
      id: selectedTake.id,
      storyId: oldStory.id,
      stableShotId: "genji-s02",
      isTimelineSelected: true,
      videoUrl: "/api/videos/take-selected.mp4",
    });
    expect(legacyShot?.videoTakes.map(item => item.id)).toContain(
      selectedTake.id
    );
    expect(manualShot?.videoTakes.map(item => item.id)).not.toContain(
      selectedTake.id
    );
  });

  it("does not match legacy assets to manually inserted shots with inherited display numbers", async () => {
    const manualShotId = "manual-sh03-mrd3pyj1-0rn9tj";
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "插入镜头故事",
      body: {
        shots: [
          {
            stableShotId: "legacy-sh02-shot",
            shotIdentity: "legacy-sh02-shot",
            shotNo: 2,
            subject: "原 SH02",
          },
          {
            stableShotId: manualShotId,
            shotIdentity: manualShotId,
            shotNo: 3,
            subject: "新增镜头",
          },
          {
            stableShotId: "legacy-sh03-shot",
            shotIdentity: "legacy-sh03-shot",
            shotNo: 4,
            subject: "原 SH03",
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH03",
      shotIdentity: "legacy-sh03-shot",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "原 SH03 画面",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, image.id);

    const materials = await getStoryMaterialState(story.id, 1);
    const manualShot = materials?.shots.find(
      shot => shot.stableShotId === manualShotId
    );
    const legacyShot = materials?.shots.find(
      shot => shot.stableShotId === "legacy-sh03-shot"
    );

    expect(manualShot?.currentImage).toBeNull();
    expect(manualShot?.imageVersions).toEqual([]);
    expect(legacyShot?.currentImage?.id).toBe(image.id);
  });

  it("auto-binds current prompt compilations to new image and video assets", async () => {
    const story = await seedPromptStory();
    const projection = await getPromptProjection(story.id);
    const imageHead = projection.compilationHeads.find(
      head => head.stableShotId === "shot-01" && head.modality === "image"
    );
    const videoHead = projection.compilationHeads.find(
      head => head.stableShotId === "shot-01" && head.modality === "video"
    );

    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-01",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "窗边主图",
      generationType: "initial",
      isCurrent: true,
    });
    const take = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "shot-01",
      sourceImageId: image.id,
      status: "available",
      provider: "302",
      model: "mj-video",
      prompt: "轻微推近",
      durationSec: 5,
      aspectRatio: "16:9",
      videoUrl: "/api/video/1",
      extractionCapability: "unavailable",
    });

    expect(image.promptCompilationId).toBe(imageHead?.currentCompilationId);
    expect(take.promptCompilationId).toBe(videoHead?.currentCompilationId);
  });

  it("marks the current image stale after the image prompt changes", async () => {
    const story = await seedPromptStory();
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-01",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "窗边主图",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, image.id);
    const projection = await getPromptProjection(story.id);
    const imageNode = projection.nodes.find(
      node => node.stableShotId === "shot-01" && node.dimension === "image_prompt"
    );
    expect(imageNode).toBeTruthy();

    const candidate = await createPromptCandidateForStory({
      storyId: story.id,
      userId: 1,
      nodeId: imageNode!.id,
      content: "窗边半身，中景，保留玻璃反光",
      reason: "调整构图",
      authorType: "user",
      expectedVersion: projection.state.version,
      operationKey: "story-materials-image-candidate",
    });
    await confirmPromptCandidateForStory({
      storyId: story.id,
      userId: 1,
      candidateRevisionId: candidate.candidate.id,
      expectedVersion: candidate.version,
      operationKey: "story-materials-image-confirm",
    });

    const materials = await getStoryMaterialState(story.id, 1);
    expect(materials?.shots[0].currentImage).toMatchObject({
      id: image.id,
      promptFreshness: "stale",
    });
  });

  it("marks the adopted video stale when both source image and video prompt drift", async () => {
    const story = await seedPromptStory();
    const firstImage = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-01",
      imageUrl: "data:image/png;base64,AAAA",
      imageKey: null,
      prompt: "第一版主图",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, firstImage.id);
    const take = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "shot-01",
      sourceImageId: firstImage.id,
      status: "available",
      provider: "302",
      model: "mj-video",
      prompt: "固定机位轻推",
      durationSec: 5,
      aspectRatio: "16:9",
      videoUrl: "/api/video/1",
      extractionCapability: "unavailable",
    });
    await selectVideoTimelineSegment(
      {
        storyId: story.id,
        stableShotId: "shot-01",
        takeId: take.id,
        selectionType: "full_take",
      },
      1
    );

    const secondImage = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-01",
      imageUrl: "data:image/png;base64,BBBB",
      imageKey: null,
      prompt: "第二版主图",
      generationType: "generate",
      isCurrent: true,
    });
    await selectImage(story.id, secondImage.id);

    const projection = await getPromptProjection(story.id);
    const videoNode = projection.nodes.find(
      node => node.stableShotId === "shot-01" && node.dimension === "camera_motion"
    );
    expect(videoNode).toBeTruthy();
    const candidate = await createPromptCandidateForStory({
      storyId: story.id,
      userId: 1,
      nodeId: videoNode!.id,
      content: "缓慢推近到人物肩部",
      reason: "加强情绪靠近",
      authorType: "user",
      expectedVersion: projection.state.version,
      operationKey: "story-materials-video-candidate",
    });
    await confirmPromptCandidateForStory({
      storyId: story.id,
      userId: 1,
      candidateRevisionId: candidate.candidate.id,
      expectedVersion: candidate.version,
      operationKey: "story-materials-video-confirm",
    });

    const materials = await getStoryMaterialState(story.id, 1);
    const shot = materials?.shots[0];
    const staleTake = shot?.videoTakes.find(item => item.id === take.id);

    expect(shot?.currentImage?.imageUrl).toBe("data:image/png;base64,BBBB");
    expect(staleTake).toMatchObject({
      id: take.id,
      promptFreshness: "stale",
      isStale: true,
    });
    expect(staleTake?.staleReasons).toEqual(
      expect.arrayContaining(["source_image", "prompt"])
    );
    expect(shot?.currentVideo).toBeNull();
  });
});
