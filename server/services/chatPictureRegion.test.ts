import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { cropPictureRegion, inspectChatPictureRegion } from "./chatPictureRegion";
import { getStoryById } from "../repositories/stories";
import { loadAuthorizedStoryImage } from "../persistence/storyVisualPersistence";
import { imageBytesForAsset } from "./editingTransitionWorkflow";

vi.mock("../repositories/stories", () => ({ getStoryById: vi.fn() }));
vi.mock("../persistence/storyVisualPersistence", () => ({ loadAuthorizedStoryImage: vi.fn() }));
vi.mock("./editingTransitionWorkflow", () => ({ imageBytesForAsset: vi.fn() }));
const right = { left: 0.5, top: 0, right: 1, bottom: 1 };

describe("local chat picture region", () => {
  it("crops exactly the selected half of the original", async () => {
    const source = await sharp({ create: { width: 20, height: 12, channels: 3, background: "red" } })
      .composite([{ input: { create: { width: 10, height: 12, channels: 3, background: "blue" } }, left: 10, top: 0 }]).png().toBuffer();
    const { data, info } = await sharp(await cropPictureRegion(source, right)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([10, 12]);
    for (let i = 0; i < data.length; i += 3) expect(Array.from(data.subarray(i,i+3))).toEqual([0,0,255]);
  });
  it("maps the displayed coordinates after EXIF rotation", async () => {
    const source = await sharp({ create: { width: 20, height: 12, channels: 3, background: "red" } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const crop = await sharp(await cropPictureRegion(source, right)).metadata();
    expect([crop.width, crop.height]).toEqual([6, 20]);
  });
  it("refuses the region before reading bytes if the story or image is not authorized", async () => {
    vi.mocked(getStoryById).mockResolvedValue(null as never);
    vi.mocked(loadAuthorizedStoryImage).mockResolvedValue(null);
    await expect(inspectChatPictureRegion({ userId: 2, storyId: 10, imageId: 20, region: right })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(imageBytesForAsset).not.toHaveBeenCalled();
  });
});
