import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ image: vi.fn(), read: vi.fn(), host: vi.fn() }));
vi.mock("../repositories/images", () => ({ getGeneratedImageById: mocks.image }));
vi.mock("./ownedImageBytes", () => ({ readOwnedImageBytes: mocks.read }));
vi.mock("./publicReferenceHost", () => ({ hostPublicReferenceBytes: mocks.host }));
import {
  FILM_STYLE_HOST_FAILED, FILM_STYLE_UNREADABLE, inspectFilmStyleImage,
  resolveFilmStyleReference, styleCopyTarget,
} from "./filmStyleReference";

const privateUrl = "/api/wechat-import/media/" + "a".repeat(64) + ".jpg";
const publicUrl = "https://files.example.com/style.jpg";
const input = () => ({
  storyId: 1, userId: 2, hasExplicitStyle: false,
  references: { imageIds: [], assets: {}, filmStyleVersion: 4 },
  body: { artDirection: { recipe: { version: 4, system: { name: "Ink", confirmedAt: 1, filmStyleImageId: 7 } } } },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.image.mockResolvedValue({ storyId: 1, userId: 2, imageUrl: privateUrl });
  mocks.read.mockResolvedValue({ bytes: Buffer.from("owned"), fileName: "owned.jpg", contentType: "image/jpeg" });
  mocks.host.mockResolvedValue(publicUrl);
});

it("requires matching consent for private references and never hosts the original", async () => {
  const prepareCopy = vi.fn().mockResolvedValue({ source: privateUrl, url: publicUrl });
  for (const id of [undefined, 8]) {
    await expect(resolveFilmStyleReference({ ...input(), prepareCopy,
      references: { ...input().references, filmStyleCopyImageId: id } })).rejects.toThrow("确认本轮发送");
  }
  expect(prepareCopy).not.toHaveBeenCalled();
  expect(await resolveFilmStyleReference({ ...input(), prepareCopy,
    references: { ...input().references, filmStyleCopyImageId: 7 } })).toBe(publicUrl);
  expect(prepareCopy).toHaveBeenCalledOnce();
  expect(mocks.host).not.toHaveBeenCalled();
});

it("returns an already public HTTPS style URL without re-hosting", async () => {
  mocks.image.mockResolvedValueOnce({ storyId: 1, userId: 2, imageUrl: "https://cdn.example.com/style.png" });
  expect(await resolveFilmStyleReference(input())).toBe("https://cdn.example.com/style.png");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.host).not.toHaveBeenCalled();
});

it("uses a prepared coverCopy URL and never returns a private path or data URI", async () => {
  expect(await resolveFilmStyleReference({ ...input(), coverCopy: { source: privateUrl, url: publicUrl } })).toBe(publicUrl);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.host).not.toHaveBeenCalled();
});

it("fails at resolve time when bytes are missing and does not host or submit", async () => {
  mocks.read.mockResolvedValueOnce(null);
  await expect(resolveFilmStyleReference(input())).rejects.toThrow(FILM_STYLE_UNREADABLE);
  expect(mocks.host).not.toHaveBeenCalled();
});

it("fails when hosting does not yield a provider-readable URL", async () => {
  await expect(resolveFilmStyleReference({ ...input(), coverCopy: { source: "/other.png", url: publicUrl } }))
    .rejects.toThrow("确认本轮发送");
  await expect(resolveFilmStyleReference({ ...input(), coverCopy: { source: privateUrl, url: "data:image/png;base64,abc" } }))
    .rejects.toThrow(FILM_STYLE_HOST_FAILED);
});

it("rejects stale quotes, missing and foreign images before submitting any render", async () => {
  await expect(resolveFilmStyleReference({ ...input(), references: { imageIds: [], assets: {} } })).rejects.toThrow("已更新");
  expect(mocks.image).not.toHaveBeenCalled();
  for (const image of [null, { storyId: 9, userId: 2, imageUrl: "/x" }, { storyId: 1, userId: 3, imageUrl: "/x" }]) {
    mocks.image.mockResolvedValueOnce(image);
    await expect(resolveFilmStyleReference(input())).rejects.toThrow("已失效");
  }
  expect(mocks.read).not.toHaveBeenCalled();
});

it("does not resurrect disabled film style and respects an explicit shot style", async () => {
  expect(await resolveFilmStyleReference({ ...input(), hasExplicitStyle: true })).toBeUndefined();
  expect(await resolveFilmStyleReference({ ...input(), body: {}, references: { imageIds: [], assets: {}, filmStyleVersion: 0 } })).toBeUndefined();
  await expect(resolveFilmStyleReference({ ...input(), body: {} })).rejects.toThrow("已更新");
  expect(mocks.image).not.toHaveBeenCalled();
});

it("flags a non-cover private style image for a consented copy and probes readability without hosting", async () => {
  expect(styleCopyTarget({
    filmStyleImageId: 22, coverImageId: 9, defaultReferenceId: 9,
    images: [{ id: 9, imageUrl: privateUrl }, { id: 22, imageUrl: "/api/images/style.png" }],
  })).toEqual({ imageId: 22, imageUrl: "/api/images/style.png", needsCopy: true });
  expect(styleCopyTarget({
    coverImageId: 9, defaultReferenceId: 9,
    images: [{ id: 9, imageUrl: "https://cdn.example.com/cover.jpg" }],
  })).toEqual({ imageId: 9, imageUrl: "https://cdn.example.com/cover.jpg", needsCopy: false });
  const probe = await inspectFilmStyleImage({ storyId: 1, userId: 2, imageId: 7, imageUrl: privateUrl });
  expect(probe).toEqual({ needsCopy: true, readable: true });
  expect(mocks.host).not.toHaveBeenCalled();
  mocks.read.mockResolvedValueOnce(null);
  expect(await inspectFilmStyleImage({ storyId: 1, userId: 2, imageId: 7, imageUrl: privateUrl }))
    .toMatchObject({ readable: false, error: FILM_STYLE_UNREADABLE });
  expect(mocks.host).not.toHaveBeenCalled();
});
