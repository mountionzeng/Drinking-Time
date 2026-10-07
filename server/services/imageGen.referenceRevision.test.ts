import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { editImage, resetCircuitBreaker } from "./imageGen";

vi.mock("../storage", () => ({ storagePut: vi.fn(async (key: string) => ({ key, url: "/test.png" })) }));
const original = { ...ENV };
const source = "data:image/png;base64,b3JpZ2luYWwtcGl4ZWxz";
const response = (json: unknown, status = 200) => ({ ok: status === 200, status, json: async () => json, arrayBuffer: async () => new ArrayBuffer(8) });

describe("selected-image provider routing", () => {
  beforeEach(() => {
    resetCircuitBreaker();
    ENV.api302Key = "test-key";
    ENV.api302BaseUrl = "https://api.302.ai";
  });
  afterEach(() => Object.assign(ENV, original));

  it("honors GPT Image selection with one original-image edit and the quoted profile", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ data: [{ b64_json: "b3V0cHV0" }] }));
    const result = await editImage(source, "把伞改红", { provider: "gpt-image", referenceRevision: true, referenceImageUrl: source, fetcher });
    expect(result.status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toContain("/v1/images/edits");
    const form = request.body as FormData;
    expect(form.get("model")).toBe("gpt-image-1.5");
    expect(form.get("quality")).toBe("high");
    expect(form.get("n")).toBe("1");
    expect(form.get("prompt")).toBe("把伞改红");
    expect(await (form.get("image") as Blob).text()).toBe("original-pixels");
    expect(form.get("mask")).toBeNull();
  });

  it("does not change providers when GPT rejects an edit", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({}, 503));
    expect((await editImage(source, "改图", { provider: "gpt-image", referenceRevision: true, fetcher })).status).toBe("error");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends the exact selected image and revision prompt to MJ, retaining all returned candidates", async () => {
    ENV.image302MjAuthHeader = "mj-api-secret";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ code: 1, result: "edit-task" }))
      .mockResolvedValueOnce(response({ status: "SUCCESS", action: "IMAGINE", imageUrls: [1, 2, 3, 4].map(n => ({ url: `https://file.302.ai/${n}.jpg` })) }))
      .mockResolvedValue(response({}));
    const onAccepted = vi.fn();
    const result = await editImage(source, "只让小猫看向镜头", { provider: "midjourney", referenceRevision: true, primaryReferenceLock: true, fetcher, mjPollIntervalMs: 1, onMidjourneyTaskAccepted: onAccepted });
    expect(result.status).toBe("ok");
    expect(result.candidates).toHaveLength(4);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.302.ai/mj/submit/imagine");
    expect(JSON.parse(request.body)).toMatchObject({ base64Array: [source], prompt: expect.stringContaining("只让小猫看向镜头") });
    expect(JSON.parse(request.body).prompt).toContain("--iw 1.5");
    expect(request.headers["mj-api-secret"]).toBe("test-key");
    expect(request.redirect).toBe("error");
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onAccepted).toHaveBeenCalledWith("edit-task");
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not retry a rejected request with another image or model", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ code: 4, description: "当前精修不可用" }));
    expect(await editImage(source, "精修", { provider: "midjourney", referenceRevision: true, fetcher })).toMatchObject({ status: "error", message: "当前精修不可用" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retains an accepted receipt if result polling expires", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ code: 1, result: "pending-edit" }));
    expect(await editImage(source, "精修", { provider: "midjourney", referenceRevision: true, fetcher, mjTimeoutMs: 0 })).toMatchObject({ status: "error", providerTaskId: "pending-edit" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects mixed references and models before paid submission", async () => {
    const fetcher = vi.fn();
    for (const options of [{ provider: "fal" as const }, { provider: "midjourney" as const, referenceContextImageUrls: ["/other.png"] }, { provider: "midjourney" as const, editMaskImageUrl: source }]) {
      expect((await editImage(source, "精修", { ...options, referenceRevision: true, fetcher })).status).toBe("error");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
