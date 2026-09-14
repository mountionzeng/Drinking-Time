import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bridgeSignature,
  canonicalJson,
  createShiguangDesktopBridgeRouter,
  parseShiguangStorySnapshot,
} from "./shiguangDesktopBridge";

const secret = "test-shiguang-desktop-secret-at-least-32";
const subject = `shiguang:${"a".repeat(64)}`;
const story = {
  sourceKey: "story:外婆的厨房",
  sourceRevision: "0123456789abcdef",
  title: "外婆的厨房",
  updatedAt: "2026-09-14T10:00:00.000Z",
  memories: [{ id: "memory-1", text: "厨房里总有热气。", createdAt: "2026-09-13T10:00:00.000Z", people: ["外婆"] }],
};

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function post(
  overrides: Partial<Parameters<typeof createShiguangDesktopBridgeRouter>[0]> = {},
  body: unknown = { subject, story },
  nonce = "nonce_for_desktop_transfer"
) {
  const app = express();
  const deps = {
    enabled: true,
    secret,
    ready: vi.fn(async () => true),
    allow: vi.fn(async () => true),
    resolve: vi.fn(async () => 17),
    importStory: vi.fn(async () => ({ storyId: 31, created: true })),
    issuePairing: vi.fn(async () => ({ outcome: "issued" as const, code: "ABC234", expiresAt: new Date("2026-09-14T10:05:00.000Z") })),
    now: () => 1_800_000_000_000,
    ...overrides,
  };
  app.use("/api/shiguang", createShiguangDesktopBridgeRouter(deps));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test address");
  const path = "/desktop/pair/issue";
  const timestamp = String(deps.now());
  const response = await fetch(`http://127.0.0.1:${address.port}/api/shiguang${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shiguang-timestamp": timestamp,
      "x-shiguang-nonce": nonce,
      "x-shiguang-signature": bridgeSignature(secret, path, timestamp, nonce, body),
    },
    body: JSON.stringify(body),
  });
  return { response, deps };
}

describe("拾光家忆故事进入电脑", () => {
  it("把可信微信主体的故事导入同一账号后签发一次性电脑码", async () => {
    const { response, deps } = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: "ABC234", expiresAt: "2026-09-14T10:05:00.000Z", storyId: 31, imported: true });
    expect(deps.resolve).toHaveBeenCalledWith(subject);
    expect(deps.importStory).toHaveBeenCalledWith(17, story);
    expect(deps.issuePairing).toHaveBeenCalledWith(17);
  });

  it("拒绝客户端伪造主体格式或损坏的故事快照", async () => {
    const { response, deps } = await post({}, { subject: "wechat:forged", story: { ...story, memories: "all" } });
    expect(response.status).toBe(400);
    expect(deps.resolve).not.toHaveBeenCalled();
  });

  it("签名错误和关闭开关都失败关闭", async () => {
    const disabled = await post({ enabled: false });
    expect(disabled.response.status).toBe(503);
    const unsigned = await post({ secret: "different-secret-with-at-least-32-characters" });
    expect(unsigned.response.status).toBe(401);
  });

  it("只接受有界且可解析的快照", () => {
    expect(parseShiguangStorySnapshot(story)).toEqual(story);
    expect(parseShiguangStorySnapshot({ ...story, title: "" })).toBeNull();
    expect(parseShiguangStorySnapshot({ ...story, memories: [{ ...story.memories[0], text: "甲".repeat(2_001) }] })).toBeNull();
  });

  it("签名序列化与 JSON 传输一样忽略对象里的 undefined", () => {
    expect(canonicalJson({ a: 1, missing: undefined })).toBe('{"a":1}');
  });
});
