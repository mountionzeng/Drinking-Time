import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV } from "../_core/env";
import {
  createImageSignal,
  createGeneratedImage,
  createStory,
  createVideoTake,
  getStoryById,
  resetMemoryStateForTesting,
  updateStoryBodyIfRevision,
  updateStoryTimeline,
} from "../db";
import {
  confirmPromptCandidateForStory,
  createPromptCandidateForStory,
  getStoryPromptProjection,
} from "./promptLineage";
import { migrateStoryPromptLineage } from "./promptLineageMigration";
import {
  normalizeTimelineItems,
  getStoryMaterialState,
} from "./storyMaterials";
import { selectVideoTimelineSegment } from "./videoTimeline";
import {
  PUBLISHING_COVER_SHOT_IDENTITY,
  PUBLISHING_COVER_SHOT_NO,
} from "@shared/imageAsset";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "@shared/publishingDraft";
import { requiredVisualAssetViewRoles } from "@shared/visualAssets";

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

  it("preserves a persisted heartbeat effect for the editing preview", () => {
    const [item] = normalizeTimelineItems(
      [
        {
          stableShotId: "shot-a",
          primaryVideoEdit: {
            takeId: 12,
            sourceStartSec: 0,
            sourceEndSec: 1.8,
            effects: {
              playbackRate: 1,
              reverse: false,
              volume: 1,
              muted: false,
              motionPreset: { kind: "heartbeat", bpm: 72, scaleAmount: 0.06 },
            },
          },
        },
      ],
      facts
    );

    expect(item.primaryVideoEdit?.effects.motionPreset).toEqual({
      kind: "heartbeat",
      bpm: 72,
      scaleAmount: 0.06,
    });
  });

  it("preserves ordinary visual layers and independent image clips", () => {
    const [item] = normalizeTimelineItems(
      [
        {
          stableShotId: "shot-a",
          visualLayer: 4,
          imageClips: [
            {
              id: "image-clip-99-first",
              imageId: 99,
              imageUrl: "/frame.webp",
              label: "第一份",
              offsetFrames: 30,
              timelineStartFrame: 345,
              durationFrames: 1,
              visualLayer: 5,
            },
            {
              id: "image-clip-99-second",
              imageId: 99,
              imageUrl: "/frame.webp",
              label: "第二份",
              offsetFrames: 30,
              durationFrames: 1,
              visualLayer: 6,
            },
          ],
        },
      ],
      facts
    );

    expect(item.visualLayer).toBe(4);
    expect(item.imageClips).toMatchObject([
      {
        id: "image-clip-99-first",
        imageId: 99,
        timelineStartFrame: 345,
        visualLayer: 5,
      },
      { id: "image-clip-99-second", imageId: 99, visualLayer: 6 },
    ]);
  });

  it("preserves a non-owning image reference on an ordinary timeline shot", () => {
    const [item] = normalizeTimelineItems(
      [{ stableShotId: "shot-a", referencedImageId: 99 }],
      facts
    );

    expect(item.referencedImageId).toBe(99);
  });

  it("keeps valid split video clips and discards malformed timeline clips", () => {
    const items = normalizeTimelineItems(
      [
        {
          stableShotId: "shot-a",
          included: true,
          visualClipsReplacePrimary: true,
          visualClips: [
            {
              id: "right",
              takeId: 12,
              rangeId: 102,
              sourceStableShotId: "shot-a",
              videoUrl: "/api/videos/12",
              label: "后段",
              sourceStartSec: 1.2,
              sourceEndSec: 2.4,
              offsetMs: 1_200,
              durationMs: 1_200,
            },
            {
              id: "left",
              takeId: 12,
              rangeId: 101,
              sourceStableShotId: "shot-a",
              videoUrl: "/api/videos/12",
              label: "前段",
              sourceStartSec: 0,
              sourceEndSec: 1.2,
              offsetMs: 0,
              durationMs: 1_200,
              effects: {
                playbackRate: 8,
                reverse: true,
                volume: -1,
                muted: true,
              },
              transform: { zoom: 3, panX: 0.4 },
            },
            {
              id: "missing-video",
              takeId: 12,
              rangeId: 103,
              sourceStableShotId: "shot-a",
              videoUrl: "",
              sourceStartSec: 0,
              sourceEndSec: 1,
              offsetMs: 0,
              durationMs: 1_000,
            },
          ],
        },
      ],
      facts
    );

    expect(items[0]).toMatchObject({
      stableShotId: "shot-a",
      visualClipsReplacePrimary: true,
      visualClips: [
        {
          id: "left",
          offsetMs: 0,
          effects: {
            playbackRate: 4,
            reverse: true,
            volume: 0,
            muted: true,
          },
          transform: { zoom: 3, panX: 0.4 },
        },
        { id: "right", offsetMs: 1_200 },
      ],
    });
  });

  it("derives canonical frame placement for legacy contiguous timelines", () => {
    const items = normalizeTimelineItems(undefined, facts);

    expect(items.map(item => item.durationFrames)).toEqual([54, 72]);
    expect(items.map(item => item.timelineStartFrame)).toEqual([0, 54]);
    expect(items.map(item => item.stackOrder)).toEqual([0, 1]);
  });

  it("preserves explicit placement and appends a mixed legacy item at max end", () => {
    const items = normalizeTimelineItems(
      [
        {
          stableShotId: "shot-a",
          plannedDurationMs: 1800,
          durationFrames: 54,
          timelineStartFrame: 90,
          stackOrder: 8,
          anchors: [
            {
              id: "anchor-a",
              timelineFrame: 100,
              sourceType: "primary-video",
              sourceId: "take-12",
              sourceTimeSec: 1 / 3,
            },
            {
              id: "anchor-a",
              timelineFrame: 101,
              sourceType: "primary-video",
              sourceId: "take-12",
              sourceTimeSec: 0.4,
            },
          ],
        },
      ],
      facts
    );

    expect(items.map(item => item.timelineStartFrame)).toEqual([90, 144]);
    expect(items[0].anchors).toEqual([
      {
        id: "anchor-a",
        timelineFrame: 100,
        sourceType: "primary-video",
        sourceId: "take-12",
        sourceTimeSec: 1 / 3,
      },
    ]);
    expect(items[0].stackOrder).toBe(8);
  });

  it("preserves an explicit magnetic detachment only for a named neighbour", () => {
    const items = normalizeTimelineItems(
      [
        { stableShotId: "shot-a" },
        {
          stableShotId: "shot-b",
          detachedFromPreviousShotId: "shot-a",
        },
      ],
      facts
    );

    expect(items[1].detachedFromPreviousShotId).toBe("shot-a");
  });

  it("appends a placement-less item after the global maximum end, not a running one", () => {
    // shot-a carries no start but is listed first; it must still land after
    // shot-b's explicit range rather than at frame 0.
    const items = normalizeTimelineItems(
      [
        { stableShotId: "shot-a", plannedDurationMs: 1800, durationFrames: 54 },
        {
          stableShotId: "shot-b",
          plannedDurationMs: 2400,
          durationFrames: 72,
          timelineStartFrame: 300,
        },
      ],
      facts
    );

    expect(items.map(item => item.stableShotId)).toEqual(["shot-a", "shot-b"]);
    expect(items.map(item => item.timelineStartFrame)).toEqual([372, 300]);
  });

  it("keeps stack orders above every explicit value regardless of listing order", () => {
    const items = normalizeTimelineItems(
      [
        { stableShotId: "shot-a", timelineStartFrame: 0 },
        { stableShotId: "shot-b", timelineStartFrame: 60, stackOrder: 40 },
      ],
      facts
    );

    expect(items.map(item => item.stackOrder)).toEqual([41, 40]);
  });

  it("drops malformed anchors without disturbing valid placement", () => {
    const [item] = normalizeTimelineItems(
      [
        {
          stableShotId: "shot-a",
          timelineStartFrame: 12,
          anchors: [
            {
              id: "valid",
              timelineFrame: 13,
              sourceType: "image",
              sourceId: "image-1",
              sourceTimeSec: null,
            },
            {
              id: "bad-type",
              timelineFrame: 14,
              sourceType: "marker",
              sourceId: "x",
              sourceTimeSec: null,
            },
          ],
        },
      ],
      facts
    );

    expect(item.timelineStartFrame).toBe(12);
    expect(item.anchors).toEqual([
      {
        id: "valid",
        timelineFrame: 13,
        sourceType: "image",
        sourceId: "image-1",
        sourceTimeSec: null,
      },
    ]);
  });
});

