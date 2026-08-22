import { describe, expect, it } from "vitest";
import {
  addChatImageRef,
  buildChatImageRemixManifest,
  buildChatImageRemixRequest,
  chatImageRefRole,
  MAX_CHAT_IMAGE_REFS,
  promoteChatImageRefToBase,
  removeChatImageRef,
  toggleChatImageRef,
  type ChatImageRef,
} from "./chatImageRefs";

function ref(imageId: number, label = `镜头 ${imageId}`): ChatImageRef {
  return { imageId, imageUrl: `https://cdn/${imageId}.png`, label };
}

describe("chatImageRefs", () => {
  it("treats the same imageId from any panel as one reference", () => {
    // 仓库缩略图和时间轴 clip 是 generated_images 的同一行，重复加不该变成两张。
    const fromWarehouse = { ...ref(1554), label: "待归类" };
    const fromTimeline = { ...ref(1554), label: "0102 首帧" };
    const first = addChatImageRef([], fromWarehouse);
    const second = addChatImageRef(first.refs, fromTimeline);
    expect(second.refs).toHaveLength(1);
    expect(second.rejected).toBeUndefined();
  });

  it("stops at the four images the edit endpoint can actually receive", () => {
    let refs: ChatImageRef[] = [];
    for (let index = 1; index <= MAX_CHAT_IMAGE_REFS; index += 1) {
      refs = addChatImageRef(refs, ref(index)).refs;
    }
    const overflow = addChatImageRef(refs, ref(99));
    expect(overflow.refs).toHaveLength(MAX_CHAT_IMAGE_REFS);
    expect(overflow.rejected).toContain(String(MAX_CHAT_IMAGE_REFS));
  });

  it("rejects images that have no usable id or url", () => {
    expect(addChatImageRef([], { ...ref(1), imageId: 0 }).rejected).toBeTruthy();
    expect(addChatImageRef([], { ...ref(1), imageUrl: "  " }).rejected).toBeTruthy();
  });

  it("toggles a reference off when it is already in the basket", () => {
    const added = toggleChatImageRef([], ref(7)).refs;
    expect(toggleChatImageRef(added, ref(7)).refs).toEqual([]);
    expect(removeChatImageRef(added, 7)).toEqual([]);
  });

  it("promotes any reference to base without dropping the others", () => {
    const refs = [ref(1), ref(2), ref(3)];
    const promoted = promoteChatImageRefToBase(refs, 3);
    expect(promoted.map(item => item.imageId)).toEqual([3, 1, 2]);
    expect(promoteChatImageRefToBase(refs, 404).map(item => item.imageId)).toEqual(
      [1, 2, 3]
    );
  });

  it("numbers references so the manifest matches the send order", () => {
    expect(chatImageRefRole(0)).toContain("图1");
    expect(chatImageRefRole(2)).toBe("图3");
  });

  it("declares each reference by number and source, and leaves the roles to the user", () => {
    const manifest = buildChatImageRemixManifest({
      refs: [ref(11, "0102 首帧"), ref(22, "待归类")],
      instruction: "用第一张的光线，第二张那件外套",
    });
    expect(manifest).toContain("图1（底图）＝0102 首帧（图片 #11）");
    expect(manifest).toContain("图2＝待归类（图片 #22）");
    expect(manifest).toContain("用第一张的光线，第二张那件外套");
    // 故事版那套写死的连镜角色不该跟过来，否则用户点名的构图改动会被挡掉。
    expect(manifest).not.toContain("只借它的颜料质感");
    expect(manifest).toContain("不要拼贴");
  });

  it("splits the basket into one base image plus the context slots", () => {
    const request = buildChatImageRemixRequest({
      refs: [ref(1), ref(2), ref(3), ref(4)],
      instruction: "换成黄昏",
    });
    expect("error" in request).toBe(false);
    if ("error" in request) return;
    expect(request.referenceImageUrl).toBe("https://cdn/1.png");
    expect(request.referenceContextImageUrls).toEqual([
      "https://cdn/2.png",
      "https://cdn/3.png",
      "https://cdn/4.png",
    ]);
    expect(request.explicitInstruction).toBe("换成黄昏");
  });

  it("refuses to build a request without images or without an instruction", () => {
    expect(
      buildChatImageRemixRequest({ refs: [], instruction: "换成黄昏" })
    ).toHaveProperty("error");
    expect(
      buildChatImageRemixRequest({ refs: [ref(1)], instruction: "   " })
    ).toHaveProperty("error");
  });
});
