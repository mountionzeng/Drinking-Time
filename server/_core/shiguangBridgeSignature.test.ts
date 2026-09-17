import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bridgeSignature, canonicalJson, hasValidBridgeSignature } from "./shiguangBridgeSignature";
import * as accountBridge from "./shiguangBridge";
import * as desktopBridge from "./shiguangDesktopBridge";

// Public cross-repository vector from shiguang-bridge-contract.md §11.1.
const secret = "contract-vector-secret-public-do-not-deploy";
const path = "/desktop/pair/issue";
const timestamp = "1789999200000";
const nonce = "AAECAwQFBgcICQoLDA0ODxAR";
const signature = "56e7210914295e1cd56e6ec84d1ff7b47f9975fc97735c4e91e5ab8050ebd921";
const body = {
  subject: "shiguang:8bf5716e65f591b83c18b8e37ce6e4d2ed2985fac96c3d1dac30f85ea04451c1",
  story: {
    title: "外婆的厨房",
    sourceRevision: "0123456789abcdef",
    sourceKey: "story:外婆的厨房",
    updatedAt: "2026-09-14T10:00:00.000Z",
    memories: [{
      text: '厨房里总有热气，"咕嘟"作响。', id: "memory-1",
      createdAt: "2026-09-13T10:00:00.000Z", people: ["外婆"], places: ["厨房"], emotions: ["温暖"],
    }],
    manuscript: {
      title: "外婆的厨房", generatedAt: "2026-09-14T10:00:00.000Z",
      chapters: [{ id: "chapter-1", title: "灶台边", memoryIds: ["memory-1"], content: [{ text: "第一章。" }, { photoId: "local-photo-1" }] }],
    },
  },
};

function request(overrides: Record<string, string | undefined> = {}, requestPath = path, requestBody: unknown = body) {
  const headers: Record<string, string | undefined> = {
    "x-shiguang-timestamp": timestamp,
    "x-shiguang-nonce": nonce,
    "x-shiguang-signature": signature,
    ...overrides,
  };
  return { path: requestPath, body: requestBody, header: (name: string) => headers[name] };
}

describe("拾光桥共享签名协议", () => {
  it("两个入口兼容导出指向同一实现", () => {
    for (const bridge of [accountBridge, desktopBridge]) {
      expect(bridge.canonicalJson).toBe(canonicalJson);
      expect(bridge.bridgeSignature).toBe(bridgeSignature);
    }
  });

  it("匹配已与云函数核对的固定签名、字节数和消息摘要", () => {
    const message = `POST\n${path}\n${timestamp}\n${nonce}\n${canonicalJson(body)}`;
    expect(Buffer.byteLength(message)).toBe(706);
    expect(createHash("sha256").update(message).digest("hex")).toBe("a78077544889a56c5a664708c008c46b0129ba09101e73e259a9339dc364f9e2");
    expect(bridgeSignature(secret, path, timestamp, nonce, body)).toBe(signature);
    expect(hasValidBridgeSignature(request(), secret, Number(timestamp))).toBe(true);
  });

  it("使用 UTF-16 键序，保持数组顺序，并递归省略 undefined 对象字段", () => {
    expect(canonicalJson({ 中: 1, a: 2, Z: 3, 2: 4, 10: 5, nested: { z: undefined, b: [null, true, "引号\"\n", { b: 2, a: 1 }] } }))
      .toBe('{"10":5,"2":4,"Z":3,"a":2,"nested":{"b":[null,true,"引号\\\"\\n",{"a":1,"b":2}]},"中":1}');
    const optionalBody = { ...body, story: { ...body.story, missing: undefined }, missing: undefined };
    expect(bridgeSignature(secret, path, timestamp, nonce, optionalBody)).toBe(signature);
    expect(bridgeSignature(secret, path, timestamp, nonce, JSON.parse(JSON.stringify(optionalBody)))).toBe(signature);
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it.each([-300_001, -300_000, 0, 300_000, 300_001])("保持五分钟双向时间窗边界：%i ms", offset => {
    expect(hasValidBridgeSignature(request(), secret, Number(timestamp) + offset)).toBe(Math.abs(offset) <= 300_000);
  });

  it.each([
    ["x-shiguang-timestamp", undefined], ["x-shiguang-timestamp", "178999920000"],
    ["x-shiguang-timestamp", "178999920000x"],
    ["x-shiguang-nonce", undefined], ["x-shiguang-nonce", "a".repeat(15)],
    ["x-shiguang-nonce", "a".repeat(65)], ["x-shiguang-nonce", "!".repeat(24)],
    ["x-shiguang-signature", undefined], ["x-shiguang-signature", "f".repeat(63)],
    ["x-shiguang-signature", "f".repeat(65)], ["x-shiguang-signature", "g".repeat(64)],
    ["x-shiguang-signature", signature.toUpperCase()], ["x-shiguang-signature", "0".repeat(64)],
  ])("安全拒绝无效头 %s = %s", (header, value) => {
    expect(hasValidBridgeSignature(request({ [header!]: value }), secret, Number(timestamp))).toBe(false);
  });

  it.each([16, 64])("接受合法 nonce 长度边界：%i", length => {
    const nextNonce = "_-" + "a".repeat(length - 2);
    expect(hasValidBridgeSignature(request({
      "x-shiguang-nonce": nextNonce,
      "x-shiguang-signature": bridgeSignature(secret, path, timestamp, nextNonce, body),
    }), secret, Number(timestamp))).toBe(true);
  });

  it("签名绑定相对路径、正文、时间戳、nonce 和密钥", () => {
    for (const altered of [
      request({}, "/api/shiguang" + path), request({}, "/stories"),
      request({}, path, { ...body, story: { ...body.story, title: "被改动" } }),
      request({ "x-shiguang-timestamp": String(Number(timestamp) + 1) }),
      request({ "x-shiguang-nonce": "another_valid_nonce" }),
    ]) expect(hasValidBridgeSignature(altered, secret, Number(timestamp))).toBe(false);
    expect(hasValidBridgeSignature(request(), secret + "wrong", Number(timestamp))).toBe(false);
  });
});
