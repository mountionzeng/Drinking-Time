import express from "express";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShiguangComputeBridgeRouter } from "./shiguangComputeBridge";
import { bridgeSignature } from "./shiguangBridgeSignature";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import { ensureWechatRegistrationGift } from "../services/accountIdentity";
import { getAccountBalance } from "../services/computeLedger";
import * as runtime from "../repositories/runtime";

const secret = "test-compute-bridge-secret-at-least-32";
const subject = `shiguang:${"a".repeat(64)}`;
const otherSubject = `shiguang:${"b".repeat(64)}`;
const servers: ReturnType<typeof createServer>[] = [];
beforeEach(() => resetMemoryStateForTesting());
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function fixture(options?: { enabled?: boolean }) {
  const users = new Map<string, number>();
  for (const s of [subject, otherSubject]) {
    await upsertUser({ openId: s, loginMethod: "wechat" });
    const user = (await getUserByOpenId(s))!;
    users.set(s, user.id);
    await ensureWechatRegistrationGift(user.id, s);
  }
  const nonces = new Set<string>();
  const app = express();
  app.use("/api/shiguang", createShiguangComputeBridgeRouter({
    enabled: options?.enabled ?? true, secret, ready: async () => true,
    claimNonce: async (_timestamp, nonce) => {
      if (nonces.has(nonce)) return false;
      nonces.add(nonce); return true;
    },
    resolve: async s => users.get(s)!, allow: async () => true,
  }));
  const server = createServer(app); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  let sequence = 0;
  const post = async (action: string, body: object, nonce = `compute_nonce_${++sequence}`.padEnd(20, "_"), key = secret) => {
    const path = `/compute/${action}`, timestamp = String(Date.now());
    const response = await fetch(`http://127.0.0.1:${address.port}/api/shiguang${path}`, {
      method: "POST", headers: {
        "content-type": "application/json", "x-shiguang-timestamp": timestamp,
        "x-shiguang-nonce": nonce,
        "x-shiguang-signature": bridgeSignature(key, path, timestamp, nonce, body),
      }, body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      cacheControl: response.headers.get("cache-control"),
    };
  };
  return { post, userId: users.get(subject)!, otherUserId: users.get(otherSubject)! };
}

describe("shared compute bridge with the real account ledger", () => {
  it("phone projects the desktop wallet; holds, settlement and retries converge", async () => {
    const { post, userId } = await fixture();
    expect((await post("balance", { subject })).body).toEqual({
      version: 1, unit: "compute", availableMicros: 5_000_000, reservedMicros: 0, spentMicros: 0,
    });
    const operation = { subject, operationId: "request-1", operationType: "chatInterview", requestHash: "c".repeat(64), maxCostMinor: 1_000_000 };
    expect((await post("reserve", operation)).body.outcome).toBe("reserved");
    expect((await post("reserve", operation)).body.outcome).toBe("replayed");
    expect((await post("balance", { subject })).body.availableMicros).toBe(3_000_000);
    const settlement = { subject, operationId: "request-1", outcome: { kind: "succeeded", verifiedCostMinor: 250_000 } };
    await post("settle", settlement);
    await post("settle", settlement);
    const desktop = await getAccountBalance(userId);
    expect(desktop.availableMinor).toBe(2_250_000);
    expect((await post("balance", { subject })).body).toEqual({
      version: 1, unit: "compute", availableMicros: desktop.availableMinor * 2,
      reservedMicros: 0, spentMicros: 500_000,
    });
  });

  it("rejects unsigned, replayed and caller-injected identity/balance fields", async () => {
    const { post } = await fixture();
    expect((await post("balance", { subject }, undefined, "wrong")).status).toBe(401);
    const nonce = "same_nonce_replay_1234";
    expect((await post("balance", { subject }, nonce)).status).toBe(200);
    expect((await post("balance", { subject }, nonce)).status).toBe(401);
    expect((await post("balance", { subject, userId: 1, availableMicros: 100 })).status).toBe(400);
  });

  it("cannot settle another account's operation, even with its operation ID", async () => {
    const { post } = await fixture();
    await post("reserve", { subject, operationId: "private", operationType: "storyImages", requestHash: "d".repeat(64), maxCostMinor: 1_000_000 });
    expect((await post("settle", { subject: otherSubject, operationId: "private", outcome: { kind: "not_charged_failure" } })).status).toBe(404);
    expect((await post("balance", { subject })).body.reservedMicros).toBe(2_000_000);
  });

  it("returns only this account's reserves, settles and releases", async () => {
    const { post, userId } = await fixture();
    const empty = await post("statement", { subject });
    expect(empty.status).toBe(200);
    expect(empty.cacheControl).toBe("no-store");
    expect(empty.body).toEqual({ version: 1, unit: "compute", items: [], nextCursor: null });

    const before = await getAccountBalance(userId);
    const operations = runtime.memoryState.billingOperations.length;
    const entries = runtime.memoryState.creditLedgerEntries.length;
    expect((await post("statement", { subject })).body).toEqual(empty.body);
    expect(await getAccountBalance(userId)).toEqual(before);
    expect(runtime.memoryState.billingOperations).toHaveLength(operations);
    expect(runtime.memoryState.creditLedgerEntries).toHaveLength(entries);

    await post("reserve", { subject, operationId: "charged", operationType: "chatInterview", requestHash: "c".repeat(64), maxCostMinor: 1_000_000 });
    await post("settle", { subject, operationId: "charged", outcome: { kind: "succeeded", verifiedCostMinor: 250_000 } });
    await post("reserve", { subject, operationId: "unknown", operationType: "storyImages", requestHash: "d".repeat(64), maxCostMinor: 100_000 });
    await post("settle", { subject, operationId: "unknown", outcome: { kind: "submission_unknown" } });
    await post("reserve", { subject, operationId: "failed", operationType: "storyAudio", requestHash: "e".repeat(64), maxCostMinor: 300_000 });
    await post("settle", { subject, operationId: "failed", outcome: { kind: "not_charged_failure" } });

    const statement = await post("statement", { subject });
    expect(statement.status).toBe(200);
    expect(statement.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "settle", type: "shiguang.chatInterview", status: "settled", amountMicros: -500_000 }),
      expect.objectContaining({ kind: "reserve", type: "shiguang.storyImages", status: "reconciliation", amountMicros: 200_000 }),
      expect.objectContaining({ kind: "release", type: "shiguang.storyAudio", status: "released", amountMicros: 600_000 }),
    ]));
    expect(statement.body.items).toHaveLength(3);
    for (const item of statement.body.items) {
      expect(Object.keys(item).sort()).toEqual(["amountMicros", "kind", "occurredAt", "status", "type"]);
      expect(item.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    const serialized = JSON.stringify(statement.body);
    expect(serialized).not.toContain(subject);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("c".repeat(64));
    expect(serialized).not.toContain("charged");
    expect(serialized).not.toContain("CNY");
    expect(serialized).not.toContain("userId");
    expect((await post("statement", { subject: otherSubject })).body.items).toEqual([]);
  });

  it("pages one account in a stable order and drops prompts and other accounts", async () => {
    const { post, userId, otherUserId } = await fixture();
    const occurredAt = new Date("2024-01-01T00:00:00.000Z");
    const secretOperationId = `operation-secret-${"a".repeat(40)}`;
    const secretHash = "f".repeat(64);
    runtime.memoryState.billingOperations.push(
      { id: 40, userId, operationId: "audio-hold", operationType: "shiguang.storyAudio", requestHash: "1".repeat(64), status: "submitted", maxCostMinor: 400, actualCostMinor: null, storyId: null, quoteExpiresAt: null, createdAt: occurredAt, updatedAt: occurredAt },
      { id: 30, userId, operationId: "chat-hold", operationType: "shiguang.chatInterview", requestHash: "2".repeat(64), status: "reserved", maxCostMinor: 300, actualCostMinor: null, storyId: null, quoteExpiresAt: null, createdAt: occurredAt, updatedAt: occurredAt },
      { id: 20, userId, operationId: secretOperationId, operationType: "PROMPT do not echo this poem", requestHash: secretHash, status: "reserved", maxCostMinor: 200, actualCostMinor: null, storyId: 8675309, quoteExpiresAt: null, createdAt: occurredAt, updatedAt: occurredAt },
      { id: 10, userId, operationId: "memory-hold", operationType: "shiguang.organizeMemory", requestHash: "3".repeat(64), status: "reserved", maxCostMinor: 100, actualCostMinor: null, storyId: null, quoteExpiresAt: null, createdAt: occurredAt, updatedAt: occurredAt },
      { id: 16, userId, operationId: "settled-op", operationType: "shiguang.generateBiography", requestHash: "4".repeat(64), status: "settled", maxCostMinor: 50, actualCostMinor: 50, storyId: null, quoteExpiresAt: null, createdAt: occurredAt, updatedAt: occurredAt },
      { id: 17, userId, operationId: "exception-op", operationType: "image.generate", requestHash: "7".repeat(64), status: "exception", maxCostMinor: 80, actualCostMinor: 80, storyId: null, quoteExpiresAt: null, createdAt: occurredAt, updatedAt: occurredAt },
      { id: 15, userId, operationId: "released-op", operationType: "shiguang.storyImages", requestHash: "5".repeat(64), status: "released", maxCostMinor: 150, actualCostMinor: 0, storyId: null, quoteExpiresAt: null, createdAt: occurredAt, updatedAt: occurredAt },
      { id: 9, userId: otherUserId, operationId: "other-private", operationType: "OTHER_USER_PRIVATE", requestHash: "6".repeat(64), status: "reserved", maxCostMinor: 123_456_789, actualCostMinor: null, storyId: null, quoteExpiresAt: null, createdAt: occurredAt, updatedAt: occurredAt },
    );
    runtime.memoryState.creditLedgerEntries.push({
      id: 25, userId, entryType: "consumption", amountMinor: -50, currency: "CNY",
      idempotencyKey: "consume:settled-op", operationId: "settled-op", giftCardId: null,
      actorUserId: 424242, reason: "REASON do not echo provider output", createdAt: occurredAt,
    });
    runtime.memoryState.creditLedgerEntries.push({
      id: 24, userId, entryType: "consumption", amountMinor: -80, currency: "CNY",
      idempotencyKey: "consume:exception-op", operationId: "exception-op", giftCardId: null,
      actorUserId: null, reason: null, createdAt: occurredAt,
    });
    runtime.memoryState.creditLedgerEntries.push({
      id: 5, userId, entryType: "gift", amountMinor: 1, currency: "CNY",
      idempotencyKey: "gift:secret", operationId: null, giftCardId: null,
      actorUserId: null, reason: "GIFT_SECRET_TEXT", createdAt: occurredAt,
    });

    const expected = [
      { occurredAt: occurredAt.toISOString(), kind: "reserve", type: "shiguang.storyAudio", status: "processing", amountMicros: 800 },
      { occurredAt: occurredAt.toISOString(), kind: "reserve", type: "shiguang.chatInterview", status: "reserved", amountMicros: 600 },
      { occurredAt: occurredAt.toISOString(), kind: "reserve", type: "other", status: "reserved", amountMicros: 400 },
      { occurredAt: occurredAt.toISOString(), kind: "reserve", type: "shiguang.organizeMemory", status: "reserved", amountMicros: 200 },
      { occurredAt: occurredAt.toISOString(), kind: "settle", type: "shiguang.generateBiography", status: "settled", amountMicros: -100 },
      { occurredAt: occurredAt.toISOString(), kind: "settle", type: "image.generate", status: "exception", amountMicros: -160 },
      { occurredAt: occurredAt.toISOString(), kind: "release", type: "shiguang.storyImages", status: "released", amountMicros: 300 },
    ];
    const page = await post("statement", { subject, limit: 50 });
    expect(page.body).toEqual({ version: 1, unit: "compute", items: expected, nextCursor: null });

    const seen = [];
    let cursor: string | undefined;
    for (let index = 0; index < expected.length + 1; index += 1) {
      const response = await post("statement", { subject, limit: 1, ...(cursor ? { cursor } : {}) });
      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(index === expected.length ? 0 : 1);
      seen.push(...response.body.items);
      cursor = response.body.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual(expected);
    expect(cursor).toBeUndefined();

    const again = [];
    cursor = undefined;
    for (let index = 0; index < expected.length; index += 1) {
      const response = await post("statement", { subject, limit: 1, ...(cursor ? { cursor } : {}) });
      again.push(...response.body.items);
      cursor = response.body.nextCursor ?? undefined;
    }
    expect(again).toEqual(expected);

    const leaked = JSON.stringify(page.body);
    for (const secretText of [secretOperationId, secretHash, "PROMPT do not echo this poem", "REASON do not echo provider output", "GIFT_SECRET_TEXT", "OTHER_USER_PRIVATE", "8675309", "424242", "CNY", subject, secret]) {
      expect(leaked).not.toContain(secretText);
    }
    const first = await post("statement", { subject, limit: 1 });
    const stolen = await post("statement", { subject: otherSubject, cursor: first.body.nextCursor });
    expect(stolen.status).toBe(200);
    expect(stolen.body.items).toEqual([
      { occurredAt: occurredAt.toISOString(), kind: "reserve", type: "OTHER_USER_PRIVATE", status: "reserved", amountMicros: 246_913_578 },
    ]);
    const foreign = await post("statement", { subject: otherSubject });
    expect(foreign.body.items).toEqual([
      { occurredAt: occurredAt.toISOString(), kind: "reserve", type: "OTHER_USER_PRIVATE", status: "reserved", amountMicros: 246_913_578 },
    ]);
    expect(JSON.stringify(foreign.body)).not.toContain("shiguang.chatInterview");
  });

  it("reuses the balance gate for statement reads", async () => {
    const { post } = await fixture();
    expect((await post("statement", { subject }, undefined, "wrong-secret")).status).toBe(401);
    const nonce = "statement_replay_1234";
    expect((await post("statement", { subject }, nonce)).status).toBe(200);
    expect((await post("statement", { subject }, nonce)).status).toBe(401);
    expect((await post("statement", { subject, userId: 1, availableMicros: 5 })).status).toBe(400);
    expect((await post("statement", { subject, limit: 51 })).status).toBe(400);
    expect((await post("statement", { subject, cursor: "bm90LWpzb24" })).status).toBe(400);
    const closed = await fixture({ enabled: false });
    expect((await closed.post("statement", { subject })).body).toEqual({ error: "compute_unavailable" });
    expect((await closed.post("balance", { subject })).status).toBe(503);
  });
});
