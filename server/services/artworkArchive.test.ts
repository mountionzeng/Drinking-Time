import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { artworkShareRouter } from "../routers/artworkShare";
import { createStory } from "../repositories/stories";
import {
  memoryState,
  resetMemoryStateForTesting,
} from "../repositories/runtime";
import { getStoryMaterialState } from "./storyMaterials";
import { storeImageBytes } from "./imageGen";
vi.mock("./imageGen", () => ({
  localImageDir: "/unused",
  storeImageBytes: vi.fn(),
}));
const caller = (id: number) =>
  artworkShareRouter.createCaller({ user: { id }, req: {}, res: {} } as any);
async function picture(color: string) {
  return `data:image/png;base64,${(
    await sharp({
      create: { width: 20, height: 30, channels: 3, background: color },
    })
      .png()
      .toBuffer()
  ).toString("base64")}`;
}
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  resetMemoryStateForTesting();
  vi.mocked(storeImageBytes)
    .mockReset()
    .mockImplementation(async (_bytes, _mime, options) => ({
      status: "ok",
      imageUrl: "https://example.test/artwork.webp",
      imageKey: options?.storageKey,
    }));
});
describe("private rendered artwork archive", () => {
  it("archives changed snapshots, deduplicates concurrent/repeated saves and never adopts or shares them", async () => {
    const story = await createStory({ userId: 1, title: "作品", body: {} });
    const input = {
      storyId: story.id,
      title: "成品",
      token: randomUUID(),
      pages: [await picture("red")],
    };
    const [a, b] = await Promise.all([
      caller(1).archive(input),
      caller(1).archive(input),
    ]);
    expect(a).toEqual(b);
    expect(storeImageBytes).toHaveBeenCalledTimes(1);
    const next = await caller(1).archive({
      ...input,
      pages: [await picture("blue")],
    });
    expect(next.imageIds).not.toEqual(a.imageIds);
    expect(memoryState.generatedImages).toHaveLength(2);
    expect(memoryState.generatedImages.every(row => !row.isCurrent)).toBe(true);
    expect(memoryState.artworkShares).toHaveLength(0);
    expect(
      (await getStoryMaterialState(story.id, 1))?.warehouseImages
    ).toHaveLength(2);
  });
  it("rejects foreign stories and malformed pixels before storing anything", async () => {
    const story = await createStory({ userId: 1, title: "作品", body: {} });
    const input = {
      storyId: story.id,
      title: "成品",
      token: randomUUID(),
      pages: [await picture("red")],
    };
    await expect(caller(2).archive(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller(1).archive({
        ...input,
        pages: [...input.pages, "data:image/png;base64,AAAA"],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storeImageBytes).not.toHaveBeenCalled();
    expect(memoryState.generatedImages).toHaveLength(0);
  });
  it("recovers a partial batch without losing or duplicating the first saved page", async () => {
    const story = await createStory({ userId: 1, title: "作品", body: {} });
    const input = {
      storyId: story.id,
      title: "成品",
      token: randomUUID(),
      pages: [await picture("red"), await picture("blue")],
    };
    vi.mocked(storeImageBytes)
      .mockResolvedValueOnce({
        status: "ok",
        imageUrl: "https://example.test/one.webp",
      })
      .mockRejectedValueOnce(new Error("storage offline"));
    await expect(caller(1).archive(input)).rejects.toThrow("storage offline");
    expect(memoryState.generatedImages).toHaveLength(1);
    expect((await caller(1).archive(input)).imageIds).toHaveLength(2);
    expect(memoryState.generatedImages).toHaveLength(2);
  });
});
