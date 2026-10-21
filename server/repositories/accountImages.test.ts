import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedImage, Story } from "../../drizzle/schema";
import { listAccountImages, latestStoryImageUrls } from "./accountImages";

const state = vi.hoisted(() => ({
  stories: [] as Story[],
  generatedImages: [] as GeneratedImage[],
}));
vi.mock("./runtime", () => ({
  getDb: async () => null,
  ensureMemoryLoaded: vi.fn(),
  memoryState: state,
}));
const picture = (id: number, storyId: number | null, userId: number | null) =>
  ({
    id,
    storyId,
    userId,
    imageUrl: `/image-${id}.png`,
    createdAt: new Date(0),
    isCurrent: false,
    prompt: "private prompt",
    promptCompilationId: 999,
  }) as GeneratedImage;

beforeEach(() => {
  state.stories = [
    { id: 1, userId: 7, title: "故事一" },
    { id: 2, userId: 8, title: "别人的故事" },
    { id: 3, userId: 7, title: "故事三" },
  ] as Story[];
  state.generatedImages = [];
});
describe("account image library", () => {
  it("requires both story and image ownership, allows owned legacy and unassigned images", async () => {
    state.generatedImages = [
      picture(1, 1, 7),
      picture(2, 1, null),
      picture(3, 2, 7),
      picture(4, 1, 8),
      picture(5, 2, null),
      picture(6, 999, 7),
      picture(7, null, null),
      picture(8, null, 7),
      picture(9, 3, 7),
    ];
    const page = await listAccountImages(7);
    expect(page.items.map(image => image.id)).toEqual([9, 8, 2, 1]);
    expect(Object.keys(page.items[0]).sort()).toEqual([
      "createdAt",
      "id",
      "imageUrl",
      "storyId",
      "storyTitle",
    ]);
    expect(page.nextCursor).toBeNull();
    expect((await listAccountImages(99)).items).toEqual([]);
  });
  it("paginates all stories and historical candidates without duplicates even after new images arrive", async () => {
    state.stories = Array.from(
      { length: 60 },
      (_, index) =>
        ({ id: index + 1, userId: 7, title: `故事${index + 1}` }) as Story
    );
    state.generatedImages = state.stories.map(story =>
      picture(story.id, story.id, 7)
    );
    const first = await listAccountImages(7);
    expect(first.items).toHaveLength(24);
    state.generatedImages.push(picture(61, 1, 7));
    const second = await listAccountImages(7, first.nextCursor!);
    const third = await listAccountImages(7, second.nextCursor!);
    expect(
      [...first.items, ...second.items, ...third.items].map(image => image.id)
    ).toEqual(Array.from({ length: 60 }, (_, index) => 60 - index));
    expect(third.nextCursor).toBeNull();
  });
});

it("书架取每篇故事最新图片，并排除其他账号、孤立图片和无故事图片", async () => {
  state.generatedImages = [picture(1, 1, 7), picture(2, 1, null), picture(3, 1, 8), picture(4, 2, 7), picture(5, null, 7), picture(6, 3, 7)];
  expect([...await latestStoryImageUrls(7)]).toEqual([[3, "/image-6.png"], [1, "/image-2.png"]]);
  expect([...await latestStoryImageUrls(99)]).toEqual([]);
});
