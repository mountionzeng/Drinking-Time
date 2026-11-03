import { afterEach, expect, it, vi } from "vitest";
import {
  bookImageSources,
  importBookImages,
  prepareBookImage,
} from "./bookImageImport";
vi.mock("@/lib/imageUpload", () => ({
  blobToBase64: async (file: File) => file.name,
}));
afterEach(() => vi.unstubAllGlobals());
const file = (name: string, type = "image/png") =>
  new File(["image"], name, { type });

it("takes clipboard files once even when items and HTML repeat the same image", () => {
  const image = file("a.png");
  const getData = vi.fn();
  expect(
    bookImageSources({
      files: [image],
      items: [{ kind: "file", getAsFile: () => image }],
      getData,
    } as any)
  ).toEqual([image]);
  expect(getData).not.toHaveBeenCalled();
  expect(
    bookImageSources({
      files: [],
      items: [{ kind: "file", getAsFile: () => image }],
      getData,
    } as any)
  ).toEqual([image]);
  expect(
    bookImageSources({ files: [], items: [], getData: () => "" } as any)
  ).toEqual([]);
});
it("keeps order and successful uploads when one image fails, without retrying", async () => {
  const upload = vi.fn(async ({ fileName }: { fileName: string }) => {
    if (fileName === "bad.png") throw new Error("网络中断，请核对仓库");
    return `/api/images/${fileName}`;
  });
  const result = await importBookImages(
    [file("a.png"), file("bad.png"), file("b.png")],
    upload,
    () => true,
    vi.fn()
  );
  expect(result.urls).toEqual(["/api/images/a.png", "/api/images/b.png"]);
  expect(result.errors).toEqual(["2: 网络中断，请核对仓库"]);
  expect(upload).toHaveBeenCalledTimes(3);
});
it("stops uploading remaining files when the editor switches stories", async () => {
  let current = true;
  const upload = vi.fn(async () => {
    current = false;
    return "/api/images/one.png";
  });
  const result = await importBookImages(
    [file("a.png"), file("b.png")],
    upload,
    () => current,
    vi.fn()
  );
  expect(result.urls).toHaveLength(1);
  expect(upload).toHaveBeenCalledTimes(1);
});
it("rejects unsupported files and oversized batches before uploading", async () => {
  const upload = vi.fn();
  const result = await importBookImages(
    [file("script.svg", "image/svg+xml")],
    upload,
    () => true,
    vi.fn()
  );
  expect(result.errors[0]).toContain("PNG");
  expect(upload).not.toHaveBeenCalled();
  await expect(
    importBookImages(
      Array.from({ length: 21 }, () => file("a.png")),
      upload,
      () => true,
      vi.fn()
    )
  ).rejects.toThrow("20张");
  await expect(
    prepareBookImage({ url: "file:///private/photo.png" })
  ).rejects.toThrow("保存到本地");
});
it("reports blocked website images without changing normal text paste", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("CORS")));
  await expect(
    prepareBookImage({ url: "https://example.com/image.png" })
  ).rejects.toThrow("来源不允许");
});
