import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bridgeSignature, createShiguangBridgeRouter, type ShiguangBridgeDependencies } from "./shiguangBridge";

describe("拾光家忆服务器桥", () => {
  let server: Server, base = "", nonceCounter = 0;
  const secret = "test-shiguang-bridge-secret-at-least-32";
  const subject = `shiguang:${"a".repeat(64)}`;
  const otherSubject = `shiguang:${"c".repeat(64)}`;
  const deps: ShiguangBridgeDependencies = {
    enabled: true, secret, ready: async () => true, allow: async () => true,
    resolve: async input => input === subject ? 7 : 8,
    principal: async userId => ({ id: userId, sessionVersion: 2 }),
    emailHint: async userId => userId === 7 ? "m***@example.com" : "o***@example.com",
    requestOtp: async () => "sent", linkEmail: async () => ({ outcome: "linked", userId: 7 }),
    stories: async userId => ({
      stories: userId === 7 ? [{ id: 41, title: "我的旧故事" }] : [{ id: 42, title: "另一个账号的故事" }],
      nextCursor: null,
    }),
    document: async (userId, storyId) => userId === 7 && storyId === 41 ? { title: "我的旧故事", body: "只属于这个账号的正文", bodyAvailable: true, sourceRevision: "b".repeat(24), sourceUpdatedAt: 1_700_000_000_000 } :
      userId === 8 && storyId === 42 ? { title: "另一个账号的故事", body: "另一个账号正文", bodyAvailable: true, sourceRevision: "d".repeat(24), sourceUpdatedAt: 1_700_000_000_001 } : null,
    now: () => 1_700_000_000_000,
  };
  beforeEach(async () => {
    nonceCounter = 0;
    const app = express(); app.use("/api/shiguang", createShiguangBridgeRouter(deps));
    server = createServer(app); await new Promise<void>(resolve => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/shiguang`;
  });
  afterEach(() => new Promise<void>(resolve => server.close(() => resolve())));
  async function post(path: string, body: Record<string, unknown>, valid = true) {
    const timestamp = "1700000000000", nonce = `nonce_for_request_${++nonceCounter}`;
    return fetch(base + path, { method: "POST", headers: { "content-type": "application/json",
      "x-shiguang-timestamp": timestamp, "x-shiguang-nonce": nonce,
      "x-shiguang-signature": valid ? bridgeSignature(secret, path, timestamp, nonce, body) : "0".repeat(64) }, body: JSON.stringify(body) });
  }
  it("拒绝客户端伪造或过期的服务器签名", async () => {
    expect((await post("/stories", { subject }, false)).status).toBe(401);
    const body = { subject }, nonce = "nonce_for_one_request", timestamp = "1699999000000";
    const response = await fetch(base + "/stories", { method: "POST", headers: { "content-type": "application/json",
      "x-shiguang-timestamp": timestamp, "x-shiguang-nonce": nonce,
      "x-shiguang-signature": bridgeSignature(secret, "/stories", timestamp, nonce, body) }, body: JSON.stringify(body) });
    expect(response.status).toBe(401);
  });
  it("拒绝同一签名请求在有效期内重放", async () => {
    const body = { subject }, timestamp = "1700000000000", nonce = "nonce_for_replay_test";
    const request = () => fetch(base + "/stories", { method: "POST", headers: { "content-type": "application/json",
      "x-shiguang-timestamp": timestamp, "x-shiguang-nonce": nonce,
      "x-shiguang-signature": bridgeSignature(secret, "/stories", timestamp, nonce, body) }, body: JSON.stringify(body) });
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(401);
  });
  it("邮箱双重验证后只按服务端身份列出和读取故事", async () => {
    expect(await (await post("/status", { subject })).json()).toEqual({ linked: true, emailHint: "m***@example.com" });
    expect((await post("/link/email/otp/request", { subject, email: "ME@example.com" })).status).toBe(200);
    expect((await post("/link/email", { subject, email: "me@example.com", otp: "123456" })).status).toBe(200);
    expect(await (await post("/stories", { subject, cursor: 0 })).json()).toEqual({ stories: [{ id: 41, title: "我的旧故事" }], nextCursor: null });
    expect(await (await post("/stories/read", { subject, storyId: 41 })).json()).toEqual({ id: 41, title: "我的旧故事", body: "只属于这个账号的正文", bodyAvailable: true, sourceRevision: "b".repeat(24), sourceUpdatedAt: 1_700_000_000_000 });
    expect((await post("/stories/read", { subject, storyId: 99 })).status).toBe(404);
    expect(await (await post("/stories", { subject: otherSubject, cursor: 0 })).json()).toEqual({ stories: [{ id: 42, title: "另一个账号的故事" }], nextCursor: null });
    expect((await post("/stories/read", { subject: otherSubject, storyId: 41 })).status).toBe(404);
    expect((await post("/stories", { subject, cursor: -1 })).status).toBe(400);
  });
  it("签名协议与拾光云函数共享固定测试向量", () => {
    expect(bridgeSignature(secret, "/link/email/otp/request", "1700000000000", "nonce_for_golden_vector",
      { subject, email: "me@example.com" })).toBe("71212c4e14c99d63994fdfe96783691d8f85e3cbcf07e8cee59597e5b62ad86b");
  });
  it("正文按真实传输字节限制，避免云函数收到半截响应", async () => {
    const original = deps.document;
    deps.document = async () => ({ title: "特殊正文", body: "\u0000".repeat(50_000), bodyAvailable: true,
      sourceRevision: "e".repeat(24), sourceUpdatedAt: 1_700_000_000_000 });
    expect((await post("/stories/read", { subject, storyId: 41 })).status).toBe(413);
    deps.document = original;
  });
});
