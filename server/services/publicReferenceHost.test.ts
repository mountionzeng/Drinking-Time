import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  publicReferenceKey,
  putPublicReference,
  signOssRequest,
} from "./publicReferenceHost";

const config = {
  region: "oss-cn-hangzhou",
  bucket: "mountion",
  accessKeyId: "AK-TEST",
  accessKeySecret: "SECRET-TEST",
};

describe("public reference host", () => {
  it("returns undefined when OSS is not configured, so the old path still runs", async () => {
    await expect(
      putPublicReference({
        key: "k.png",
        bytes: Buffer.from("x"),
        contentType: "image/png",
        config: undefined,
        fetcher: (() => {
          throw new Error("不该发请求");
        }) as never,
      })
    ).resolves.toBeUndefined();
  });

  it("signs exactly the canonical string OSS expects", () => {
    const date = "Fri, 22 Aug 2026 10:00:00 GMT";
    const authorization = signOssRequest({
      config,
      verb: "PUT",
      key: "visual-asset-refs/abc-front.png",
      contentType: "image/png",
      contentMd5: "MD5==",
      date,
      ossHeaders: { "x-oss-object-acl": "public-read" },
    });
    const expected = createHmac("sha1", config.accessKeySecret)
      .update(
        [
          "PUT",
          "MD5==",
          "image/png",
          date,
          "x-oss-object-acl:public-read\n/mountion/visual-asset-refs/abc-front.png",
        ].join("\n"),
        "utf8"
      )
      .digest("base64");
    expect(authorization).toBe(`OSS AK-TEST:${expected}`);
  });

  it("sorts x-oss headers and lowercases them before signing", () => {
    const date = "Fri, 22 Aug 2026 10:00:00 GMT";
    const shuffled = signOssRequest({
      config,
      verb: "PUT",
      key: "k.png",
      contentType: "image/png",
      contentMd5: "",
      date,
      ossHeaders: { "X-OSS-Storage-Class": "Standard", "x-oss-object-acl": "public-read" },
    });
    const ordered = signOssRequest({
      config,
      verb: "PUT",
      key: "k.png",
      contentType: "image/png",
      contentMd5: "",
      date,
      ossHeaders: { "x-oss-object-acl": "public-read", "x-oss-storage-class": "Standard" },
    });
    expect(shuffled).toBe(ordered);
  });

  it("uploads as public-read and returns the anonymous URL", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" }));
    const url = await putPublicReference({
      key: "visual-asset-refs/abc-front.png",
      bytes: Buffer.from("png-bytes"),
      contentType: "image/png",
      config,
      fetcher: fetcher as never,
      now: () => new Date("2026-08-22T10:00:00Z"),
    });
    expect(url).toBe(
      "https://mountion.oss-cn-hangzhou.aliyuncs.com/visual-asset-refs/abc-front.png"
    );
    const [requestUrl, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(requestUrl).toBe(url);
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    // MJ 服务端是匿名来拉的，对象必须公开可读。
    expect(headers["x-oss-object-acl"]).toBe("public-read");
    expect(headers.Authorization).toMatch(/^OSS AK-TEST:/);
    expect(headers["Content-MD5"]).toBeTruthy();
  });

  it("prefers a custom domain for the returned URL when configured", async () => {
    const url = await putPublicReference({
      key: "visual-asset-refs/abc.png",
      bytes: Buffer.from("x"),
      contentType: "image/png",
      config: { ...config, publicBaseUrl: "https://assets.mountion.cn/" },
      fetcher: (async () => ({ ok: true, status: 200, text: async () => "" })) as never,
      now: () => new Date("2026-08-22T10:00:00Z"),
    });
    expect(url).toBe("https://assets.mountion.cn/visual-asset-refs/abc.png");
  });

  it("surfaces the OSS error instead of silently returning a broken URL", async () => {
    await expect(
      putPublicReference({
        key: "k.png",
        bytes: Buffer.from("x"),
        contentType: "image/png",
        config,
        fetcher: (async () => ({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          text: async () => "<Error><Code>AccessDenied</Code></Error>",
        })) as never,
      })
    ).rejects.toThrow(/OSS 上传失败 \(403\)/);
  });

  it("keys objects by content hash so a public bucket is not enumerable", () => {
    const bytes = Buffer.from("front-view");
    const key = publicReferenceKey("1787-front.png", bytes);
    expect(key).toMatch(/^visual-asset-refs\/[0-9a-f]{16}-1787-front\.png$/);
    // 同样的内容得到同样的 key（可缓存），不同内容不会撞。
    expect(publicReferenceKey("1787-front.png", bytes)).toBe(key);
    expect(publicReferenceKey("1787-front.png", Buffer.from("back-view"))).not.toBe(key);
  });

  it("strips characters that would break the signed resource path", () => {
    const key = publicReferenceKey("../../etc/pa ss wd.png", Buffer.from("x"));
    expect(key.startsWith("visual-asset-refs/")).toBe(true);
    expect(key).not.toContain("..");
    expect(key).not.toContain(" ");
    expect(key.split("/")).toHaveLength(2);
  });
});
