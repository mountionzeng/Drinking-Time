import { afterEach, describe, expect, it, vi } from "vitest";
import { deliveryImportAttempt, forgetDeliveryImportAttempt, readDeliveryImages } from "./chapterDeliveryImport";

afterEach(() => vi.unstubAllGlobals());
describe("chapter delivery import", () => {
  it("keeps a retry tied to the same delivery and destination", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const first = deliveryImportAttempt("one", "keep", null);
    expect(deliveryImportAttempt("one", "keep", null)).toEqual(first);
    expect(deliveryImportAttempt("two", "keep", null).requestId).not.toBe(first.requestId);
    expect(deliveryImportAttempt("one", "append", 42).requestId).not.toBe(first.requestId);
    forgetDeliveryImportAttempt("one");
    expect(deliveryImportAttempt("one", "keep", null).requestId).not.toBe(first.requestId);
  });
  it("preserves image bytes and refuses off-site capability URLs", async () => {
    vi.stubGlobal("window", { location: { origin: "https://example.com" } });
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 255, 128])));
    vi.stubGlobal("fetch", fetch);
    expect(await readDeliveryImages({ image: "/api/chapter-delivery/media/download/token" })).toEqual([{ assetId: "image", base64: "AP+A" }]);
    expect(fetch).toHaveBeenCalledWith(expect.any(URL), { credentials: "same-origin", redirect: "error" });
    await expect(readDeliveryImages({ image: "https://untrusted.example/image" })).rejects.toThrow("图片读取地址无效");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