describe("Story visual asset material projection", () => {
  it("projects only this Story's locked assets and stable-shot binding", async () => {
    const views = requiredVisualAssetViewRoles("character").map(
      (role, index) => ({
        id: `view-${role}`,
        role,
        imageId: 800 + index,
        status: "pass",
      })
    );
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "视觉资产投影",
      body: {
        _revision: 1,
        shots: [
          {
            stableShotId: "shot-visual-1",
            shotIdentity: "shot-visual-1",
            shotNo: 1,
          },
        ],
        visualAssets: {
          schemaVersion: 1,
          legacyMigrationVersion: 1,
          assets: [
            {
              id: "character-a",
              kind: "character",
              name: "红外套人物",
              currentVersionId: "character-v1",
              createdAt: 1,
              updatedAt: 2,
              versions: [
                {
                  id: "character-v1",
                  version: 1,
                  status: "locked",
                  referenceImageIds: [701],
                  legacyReferenceIds: [],
                  fixedFacts: {
                    kind: "character",
                    face: "圆脸",
                    hair: "齐耳短发",
                    outfit: "红色长外套",
                    accessories: [],
                  },
                  allowedVariations: ["景别", "光线"],
                  conflicts: [],
                  boardImageId: 799,
                  views,
                  createdAt: 1,
                  lockedAt: 2,
                },
              ],
            },
          ],
          proposals: [],
          bindings: [
            {
              stableShotId: "shot-visual-1",
              character: {
                assetId: "character-a",
                versionId: "character-v1",
              },
              confirmedAt: 3,
            },
          ],
          operations: [],
        },
      },
    });

    const materials = await getStoryMaterialState(story.id, 1);

    expect(materials?.visualAssets?.assets).toHaveLength(1);
    expect(materials?.shots[0]?.visualAssetBinding).toMatchObject({
      stableShotId: "shot-visual-1",
      character: { assetId: "character-a", versionId: "character-v1" },
    });
    await expect(getStoryMaterialState(story.id, 2)).resolves.toBeNull();
  });
});

