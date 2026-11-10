import { expect, it } from "vitest";
import {
  parseImageRevisionDecision,
  replaceRevisionInDocument,
  replaceRevisionFrameRoles,
} from "./chatImageRevision";
it("recognizes explicit choices without treating new instructions as approvals", () => {
  expect(parseImageRevisionDecision("替换原图")).toMatchObject({
    kind: "replace",
  });
  expect(parseImageRevisionDecision("保留原图")).toMatchObject({
    kind: "keep",
  });
  expect(parseImageRevisionDecision("第01镜第2张替换原图")).toMatchObject({
    kind: "replace",
    shotNo: 1,
    ordinal: 2,
  });
  expect(parseImageRevisionDecision("图片 #2038 替换原图")).toMatchObject({
    kind: "replace",
    imageId: 2038,
  });
  for (const text of [
    "挺好的，但脸再亮一些",
    "确认",
    "不要替换原图，先改颜色",
    "再做第2镜",
    "我想先看看",
  ])
    expect(parseImageRevisionDecision(text)).toBeNull();
});
it("refuses ambiguous duplicated clips and never manufactures a new layer", () => {
  const input = {
    stableShotId: "s1",
    sourceImageId: 1,
    imageId: 2,
    imageUrl: "/2",
    sourceIsPrimary: false,
  };
  expect(() =>
    replaceRevisionInDocument(
      {
        items: [
          { stableShotId: "s1", imageClips: [{ imageId: 1 }, { imageId: 1 }] },
        ],
      } as any,
      input
    )
  ).toThrow("多个");
  expect(() =>
    replaceRevisionInDocument(
      { items: [{ stableShotId: "s1", imageClips: [] }] } as any,
      input
    )
  ).toThrow("变化");
});

it("does not treat whitespace normalization as proof that the source is still a frame", () => {
  const raw = '{ "firstFrameImageId": 99, "lastFrameImageId": 100 }';
  expect(replaceRevisionFrameRoles(raw, 1, 2)).toBe(raw);
  expect(replaceRevisionFrameRoles(undefined, 1, 2)).toBeUndefined();
});
