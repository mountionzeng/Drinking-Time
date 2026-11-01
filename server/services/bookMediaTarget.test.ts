import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  story: vi.fn(),
  chapter: vi.fn(),
  image: vi.fn(),
}));
vi.mock("../repositories/stories", () => ({ getStoryById: mocks.story }));
vi.mock("../repositories/chapters", () => ({ getChapter: mocks.chapter }));
vi.mock("../repositories/images", () => ({
  getGeneratedImageById: mocks.image,
}));
import { bookMediaTargetIsCurrent } from "./bookMediaTarget";
const input = {
  userId: 7,
  storyId: 12,
  chapterId: 3,
  moduleId: "m1",
  imageId: 9,
};
beforeEach(() => {
  mocks.story.mockResolvedValue({ id: 12, userId: 7 });
  mocks.chapter.mockResolvedValue({
    storyId: 12,
    userId: 7,
    blocks: {
      body: "标题\n![图片](/api/images/test.png)",
      writingStyle: [{ id: "t" }, { id: "m1" }],
    },
  });
  mocks.image.mockResolvedValue({
    id: 9,
    userId: 7,
    storyId: 12,
    imageUrl: "/api/images/test.png",
  });
});
describe("book image write target", () => {
  it("requires saved module identity and matching owned image", async () => {
    expect(await bookMediaTargetIsCurrent(input)).toBe(true);
    expect(mocks.chapter).toHaveBeenCalledWith(3, 7);
    expect(mocks.story).toHaveBeenCalledWith(12, 7);
  });
  it("rejects another account image", async () => {
    mocks.image.mockResolvedValue({
      userId: 8,
      storyId: 12,
      imageUrl: "/api/images/test.png",
    });
    expect(await bookMediaTargetIsCurrent(input)).toBe(false);
  });
  it("rejects another story chapter", async () => {
    mocks.chapter.mockResolvedValue({ storyId: 13 });
    expect(await bookMediaTargetIsCurrent(input)).toBe(false);
  });
  it("rejects a replaced image or removed module", async () => {
    expect(
      await bookMediaTargetIsCurrent({ ...input, moduleId: "deleted" })
    ).toBe(false);
    mocks.image.mockResolvedValue({
      userId: 7,
      storyId: 12,
      imageUrl: "/api/images/old.png",
    });
    expect(await bookMediaTargetIsCurrent(input)).toBe(false);
  });
  it("rejects trashed stories", async () => {
    mocks.story.mockResolvedValue(null);
    expect(await bookMediaTargetIsCurrent(input)).toBe(false);
  });
});
