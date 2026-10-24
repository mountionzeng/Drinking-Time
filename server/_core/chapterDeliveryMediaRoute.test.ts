import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  findUpload: vi.fn(),
  getDelivery: vi.fn(),
  listAssets: vi.fn(),
  storageGet: vi.fn(),
  storagePut: vi.fn(),
}));

vi.mock("../repositories/chapterDeliveries", () => ({
  completeChapterAssetUpload: mocks.complete,
  findChapterAssetUpload: mocks.findUpload,
  getChapterDelivery: mocks.getDelivery,
  listChapterDeliveryAssets: mocks.listAssets,
}));
vi.mock("../storage", () => ({ storageGet: mocks.storageGet, storagePut: mocks.storagePut }));

import { ENV } from "./env";
import { chapterDeliveryMediaRoutes, chapterDeliveryUploadBodyParser, handleChapterDeliveryDownload, handleChapterDeliveryUpload } from "./chapterDeliveryMediaRoute";

const secret = "chapter-delivery-test-secret-000000000000";
const deliveryId = "b5472c85-3caa-4b45-b5f1-0f1488043899";
const packageId = "cp_deliverytest-001";
const assetId = "asset-0123456789abcdef0123456789abcdef";
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const uploadToken = Buffer.alloc(32, 7).toString("base64url");
const originalCookieSecret = ENV.cookieSecret;

