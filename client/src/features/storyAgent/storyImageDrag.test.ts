import { describe, expect, it } from "vitest";
import {
  hasStoryImageDragPayload,
  readStoryImageDragPayload,
  STORY_IMAGE_DRAG_MIME,
  writeStoryImageDragPayload,
} from "./storyImageDrag";

function fakeDataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: "" as string,
    get types() {
      return Array.from(store.keys());
    },
    setData(type: string, value: string) {
      store.set(type, value);
    },
    getData(type: string) {
      return store.get(type) ?? "";
    },
  };
}

describe("storyImageDrag", () => {
  it("round-trips an image through the drag payload", () => {
    const transfer = fakeDataTransfer();
    writeStoryImageDragPayload(transfer as unknown as DataTransfer, {
      imageId: 1554,
      imageUrl: "https://cdn/1554.png",
      label: "待归类",
    });
    expect(hasStoryImageDragPayload(transfer)).toBe(true);
    expect(transfer.getData("text/plain")).toBe("图片 #1554");
    expect(readStoryImageDragPayload(transfer)).toEqual({
      imageId: 1554,
      imageUrl: "https://cdn/1554.png",
      label: "待归类",
    });
  });

  it("ignores drags that carry no image payload", () => {
    const transfer = fakeDataTransfer();
    transfer.setData("text/plain", "just text");
    expect(hasStoryImageDragPayload(transfer)).toBe(false);
    expect(readStoryImageDragPayload(transfer)).toBeNull();
  });

  it("refuses malformed payloads instead of dropping a broken image into a shot", () => {
    const transfer = fakeDataTransfer();
    transfer.setData(STORY_IMAGE_DRAG_MIME, "{not json");
    expect(readStoryImageDragPayload(transfer)).toBeNull();

    transfer.setData(
      STORY_IMAGE_DRAG_MIME,
      JSON.stringify({ imageId: 0, imageUrl: "https://cdn/x.png" })
    );
    expect(readStoryImageDragPayload(transfer)).toBeNull();

    transfer.setData(
      STORY_IMAGE_DRAG_MIME,
      JSON.stringify({ imageId: 12, imageUrl: "   " })
    );
    expect(readStoryImageDragPayload(transfer)).toBeNull();
  });

  it("falls back to a readable label when the source did not send one", () => {
    const transfer = fakeDataTransfer();
    transfer.setData(
      STORY_IMAGE_DRAG_MIME,
      JSON.stringify({ imageId: 12, imageUrl: "https://cdn/12.png" })
    );
    expect(readStoryImageDragPayload(transfer)?.label).toBe("图片 #12");
  });
});
