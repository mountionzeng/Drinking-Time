import { expect, it, vi } from "vitest";
import {
  generateTwoImageCandidates,
  orderTwoImageReferences,
  rejectsBothImageCandidates,
  selectedImageFrameRole,
  twoImageInstruction,
  twoImageReply,
} from "./twoImageChat";
import { isVideoImageEditRequest } from "./chatMediaAttachments";
import { buildChatImageRemixRequest } from "./chatImageRefs";

it("routes the user’s natural request to image generation rather than feature extraction", () => {
  expect(
    isVideoImageEditRequest(
      "我希望这张图它再改一下，第一张是一个比较暗的环境，然后整个世界都亮起来了"
    )
  ).toBe(true);
  expect(isVideoImageEditRequest("不要生成图片，只分析这张图")).toBe(false);
  expect(isVideoImageEditRequest("只保存图片")).toBe(false);
});
it("recognizes a direct frame assignment without mistaking questions for actions", () => {
  expect(selectedImageFrameRole("把这张图设为参考帧")).toBe("reference");
  expect(selectedImageFrameRole("这张图作为尾帧")).toBe("last");
  expect(selectedImageFrameRole("这张图适合作为首帧吗？")).toBeNull();
});
it("uses the confirmed scene as the base, unless the user explicitly chooses another", () => {
  const refs = [
    { imageId: 1, imageUrl: "/teapot.png", label: "上传图片" },
    { imageId: 2, imageUrl: "/scene.png", label: "当前镜头已选画面（美术参考）" },
  ];
  const ordered = orderTwoImageReferences(refs, "背景变亮");
  expect(ordered.refs.map(ref => ref.imageId)).toEqual([2, 1]);
  expect(ordered.lockedBase).toBe(true);
  expect(buildChatImageRemixRequest({ refs: ordered.refs, instruction: "背景变亮" })).toMatchObject({ referenceImageUrl: "/scene.png", referenceContextImageUrls: ["/teapot.png"] });
  expect(twoImageInstruction("背景变亮", 0, ordered.lockedBase)).toContain("相对位置、比例与构图");
  expect(orderTwoImageReferences(refs, "用第一张作为底图").refs.map(ref => ref.imageId)).toEqual([1, 2]);
  expect(orderTwoImageReferences(refs, "图2作为底图").refs.map(ref => ref.imageId)).toEqual([1, 2]);
  expect(orderTwoImageReferences(refs.slice(0, 1), "背景变亮").lockedBase).toBe(false);
});
it("only explicit text confirms payment or adopts candidates", () => {
  expect(twoImageReply("确认", "confirming")).toEqual({ kind: "confirm" });
  expect(twoImageReply("取消", "confirming")).toEqual({ kind: "cancel" });
  expect(twoImageReply("这个想法可以更温暖", "confirming")).toBeNull();
  expect(twoImageReply("加入第1张", "done")).toEqual({
    kind: "adopt",
    indices: [0],
  });
  expect(twoImageReply("第2张", "done")).toEqual({ kind: "adopt", indices: [1] });
  expect(twoImageReply("add image 2", "done")).toEqual({
    kind: "adopt",
    indices: [1],
  });
  expect(twoImageReply("两张都加入", "done")).toEqual({
    kind: "adopt",
    indices: [0, 1],
  });
  expect(twoImageReply("第1张再改暖一些", "done")).toBeNull();
  expect(twoImageReply("都不要", "done")).toEqual({ kind: "cancel" });
  expect(twoImageReply("不要改变茶壶", "done")).toBeNull();
  expect(rejectsBothImageCandidates("都不要，你这个茶壶的位置放偏了")).toBe(true);
  expect(rejectsBothImageCandidates("都不要改变颜色")).toBe(false);
});
it("keeps the original intent in each independent result and never retries a failure", async () => {
  const request = "黑暗，然后整个世界亮起来";
  expect(twoImageInstruction(request, 0)).toContain(request);
  expect(twoImageInstruction(request, 1)).toContain(request);
  const run = vi.fn(async (index: number) => {
    if (index === 1) throw Error("unknown");
    return { index, imageId: 10 };
  });
  expect(await generateTwoImageCandidates(run)).toEqual({
    candidates: [{ index: 0, imageId: 10 }],
    failures: 1,
  });
  expect(run.mock.calls).toEqual([[0], [1]]);
});