function request(input: { method?: string; params?: Record<string, string>; query?: Record<string, string>; headers?: Record<string, string>; body?: Buffer }): Request {
  const headers = input.headers ?? {};
  return {
    method: input.method ?? "GET",
    params: input.params ?? {},
    query: input.query ?? {},
    body: input.body,
    header: (name: string) => headers[name.toLowerCase()],
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function response() {
  const output: { statusCode: number; body: unknown; sent: unknown; headers: Record<string, string> } = {
    statusCode: 200, body: undefined, sent: undefined, headers: {},
  };
  const res = {
    setHeader(name: string, value: string) { output.headers[name] = value; return res; },
    status(code: number) { output.statusCode = code; return res; },
    json(value: unknown) { output.body = value; return res; },
    send(value: unknown) { output.sent = value; return res; },
  } as unknown as Response;
  return { res, output };
}

function downloadToken(expiresAt: number, recipientUserId = 42) {
  return createHmac("sha256", secret)
    .update(`chapter-delivery-download:v1:${deliveryId}:${recipientUserId}:${assetId}:${expiresAt}`)
    .digest("base64url");
}

describe("chapter delivery media capability handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CHAPTER_PACKAGE_ENABLED", "true");
    vi.stubEnv("CHAPTER_DELIVERY_ENABLED", "true");
    ENV.cookieSecret = secret;
    mocks.findUpload.mockResolvedValue({
      packageId, assetId, mime: "image/png", bytes: bytes.length, sha256,
      uploadExpiresAt: new Date(Date.now() + 60_000),
    });
    mocks.complete.mockResolvedValue("uploaded");
    mocks.getDelivery.mockResolvedValue({
      deliveryId, packageId, recipientUserId: 42, readyAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.listAssets.mockResolvedValue([{ packageId, assetId, mime: "image/png", bytes: bytes.length, sha256, storageKey: `chapter-deliveries/${sha256}.png` }]);
    mocks.storageGet.mockResolvedValue({ key: `chapter-deliveries/${sha256}.png`, url: "https://storage.example.test/image" });
  });
  afterEach(() => {
    ENV.cookieSecret = originalCookieSecret;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts an exact upload capability and records only matching bytes", async () => {
    mocks.storagePut.mockResolvedValue({ key: `chapter-deliveries/${sha256}.png`, url: "https://storage.example.test/image" });
    const { res, output } = response();
    await handleChapterDeliveryUpload(request({
      params: { packageId, assetId },
      headers: { authorization: `Bearer ${uploadToken}`, "content-type": "image/png" },
      body: bytes,
    }), res);
    expect(output.statusCode).toBe(200);
    expect(output.body).toEqual({ ok: true, repeated: false });
    expect(mocks.storagePut).toHaveBeenCalledWith(`chapter-deliveries/${sha256}.png`, bytes, "image/png");
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ packageId, assetId,
      storageKey: `chapter-deliveries/${sha256}.png`, tokenHash: createHash("sha256").update(uploadToken).digest("hex") }));
  });

  it("rejects wrong route scope, expiry, MIME, length, and digest before storing", async () => {
    const wrongPath = response();
    await handleChapterDeliveryUpload(request({
      params: { packageId: "cp_other-0001", assetId }, headers: { authorization: `Bearer ${uploadToken}`, "content-type": "image/png" }, body: bytes,
    }), wrongPath.res);
    expect(wrongPath.output.statusCode).toBe(404);

    mocks.findUpload.mockResolvedValueOnce({ packageId, assetId, mime: "image/png", bytes: bytes.length, sha256, uploadExpiresAt: new Date(Date.now() - 1) });
    const expired = response();
    await handleChapterDeliveryUpload(request({ params: { packageId, assetId }, headers: { authorization: `Bearer ${uploadToken}`, "content-type": "image/png" }, body: bytes }), expired.res);
    expect(expired.output.statusCode).toBe(404);

    const mismatch = response();
    await handleChapterDeliveryUpload(request({ params: { packageId, assetId }, headers: { authorization: `Bearer ${uploadToken}`, "content-type": "image/jpeg" }, body: bytes }), mismatch.res);
    expect(mismatch.output.statusCode).toBe(400);
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();

    const badDigest = response();
    await handleChapterDeliveryUpload(request({
      params: { packageId, assetId }, headers: { authorization: `Bearer ${uploadToken}`, "content-type": "image/png" }, body: Buffer.from("different"),
    }), badDigest.res);
    expect(badDigest.output.statusCode).toBe(400);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("rejects disabled gates and asset metadata above the 2 MiB ceiling before storage access", async () => {
    const expiresAt = Date.now() + 60_000;
    for (const flag of ["CHAPTER_PACKAGE_ENABLED", "CHAPTER_DELIVERY_ENABLED"] as const) {
      vi.stubEnv(flag, "false");
      const upload = response();
      await handleChapterDeliveryUpload(request({
        params: { packageId, assetId },
        headers: { authorization: `Bearer ${uploadToken}`, "content-type": "image/png" },
        body: bytes,
      }), upload.res);
      expect(upload.output.statusCode).toBe(404);
      const download = response();
      await handleChapterDeliveryDownload(request({
        params: { deliveryId, assetId },
        query: { e: String(expiresAt), token: downloadToken(expiresAt) },
      }), download.res);
      expect(download.output.statusCode).toBe(404);
      vi.stubEnv(flag, "true");
    }

    mocks.findUpload.mockResolvedValueOnce({
      packageId, assetId, mime: "image/png", bytes: 2 * 1024 * 1024 + 1, sha256,
      uploadExpiresAt: new Date(Date.now() + 60_000),
    });
    const tooLargeUpload = response();
    await handleChapterDeliveryUpload(request({
      params: { packageId, assetId },
      headers: { authorization: `Bearer ${uploadToken}`, "content-type": "image/png" },
      body: bytes,
    }), tooLargeUpload.res);
    expect(tooLargeUpload.output.statusCode).toBe(400);
    expect(mocks.storagePut).not.toHaveBeenCalled();

    mocks.listAssets.mockResolvedValueOnce([{
      packageId, assetId, mime: "image/png", bytes: 2 * 1024 * 1024 + 1, sha256,
      storageKey: `chapter-deliveries/${sha256}.png`,
    }]);
    const tooLargeDownload = response();
    await handleChapterDeliveryDownload(request({
      params: { deliveryId, assetId },
      query: { e: String(expiresAt), token: downloadToken(expiresAt) },
    }), tooLargeDownload.res);
    expect(tooLargeDownload.output.statusCode).toBe(503);
    expect(mocks.storageGet).not.toHaveBeenCalled();
  });

  it("serves bytes only for a fresh recipient-bound capability and rejects redirects", async () => {
    const expiresAt = Date.now() + 60_000;
    const invalid = response();
    await handleChapterDeliveryDownload(request({
      params: { deliveryId, assetId }, query: { e: String(expiresAt), token: downloadToken(expiresAt, 99) },
    }), invalid.res);
    expect(invalid.output.statusCode).toBe(404);
    expect(mocks.storageGet).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async (_url: URL, options: RequestInit) => {
      expect(options.redirect).toBe("error");
      throw new TypeError("redirect rejected");
    }));
    const redirected = response();
    await handleChapterDeliveryDownload(request({
      params: { deliveryId, assetId }, query: { e: String(expiresAt), token: downloadToken(expiresAt) },
    }), redirected.res);
    expect(redirected.output.statusCode).toBe(503);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200 })));
    const valid = response();
    await handleChapterDeliveryDownload(request({
      params: { deliveryId, assetId }, query: { e: String(expiresAt), token: downloadToken(expiresAt) },
    }), valid.res);
    expect(valid.output.statusCode).toBe(200);
    expect(valid.output.sent).toEqual(bytes);
    expect(valid.output.headers["Content-Type"]).toBe("image/png");
  });

  it("stops a storage response that exceeds the declared asset size", async () => {
    const expiresAt = Date.now() + 60_000;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.alloc(bytes.length + 1), { status: 200 })));
    const output = response();
    await handleChapterDeliveryDownload(request({
      params: { deliveryId, assetId }, query: { e: String(expiresAt), token: downloadToken(expiresAt) },
    }), output.res);
    expect(output.output.statusCode).toBe(503);
  });

  it("rejects a storage response without a stream instead of buffering it unbounded", async () => {
    const expiresAt = Date.now() + 60_000;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const output = response();
    await handleChapterDeliveryDownload(request({
      params: { deliveryId, assetId }, query: { e: String(expiresAt), token: downloadToken(expiresAt) },
    }), output.res);
    expect(output.output.statusCode).toBe(503);
  });

  it("rejects an over-limit raw upload body before it reaches the handler", async () => {
    for (const includeContentLength of [true, false]) {
      const body = Buffer.alloc(2 * 1024 * 1024 + 1);
      const headers = {
        "content-type": "image/png",
        ...(includeContentLength ? { "content-length": String(body.length) } : { "transfer-encoding": "chunked" }),
      };
      const req = Object.assign(Readable.from([body]), {
        headers,
        method: "PUT",
        url: `/api/chapter-delivery/media/${packageId}/${assetId}`,
      }) as unknown as Request;
      const parserError = await new Promise<unknown>(resolve => {
        chapterDeliveryUploadBodyParser(req, {} as Response, error => resolve(error));
      });
      expect(parserError).toMatchObject({ status: 413, type: "entity.too.large" });
      expect(req.body).toEqual({});
    }
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("mounts a production Origin gate before media handlers", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_ORIGIN", "https://app.example.test");
    const router = chapterDeliveryMediaRoutes() as unknown as { stack: Array<{ handle: (req: Request, res: Response, next: () => void) => void }> };
    const originGate = router.stack[0]!.handle;

    const denied = response();
    const deniedRequest = request({ method: "PUT", headers: { origin: "https://attacker.example" } });
    let deniedNext = false;
    originGate(deniedRequest, denied.res, () => { deniedNext = true; });
    expect(denied.output.statusCode).toBe(403);
    expect(deniedNext).toBe(false);

    const missing = response();
    const missingOrigin = request({ method: "PUT" });
    originGate(missingOrigin, missing.res, () => { throw new Error("missing Origin must be rejected"); });
    expect(missing.output.statusCode).toBe(403);
  });
});
