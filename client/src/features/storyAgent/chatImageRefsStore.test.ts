import { beforeEach, describe, expect, it } from "vitest";
import { chatImageRefsStore } from "./chatImageRefsStore";
import { MAX_CHAT_IMAGE_REFS, type ChatImageRef } from "./chatImageRefs";

function ref(imageId: number): ChatImageRef {
  return {
    imageId,
    imageUrl: `https://cdn/${imageId}.png`,
    label: `镜头 ${imageId}`,
  };
}

describe("chatImageRefsStore", () => {
  beforeEach(() => {
    chatImageRefsStore.setState({ storyId: null, refs: [] });
  });

  it("toggles references in and out of the basket", () => {
    expect(chatImageRefsStore.getState().toggle(7, ref(1))).toBeNull();
    expect(chatImageRefsStore.getState().refs).toHaveLength(1);
    chatImageRefsStore.getState().toggle(7, ref(1));
    expect(chatImageRefsStore.getState().refs).toEqual([]);
  });

  it("reports why an image could not be added", () => {
    for (let index = 1; index <= MAX_CHAT_IMAGE_REFS; index += 1) {
      chatImageRefsStore.getState().toggle(7, ref(index));
    }
    expect(chatImageRefsStore.getState().toggle(7, ref(99))).toContain(
      String(MAX_CHAT_IMAGE_REFS)
    );
    expect(chatImageRefsStore.getState().refs).toHaveLength(
      MAX_CHAT_IMAGE_REFS
    );
  });

  it("drops the basket when the picked image belongs to another story", () => {
    chatImageRefsStore.getState().toggle(7, ref(1));
    chatImageRefsStore.getState().toggle(8, ref(2));
    expect(chatImageRefsStore.getState().storyId).toBe(8);
    expect(chatImageRefsStore.getState().refs.map(item => item.imageId)).toEqual(
      [2]
    );
  });

  it("clears the basket when the workspace switches story", () => {
    chatImageRefsStore.getState().toggle(7, ref(1));
    chatImageRefsStore.getState().scopeToStory(7);
    expect(chatImageRefsStore.getState().refs).toHaveLength(1);
    chatImageRefsStore.getState().scopeToStory(9);
    expect(chatImageRefsStore.getState().refs).toEqual([]);
  });

  it("promotes a reference to base image", () => {
    chatImageRefsStore.getState().toggle(7, ref(1));
    chatImageRefsStore.getState().toggle(7, ref(2));
    chatImageRefsStore.getState().promote(2);
    expect(chatImageRefsStore.getState().refs.map(item => item.imageId)).toEqual(
      [2, 1]
    );
  });
});
