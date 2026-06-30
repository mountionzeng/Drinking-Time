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
