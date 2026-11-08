import { expect, it } from "vitest";
import {
  matchBookVideoShots,
  inheritBookFrameParameters,
} from "./bookVideoShotContinuity";
import type { PublishingVideoStoryboardShot as Shot } from "../../shared/publishingVideoStoryboard";
const shot = (id: string, text: string, ids?: string[]): Shot => ({
  draftShotId: id,
  scriptText: text,
  sourceModuleIds: ids,
  voiceText: "",
  segmentIds: [],
  sourceParagraphIds: [],
  subject: "",
  action: "",
  imageRequirement: "",
  videoRequirement: "",
  soundRequirement: "",
});
it("inherits unique source modules after reparenting, renaming and ordering", () => {
  const before = [
    shot("old-a", "旧开场", ["1:a"]),
    shot("old-b", "旧结尾", ["1:b"]),
  ];
  const matched = matchBookVideoShots(
    [
      shot("new-b", "改过的结尾", ["1:b"]),
      shot("new-a", "改过的开场", ["1:a"]),
    ],
    before
  );
  expect([...matched.values()]).toEqual([before[1], before[0]]);
});
it("bridges legacy acts only with uniquely retained exact source text", () => {
  const before = [
    shot("book-scene-1", "我们相信再聪明的回应也不能替代你"),
    shot("book-scene-2", "你与世界之间的触角也在生长"),
  ];
  const matched = matchBookVideoShots(
    [
      shot("book-shot-9-a", "新标题\n我们相信再聪明的回应也不能替代你", [
        "9:a",
      ]),
    ],
    before
  );
  expect(matched.get("book-shot-9-a")).toBe(before[0]);
  expect(
    matchBookVideoShots([shot("book-scene-1", "完全不同的故事和情节")], before)
      .size
  ).toBe(0);
});
it("does not guess by array position, repeated captions, split or merged ownership", () => {
  expect(
    matchBookVideoShots(
      [shot("new", "完全不同的新内容")],
      [shot("old", "以前的内容")]
    ).size
  ).toBe(0);
  expect(
    matchBookVideoShots(
      [shot("new", "大家都用同一句很长的字幕")],
      [
        shot("a", "大家都用同一句很长的字幕"),
        shot("b", "大家都用同一句很长的字幕"),
      ]
    ).size
  ).toBe(0);
  expect(
    matchBookVideoShots(
      [shot("a", "", ["1"]), shot("b", "", ["1"])],
      [shot("old", "", ["1"])]
    ).size
  ).toBe(0);
  expect(
    matchBookVideoShots(
      [shot("new", "", ["1", "2"])],
      [shot("a", "", ["1"]), shot("b", "", ["2"])]
    ).size
  ).toBe(0);
});
it("keeps chosen first/last frames and manual references while adding new book images", () => {
  const baseline = {
    referenceFrameImageIds: [1, 2],
    storyboardFrameRoles: {
      firstImageId: null,
      lastImageId: null,
      referenceImageIds: [1, 2],
    },
  };
  const current = {
    referenceFrameImageIds: [2, 7],
    storyboardFrameRoles: {
      firstImageId: 8,
      lastImageId: 9,
      referenceImageIds: [2, 7],
    },
    durationSec: 8,
  };
  const next = {
    referenceFrameImageIds: [1, 3],
    storyboardFrameRoles: {
      firstImageId: null,
      lastImageId: null,
      referenceImageIds: [1, 3],
    },
  };
  expect(
    JSON.parse(
      inheritBookFrameParameters(
        JSON.stringify(current),
        JSON.stringify(baseline),
        JSON.stringify(next)
      )
    )
  ).toEqual({
    referenceFrameImageIds: [7, 3],
    storyboardFrameRoles: {
      firstImageId: 8,
      lastImageId: 9,
      referenceImageIds: [7, 3],
    },
    durationSec: 8,
  });
});
