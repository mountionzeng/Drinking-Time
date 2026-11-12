import { describe, expect, it } from "vitest";
import {
  buildWarehouseShotGroups,
  WHOLE_STORY_MEDIA,
  UNASSIGNED_MEDIA,
} from "./warehouseShotMedia";
import type { CreationEditorShot } from "./types";
import type { StoryMaterialState } from "@shared/storyMaterial";
import type { ImageAsset } from "@shared/imageAsset";
import type { VideoTakeAsset } from "@shared/videoAsset";
import type { ChatImageRevision } from "@shared/chatImageRevision";
const shots = [
  {
    stableShotId: "a",
    shotNo: 1,
    subject: "Tea",
    generationParams: JSON.stringify({
      storyboardFrameRoles: { firstImageId: 1, lastImageId: 2 },
    }),
  },
  { stableShotId: "b", shotNo: 2 },
] as CreationEditorShot[];
const image = (id: number, shotIdentity: string | null, extra = {}) =>
  ({
    id,
    storyId: 7,
    shotIdentity,
    imageUrl: `/image/${id}`,
    createdAt: `2026-11-10T00:00:0${id}Z`,
    ...extra,
  }) as ImageAsset;
const state = {
  storyId: 7,
  shots: [],
  warehouseImages: [
    image(1, "a"),
    image(2, null, { parentImageId: 1 }),
    image(3, "b", { parentImageId: 1 }),
    image(4, null),
    image(5, "a", { storyId: 99 }),
  ],
  unassignedVideoTakes: [
    {
      id: 10,
      storyId: 7,
      stableShotId: "a",
      createdAt: "2026-11-10T00:00:01.500Z",
      status: "available",
      videoUrl: "/take/10",
      durationSec: 8,
    },
  ],
  reusableVideoTakes: [],
} as unknown as StoryMaterialState;
describe("shot archive projection", () => {
  it("mixes every generation in time order without adopting or changing the original assets", () => {
    const before = JSON.stringify(state);
    const groups = buildWarehouseShotGroups({
      storyId: 7,
      shots,
      materialState: state,
      audio: [
        {
          id: 8,
          stableShotId: "a",
          mediaKind: "sfx",
          displayName: "cup.wav",
          createdAt: "2026-11-10T00:00:01.750Z",
          durationFrames: 60,
          audioUrl: "/audio/8",
        },
      ],
    });
    expect(groups[0].items.map(i => i.key)).toEqual([
      "image:1",
      "video:10",
      "audio:8",
      "image:2",
    ]);
    expect(groups[0].items.map(i => i.role)).toEqual([
      "首帧",
      "视频",
      "音效",
      "尾帧",
    ]);
    expect(
      groups[0].items.filter(i => i.kind === "image").map(i => i.version)
    ).toEqual(["V01", "V02"]);
    expect(groups[0].items.find(i => i.id === 10)?.durationSec).toBe(8);
    expect(groups[1].items.map(i => i.id)).toEqual([3]);
    expect(
      groups.find(g => g.id === UNASSIGNED_MEDIA)?.items.map(i => i.id)
    ).toEqual([4]);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("retains unadopted conversation candidates and whole-film audio without guessing shot numbers", () => {
    const revisions = [
      {
        stableShotId: "a",
        createdAt: 1,
        candidates: [
          { imageId: 4, imageUrl: "/image/4" },
          { imageId: 6, imageUrl: "/image/6" },
        ],
      },
    ] as ChatImageRevision[];
    const audio = [
      {
        id: 20,
        mediaKind: "music",
        displayName: "SH01-title.mp3",
        durationFrames: 1800,
        audioUrl: "/audio/20",
        createdAt: new Date(),
      },
    ];
    const groups = buildWarehouseShotGroups({
      storyId: 7,
      shots,
      materialState: state,
      revisions,
      audio,
    });
    expect(
      groups[0].items
        .filter(i => i.kind === "image")
        .map(i => i.id)
        .sort()
    ).toEqual([1, 2, 4, 6]);
    expect(
      groups.find(g => g.id === WHOLE_STORY_MEDIA)?.items[0].durationSec
    ).toBe(60);
    expect(groups[0].items.some(i => i.id === 20)).toBe(false);
  });
  it("keeps versions after selection changes, deduplicates takes, and separates foreign stories", () => {
    const take = state.unassignedVideoTakes[0];
    const shared = {
      ...state,
      reusableVideoTakes: [
        take,
        { ...take, id: 11, storyId: 99 } as VideoTakeAsset,
      ],
    };
    const a = buildWarehouseShotGroups({
      storyId: 7,
      shots,
      materialState: shared,
    });
    const b = buildWarehouseShotGroups({
      storyId: 7,
      shots: [...shots].reverse(),
      materialState: {
        ...shared,
        warehouseImages: shared.warehouseImages?.map(i => ({
          ...i,
          isCurrent: i.id === 2,
        })),
      },
    });
    expect(a[0].items).toEqual(b.find(g => g.id === "a")?.items);
    expect(a[0].items.filter(i => i.kind === "video")).toHaveLength(1);
    expect(
      buildWarehouseShotGroups({
        storyId: 88,
        shots,
        materialState: shared,
      }).every(g => g.items.length === 0)
    ).toBe(true);
  });
  it("includes explicit book/frame/clip references without guessing legacy shot numbers or reviving missing media", () => {
    const material = {
      ...state,
      warehouseImages: [
        image(1, null),
        image(2, null),
        image(3, null),
        image(4, null, { availability: "missing", rawShotNo: "SH01" }),
      ],
    };
    const shot = {
      ...shots[0],
      publishingVideo: { referenceImageIds: [1] },
      generationParams: JSON.stringify({
        storyboardFrameRoles: { lastImageId: 2 },
      }),
      timelineItem: { imageClips: [{ imageId: 3 }] },
    } as CreationEditorShot;
    const groups = buildWarehouseShotGroups({
      storyId: 7,
      shots: [shot],
      materialState: material,
    });
    expect(
      groups[0].items.filter(i => i.kind === "image").map(i => i.id)
    ).toEqual([1, 2, 3]);
    expect(groups.find(g => g.id === UNASSIGNED_MEDIA)?.items).toMatchObject([
      { id: 4, ready: false },
    ]);
  });
});
