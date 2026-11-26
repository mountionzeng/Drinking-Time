import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  story: vi.fn(), chapter: vi.fn(), material: vi.fn(), image: vi.fn(),
  read: vi.fn(), host: vi.fn(), prepare: vi.fn(), open: vi.fn(),
}));
vi.mock("../repositories/textSourceLineage", async original => ({
  ...await original<typeof import("../repositories/textSourceLineage")>(),
  ownedCreationStory: mocks.story,
}));
vi.mock("../repositories/chapters", () => ({ getChapter: mocks.chapter }));
vi.mock("./storyMaterials", () => ({ getStoryMaterialState: mocks.material }));
vi.mock("../repositories/images", () => ({ getGeneratedImageById: mocks.image }));
vi.mock("./previewArtBasis", () => ({ previewArtBasis: () => ({
  source: "Harbour", coverImageId: 9, styleName: "Ink", direction: "ink", rules: "", filmBrief: "", coverNote: "cover",
}) }));
vi.mock("./videoExport", () => ({ resolveVideoExportAspectRatio: () => "16:9" }));
vi.mock("./artPreview", () => ({ readPreviewResults: () => [] }));
vi.mock("./ownedImageBytes", () => ({ readOwnedImageBytes: mocks.read }));
vi.mock("./publicReferenceHost", () => ({ hostPublicReferenceBytes: mocks.host }));
vi.mock("./previewCoverCopy", () => ({
  preparePreviewCoverCopy: mocks.prepare, openPreviewCoverCopy: mocks.open,
}));
import { bookModuleRenderStyle, bookModuleVisualBasis } from "./bookModuleVisualBasis";

const styleUrl = "/api/images/style.png";
const publicUrl = "https://files.example.com/hosted-style.jpg";
const scope = { storyId: 1, userId: 2, chapterId: 10, moduleId: "m" };

function stub(imageUrl = styleUrl) {
  mocks.story.mockResolvedValue({
    story: { title: "Harbour" },
    body: { shots: [{ shotNo: 2, stableShotId: "scene", publishingVideo: { sourceModuleIds: ["10:m"] } }],
      artDirection: { recipe: { version: 3, system: { name: "Ink", confirmedAt: 1, filmStyleImageId: 22 } } } },
  });
  mocks.chapter.mockResolvedValue({ storyId: 1, blocks: { writingStyle: [{ id: "m" }] } });
  mocks.material.mockResolvedValue({ warehouseImages: [
    { id: 9, imageUrl: "/api/wechat-import/media/" + "b".repeat(64) + ".jpg" },
    { id: 22, imageUrl },
  ] });
  mocks.image.mockResolvedValue({ id: 22, storyId: 1, userId: 2, imageUrl });
  mocks.read.mockResolvedValue({ bytes: Buffer.from("style"), fileName: "style.png", contentType: "image/png" });
  mocks.host.mockResolvedValue(publicUrl);
  mocks.prepare.mockResolvedValue("receipt");
  mocks.open.mockResolvedValue({ source: imageUrl, url: publicUrl });
}

beforeEach(() => { vi.resetAllMocks(); stub(); });

it("asks for a hosted copy of a non-cover private style image and fails the quote when bytes are missing", async () => {
  const basis = await bookModuleVisualBasis(scope);
  expect(basis).toMatchObject({ styleImageId: 22, coverImageId: 9, needsCopy: true });
  expect(mocks.host).not.toHaveBeenCalled();
  mocks.read.mockResolvedValueOnce(null);
  await expect(bookModuleVisualBasis(scope)).rejects.toThrow("无法读取");
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.host).not.toHaveBeenCalled();
});

it("returns the prepared thumbnail as coverCopy so generation can use the public URL", async () => {
  const basis = await bookModuleVisualBasis(scope);
  await expect(bookModuleRenderStyle(scope, { requestId: "round-1", basisHash: basis!.fingerprint }))
    .rejects.toThrow("请先确认本轮发送画风参考的缩图");
  expect(mocks.prepare).not.toHaveBeenCalled();
  const styled = await bookModuleRenderStyle(scope, { requestId: "round-1", basisHash: basis!.fingerprint, copyImageId: 22 });
  expect(styled).toMatchObject({ styleRef: publicUrl, coverCopy: { source: styleUrl, url: publicUrl }, aspectRatio: "16:9" });
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ imageId: 22, roundId: "round-1", storyId: 1, userId: 2 }));
});

it("passes through an already public style URL without requiring a thumbnail", async () => {
  stub("https://cdn.example.com/style.jpg");
  const basis = await bookModuleVisualBasis(scope);
  expect(basis).toMatchObject({ styleImageId: 22, needsCopy: false });
  const styled = await bookModuleRenderStyle(scope, { requestId: "round-2", basisHash: basis!.fingerprint });
  expect(styled).toMatchObject({ styleRef: "https://cdn.example.com/style.jpg", coverCopy: undefined });
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.host).not.toHaveBeenCalled();
});