describe("getStoryMaterialState", () => {
  it("keeps a retained timeline segment playable after its source shot is deleted", async () => {
    const sourceStableShotId = "shot-source";
    const retainedStableShotId = "shot-retained";
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "删除来源镜头后保留素材",
      body: {
        shots: [
          { stableShotId: sourceStableShotId, shotNo: 1 },
          { stableShotId: retainedStableShotId, shotNo: 2 },
        ],
      },
    });
    const take = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: sourceStableShotId,
      sourceImageId: null,
      status: "available",
      provider: "local",
      model: "imported",
      prompt: "素材仓库视频",
      durationSec: 5,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/source-take.mp4",
      extractionCapability: "available",
    });
    await selectVideoTimelineSegment(
      {
        storyId: story.id,
        stableShotId: sourceStableShotId,
        takeId: take.id,
        selectionType: "full_take",
      },
      1
    );
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [
        {
          stableShotId: sourceStableShotId,
          included: true,
          position: 0,
          plannedDurationMs: 2_000,
        },
        {
          stableShotId: retainedStableShotId,
          included: true,
          position: 1,
          plannedDurationMs: 2_000,
          primaryVideoEdit: {
            takeId: take.id,
            sourceStartSec: 1,
            sourceEndSec: 3,
            effects: {
              playbackRate: 1,
              reverse: false,
              volume: 1,
              muted: false,
            },
          },
        },
      ],
    });
    expect(
      await updateStoryBodyIfRevision({
        id: story.id,
        userId: 1,
        expectedRevision: 0,
        body: {
          _revision: 1,
          shots: [{ stableShotId: retainedStableShotId, shotNo: 1 }],
        },
      })
    ).toBe(true);

    const materials = await getStoryMaterialState(story.id, 1);
    const retained = materials?.shots[0];

    expect(retained?.timelineItem?.primaryVideoEdit?.takeId).toBe(take.id);
    expect(retained?.videoTakes.map(item => item.id)).toContain(take.id);
    expect(retained?.currentVideo?.id).toBe(take.id);
    expect(materials?.unassignedVideoTakes.map(item => item.id)).not.toContain(
      take.id
    );
  });

  it("projects source image and video assets onto a structurally split child shot", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "切割素材继承",
      body: {
        shots: [
          {
            stableShotId: "shot-source",
            shotIdentity: "shot-source",
            shotNo: 1,
          },
          {
            stableShotId: "split-right",
            shotIdentity: "split-right",
            splitSourceStableShotId: "shot-source",
            shotNo: 2,
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-source",
      imageUrl: "data:image/png;base64,SPLIT",
      imageKey: null,
      prompt: "split source",
      generationType: "initial",
      isCurrent: true,
    });
    const take = await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "shot-source",
      sourceImageId: image.id,
      status: "available",
      provider: "local",
      model: "imported",
      prompt: "split source video",
      durationSec: 3,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/split-source.mp4",
      extractionCapability: "available",
    });
    await selectImage(story.id, image.id);
    expect(await getStoryById(story.id, 1)).toMatchObject({
      body: {
        shots: [{}, { splitSourceStableShotId: "shot-source" }],
      },
    });

    const materials = await getStoryMaterialState(story.id, 1);

    expect(materials?.shots[1]?.currentImage?.id).toBe(image.id);
    expect(materials?.shots[1]?.videoTakes.map(item => item.id)).toContain(
      take.id
    );
  });

  it("projects one referenced image onto two shots without changing source ownership", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "共享时间线图片",
      body: {
        shots: [
          {
            stableShotId: "shot-source",
            shotIdentity: "shot-source",
            shotNo: 1,
          },
          {
            stableShotId: "shot-target",
            shotIdentity: "shot-target",
            shotNo: 2,
          },
        ],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-source",
      imageUrl: "data:image/png;base64,SHARED",
      imageKey: null,
      prompt: "shared source",
      generationType: "initial",
      isCurrent: true,
    });
    await selectImage(story.id, image.id);
    await updateStoryTimeline({
      storyId: story.id,
      userId: 1,
      expectedVersion: 0,
      items: [
        {
          stableShotId: "shot-source",
          included: true,
          position: 0,
          plannedDurationMs: 3000,
          transform: {
            cropX: 0,
            cropY: 0,
            cropWidth: 1,
            cropHeight: 1,
            zoom: 1,
            panX: 0,
            panY: 0,
          },
        },
        {
          stableShotId: "shot-target",
          included: true,
          position: 1,
          plannedDurationMs: 3000,
          referencedImageId: image.id,
          transform: {
            cropX: 0,
            cropY: 0,
            cropWidth: 1,
            cropHeight: 1,
            zoom: 1,
            panX: 0,
            panY: 0,
          },
        },
      ],
    });

    const materials = await getStoryMaterialState(story.id, 1);
    expect(materials?.shots.map(shot => shot.currentImage?.id)).toEqual([
      image.id,
      image.id,
    ]);
    expect(materials?.shots[0]?.currentImage?.shotIdentity).toBe("shot-source");
    expect(materials?.shots[1]?.currentImage?.shotIdentity).toBe("shot-source");
  });

  it("projects extracted-frame inputs and their image lineage onto the generated shot", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "抽帧派生镜头图片谱系",
      body: {
        shots: [
          {
            stableShotId: "shot-left",
            shotIdentity: "shot-left",
            shotNo: 1,
          },
          {
            stableShotId: "transition-shot",
            shotIdentity: "transition-shot",
            shotNo: 2,
            sourceTransition: {
              firstImageId: 1,
              lastImageId: 2,
              takeId: 90,
            },
          },
          {
            stableShotId: "shot-right",
            shotIdentity: "shot-right",
            shotNo: 3,
          },
        ],
      },
    });
    const first = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-left",
      imageUrl: "data:image/png;base64,FIRST",
      imageKey: null,
      prompt: "时间线抽帧 · 1000ms",
      generationType: "initial",
      isCurrent: true,
    });
    const last = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH03",
      shotIdentity: "shot-right",
      imageUrl: "data:image/png;base64,LAST",
      imageKey: null,
      prompt: "时间线抽帧 · 4000ms",
      generationType: "initial",
      isCurrent: true,
    });
    const derived = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "shot-left",
      imageUrl: "data:image/png;base64,DERIVED",
      imageKey: null,
      prompt: "由首帧生成的变化图",
      generationType: "inpaint",
      parentImageId: first.id,
      isCurrent: false,
    });
    const saved = await getStoryById(story.id, 1);
    const body = structuredClone(saved?.body as Record<string, unknown>);
    const transition = (body.shots as Array<Record<string, unknown>>)[1];
    transition.sourceTransition = {
      firstImageId: first.id,
      lastImageId: last.id,
      takeId: 90,
    };
    body._revision = 1;
    expect(
      await updateStoryBodyIfRevision({
        id: story.id,
        userId: 1,
        expectedRevision: 0,
        body,
      })
    ).toBe(true);

    const materials = await getStoryMaterialState(story.id, 1);
    const projected = materials?.shots.find(
      shot => shot.stableShotId === "transition-shot"
    );

    expect(projected?.currentImage).toBeNull();
    expect(projected?.imageVersions).toEqual([]);
    expect(new Set(projected?.relatedImages?.map(image => image.id))).toEqual(
      new Set([first.id, last.id, derived.id])
    );
  });

  it("keeps related video inputs scoped to the exact stable shot identity", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "相同数字别名的关联图隔离",
      body: {
        shots: [
          { stableShotId: "shot-02-a", shotIdentity: "shot-02-a", shotNo: 2 },
          { stableShotId: "shot-02-b", shotIdentity: "shot-02-b", shotNo: 2 },
        ],
      },
    });
    const source = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH02",
      shotIdentity: "shot-02-a",
      imageUrl: "data:image/png;base64,SCOPED",
      imageKey: null,
      prompt: "仅属于 A 的视频输入",
      generationType: "initial",
      isCurrent: true,
    });
    const derived = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH02",
      shotIdentity: "shot-02-a",
      imageUrl: "data:image/png;base64,SCOPED-DERIVED",
      imageKey: null,
      prompt: "A 的派生图片",
      generationType: "inpaint",
      parentImageId: source.id,
      isCurrent: false,
    });
    await selectImage(story.id, source.id);
    await createVideoTake({
      storyId: story.id,
      userId: 1,
      stableShotId: "shot-02-a",
      sourceImageId: source.id,
      status: "available",
      provider: "local",
      model: "imported",
      prompt: "A 的视频",
      durationSec: 3,
      aspectRatio: "16:9",
      videoUrl: "/api/videos/shot-02-a.mp4",
      extractionCapability: "available",
    });

    const materials = await getStoryMaterialState(story.id, 1);
    const shotA = materials?.shots.find(
      shot => shot.stableShotId === "shot-02-a"
    );
    const shotB = materials?.shots.find(
      shot => shot.stableShotId === "shot-02-b"
    );

    expect(shotA?.currentImage?.id).toBe(source.id);
    expect(shotA?.imageVersions.map(image => image.id)).toEqual(
      expect.arrayContaining([source.id, derived.id])
    );
    expect(shotB?.currentImage).toBeNull();
    expect(shotB?.imageVersions).toEqual([]);
    expect(shotB?.relatedImages).toEqual([]);
  });

  it("keeps publishing covers out of shots and unassigned materials", async () => {
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "发布稿封面隔离",
      body: {
        shots: [
          {
            stableShotId: "shot-01",
            shotIdentity: "shot-01",
            shotNo: 1,
            subject: "主角",
          },
        ],
      },
    });
    const cover = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: PUBLISHING_COVER_SHOT_NO,
      shotIdentity: PUBLISHING_COVER_SHOT_IDENTITY,
      imageUrl: "data:image/png;base64,COVER",
      imageKey: null,
      prompt: "text-free publishing cover",
      generationType: "initial",
      isCurrent: true,
    });

    const materials = await getStoryMaterialState(story.id, 1);

    expect(materials?.unassignedImages.map(image => image.id)).not.toContain(
      cover.id
    );
    expect(
      materials?.shots
        .flatMap(shot => shot.imageVersions)
        .map(image => image.id)
    ).not.toContain(cover.id);
    expect(materials?.shots.map(shot => shot.currentImage?.id)).not.toContain(
      cover.id
    );
  });

  it("uses the active Storyboard version cover assetId to isolate a legacy SH01 cover", async () => {
    const basePublishing = upsertPublishingPlatformDraft(
      emptyPublishingDraftState(100),
      {
        platform: "xiaohongshu",
        content: {
          title: "标题",
          body: "正文",
          tags: [],
        },
        activate: true,
        now: 101,
      }
    );
    const publishing = {
      ...basePublishing,
      activeVideoStoryboardVersionId: basePublishing.activeVersionId,
      activeVideoStoryboardGroupId: "publishing-group-v1-preview",
      versions: basePublishing.versions?.map(version => ({
        ...version,
        cover: null,
      })),
    };
    const story = await createStory({
      userId: 1,
      projectId: null,
      title: "旧编号封面故事",
      body: {
        publishing,
        shots: [
          {
            stableShotId: "publishing-shot-1",
            shotIdentity: "publishing-shot-1",
            shotNo: 1,
            subject: "正文镜头",
          },
        ],
      },
    });
    const cover = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: 1,
      shotNo: "SH01",
      shotIdentity: "publishing-cover-opening",
      imageUrl: "data:image/png;base64,LEGACY-COVER",
      imageKey: null,
      prompt: "legacy publishing cover",
      generationType: "initial",
      isCurrent: true,
    });
    const saved = await getStoryById(story.id, 1);
    const body = structuredClone(saved?.body as Record<string, unknown>);
    const storedPublishing = body.publishing as Record<string, unknown>;
    storedPublishing.versions = (
      storedPublishing.versions as Array<Record<string, unknown>>
    ).map(version => ({
      ...version,
      cover: {
        assetId: cover.id,
        sourceCoreRevision: 1,
        createdAt: 102,
      },
    }));
    body._revision = 1;
    expect(
      await updateStoryBodyIfRevision({
        id: story.id,
        userId: 1,
        expectedRevision: 0,
        body,
      })
    ).toBe(true);

    const materials = await getStoryMaterialState(story.id, 1);

    expect(materials?.unassignedImages.map(image => image.id)).not.toContain(
      cover.id
    );
    expect(
      materials?.shots
        .flatMap(shot => shot.imageVersions)
        .map(image => image.id)
    ).not.toContain(cover.id);
  });

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

  it("keeps video takes from other stories out of the material warehouse", async () => {
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

    expect(materials?.reusableVideoTakes.map(item => item.id)).not.toContain(
      reusableTake.id
    );
    expect(materials?.reusableVideoTakes.map(item => item.id)).not.toContain(
      unusableTake.id
    );
  });

  it("keeps selected takes from other stories out of the material warehouse", async () => {
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

    expect(legacyShot?.currentVideo).toBeNull();
    expect(legacyShot?.videoTakes.map(item => item.id)).not.toContain(
      selectedTake.id
    );
    expect(manualShot?.videoTakes.map(item => item.id)).not.toContain(
      selectedTake.id
    );
    expect(materials?.reusableVideoTakes.map(item => item.id)).not.toContain(
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
      node =>
        node.stableShotId === "shot-01" && node.dimension === "image_prompt"
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
      node =>
        node.stableShotId === "shot-01" && node.dimension === "camera_motion"
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
