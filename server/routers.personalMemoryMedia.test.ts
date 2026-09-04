/**
 * 受保护足迹媒体端点（U7）。
 *
 * 打真实的 express handler（`registerPersonalMemoryMediaRoute` 就是
 * `_core/index.ts` 挂载的那一个），跑在临时端口上发真实 HTTP 请求。
 * 只有「当前登录是谁」被注入——那正是这套测试要变化的自变量。
 *
 * 不复制一份 handler 到测试里：复制品会随主线漂移，然后测试继续绿着，
 * 而真正在线上跑的那段代码没人验证过。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createEmptyPersonalMemoryEventSnapshot } from "@shared/personalMemory";

const OWNER = 4301;
const INTRUDER = 4302;

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousLocalPersistPath = process.env.LOCAL_PERSIST_PATH;
const previousLocalImageDir = process.env.LOCAL_IMAGE_DIR;

let server: Server | null = null;
let baseUrl = "";
/** 当前请求被当成哪个登录用户；null = 未登录。 */
let currentUserId: number | null = null;

async function startRoute() {
  const { registerPersonalMemoryMediaRoute } = await import(
    "./_core/personalMemoryMediaRoute"
  );
  const app = express();
  registerPersonalMemoryMediaRoute(app, {
    resolveUserId: async () => currentUserId,
  });
  server = createServer(app);
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function seedImageEvent(userId: number, imageId: number) {
  const { capturePersonalMemoryEventStandalone } = await import(
    "./services/personalMemoryPersistence"
  );
  return capturePersonalMemoryEventStandalone({
    identity: {
      userId,
      sourceType: "image_adoption",
      sourceKey: `image:${imageId}`,
      sourceRevision: "signal:1",
      actionKind: "adopted",
      actionId: `image-adopt:${userId}:${imageId}`,
    },
    occurredOn: "2026-09-03",
    occurredAt: "2026-09-03T10:00:00.000Z",
    snapshot: createEmptyPersonalMemoryEventSnapshot(),
    storyId: null,
    job: null,
  });
}

describe("受保护足迹媒体端点", () => {
  beforeEach(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dt-pm-media-"));
    process.env.DATABASE_URL = "";
    process.env.LOCAL_PERSIST_PATH = path.join(tempDir, "local-persist.json");
    process.env.LOCAL_IMAGE_DIR = path.join(tempDir, "images");
    fs.mkdirSync(process.env.LOCAL_IMAGE_DIR, { recursive: true });
    const db = await import("./db");
    db.resetMemoryStateForTesting();
    currentUserId = null;
    await startRoute();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>(resolve => server!.close(() => resolve()));
      server = null;
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousLocalPersistPath === undefined) {
      delete process.env.LOCAL_PERSIST_PATH;
    } else {
      process.env.LOCAL_PERSIST_PATH = previousLocalPersistPath;
    }
    if (previousLocalImageDir === undefined) delete process.env.LOCAL_IMAGE_DIR;
    else process.env.LOCAL_IMAGE_DIR = previousLocalImageDir;
  });

  it("未登录直接 401", async () => {
    const seeded = await seedImageEvent(OWNER, 1);
    currentUserId = null;
    const response = await fetch(
      `${baseUrl}/api/personal-memory/media/${seeded.event.id}`
    );
    expect(response.status).toBe(401);
  });

  it("另一个账号拿本人的 eventId 是 404（不是 403，不确认 ID 存在）", async () => {
    const seeded = await seedImageEvent(OWNER, 1);
    currentUserId = INTRUDER;
    const response = await fetch(
      `${baseUrl}/api/personal-memory/media/${seeded.event.id}`
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("不存在的 eventId 是 404", async () => {
    currentUserId = OWNER;
    const response = await fetch(
      `${baseUrl}/api/personal-memory/media/999999`
    );
    expect(response.status).toBe(404);
  });

  it.each([["0"], ["-1"], ["abc"], ["1.5"]])(
    "非法 eventId（%s）是 400，不进任何仓储查询",
    async raw => {
      currentUserId = OWNER;
      const response = await fetch(
        `${baseUrl}/api/personal-memory/media/${raw}`
      );
      expect(response.status).toBe(400);
    }
  );

  it("本人但图片来源不可达时是 404，不泄露磁盘路径", async () => {
    const seeded = await seedImageEvent(OWNER, 4242);
    currentUserId = OWNER;
    const response = await fetch(
      `${baseUrl}/api/personal-memory/media/${seeded.event.id}`
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toContain(".png");
    expect(body).not.toContain("/api/images");
  });

  it("永远不重定向到公开静态图片路由", async () => {
    const seeded = await seedImageEvent(OWNER, 1);
    currentUserId = OWNER;
    const response = await fetch(
      `${baseUrl}/api/personal-memory/media/${seeded.event.id}`,
      { redirect: "manual" }
    );
    // 302 到 /api/images 会把不鉴权的公开地址交到浏览器手上，
    // 前面所有归属校验就全白做了。这里锁死这条路。
    expect([301, 302, 303, 307, 308]).not.toContain(response.status);
    expect(response.headers.get("location")).toBeNull();
  });

  it("成功返回时是 private 且不进共享缓存", async () => {
    const { resolvePersonalMemoryMediaFile } = await import(
      "./services/personalMemoryTimeline"
    );
    // 直接注入一个已解析成功的结果：这里要验的是响应头，
    // 而"怎么判定归属"已经由 personalMemoryTimeline.test.ts 覆盖。
    const filePath = path.join(process.env.LOCAL_IMAGE_DIR!, "ok.png");
    fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const app = express();
    const { registerPersonalMemoryMediaRoute } = await import(
      "./_core/personalMemoryMediaRoute"
    );
    registerPersonalMemoryMediaRoute(app, {
      resolveUserId: async () => OWNER,
      resolveFile: (async () => ({
        ok: true as const,
        localPath: filePath,
        contentType: "image/png",
      })) as typeof resolvePersonalMemoryMediaFile,
    });
    const localServer = createServer(app);
    await new Promise<void>(resolve =>
      localServer.listen(0, "127.0.0.1", resolve)
    );
    const address = localServer.address();
    if (!address || typeof address === "string") throw new Error("no port");
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/personal-memory/media/1`
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
      const cacheControl = response.headers.get("cache-control") ?? "";
      expect(cacheControl).toContain("private");
      expect(cacheControl).not.toContain("public");
      expect(cacheControl).not.toContain("immutable");
    } finally {
      await new Promise<void>(resolve => localServer.close(() => resolve()));
    }
  });
});
