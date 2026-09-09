import { beforeEach, expect, it } from "vitest";
import {
  createStory,
  resetMemoryStateForTesting,
  updateStoryTimeline,
} from "../db";
import { DEFAULT_TIMELINE_TRANSFORM } from "../../shared/storyMaterial";
import type { PublishingAlbumTypographyLayout } from "../../shared/publishingAlbum";
import { patchImageTransformForStory } from "./visualClipEditing";
import {
  getStoryMaterialState,
  normalizeTimelineItems,
} from "./storyMaterials";

const typography: PublishingAlbumTypographyLayout = {
  layoutVersion: 1,
  kind: "path",
  points: [
    { x: 0.1, y: 0.8 },
    { x: 0.9, y: 0.6 },
  ],
  fontId: "noto-sans-sc",
  alignment: "center",
  fontSize: 42,
  letterSpacing: 2,
  lineSpacing: 1.3,
  contrast: {
    textColor: "#ffffff",
    outlineColor: "#000000",
    outlineWidth: 2,
    backdropColor: null,
  },
};
const overlay = { text: "他真的好烦，也确实很欠揍！", typography };
beforeEach(() => resetMemoryStateForTesting());

it("reads saved exact-image subtitles through the real material projection, including a subsequent edit and removal", async () => {
  const story = await createStory({
    userId: 1,
    projectId: null,
    title: "字幕回读",
    body: {
      shots: [
        {
          stableShotId: "shot-a",
          shotIdentity: "shot-a",
          shotNo: 1,
          subject: "小猫",
          dialogue: "台词",
        },
      ],
    },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId: 1,
    expectedVersion: 0,
    items: [
      {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        plannedDurationMs: 2000,
      },
    ],
  });
  const save = (imageId: number, textOverlay: typeof overlay | null) =>
    patchImageTransformForStory({
      storyId: story.id,
      userId: 1,
      stableShotId: "shot-a",
      imageId,
      transform: { ...DEFAULT_TIMELINE_TRANSFORM, rotationDeg: 30 },
      textOverlay,
    });
  expect((await save(42, overlay)).status).toBe("ok");
  const read = async () =>
    (await getStoryMaterialState(story.id, 1))!.timeline.items[0];
  expect((await read()).imageTextOverlays).toEqual({ "42": overlay });
  expect((await read()).imageTransforms?.["42"].rotationDeg).toBe(30);
  await save(43, { ...overlay, text: "另一张图" });
  expect((await read()).imageTextOverlays?.["42"]).toEqual(overlay);
  await save(42, null);
  expect((await read()).imageTextOverlays).toEqual({
    "43": { ...overlay, text: "另一张图" },
  });
});

it("ignores malformed image-layer entries without losing valid neighbors", () => {
  const [item] = normalizeTimelineItems(
    [
      {
        stableShotId: "shot-a",
        imageTextOverlays: {
          "42": overlay,
          "43": { text: "bad", typography: {} },
          "44": null,
          "0": overlay,
          invalid: overlay,
        },
        imageTransforms: {
          "42": { zoom: 2 },
          "0": {},
          invalid: {},
          "43": null,
        },
      },
    ],
    [
      {
        stableShotId: "shot-a",
        splitSourceStableShotId: null,
        relatedImageIds: [],
        shotNo: 1,
        cueCode: null,
        plannedDurationMs: 2000,
      },
    ]
  );
  expect(item.imageTextOverlays).toEqual({ "42": overlay });
  expect(Object.keys(item.imageTransforms!)).toEqual(["42"]);
  expect(item.imageTransforms?.["42"].zoom).toBe(2);
});
