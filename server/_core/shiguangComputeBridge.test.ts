import express from "express";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShiguangComputeBridgeRouter } from "./shiguangComputeBridge";
import { shiguangComputeBridgeRoutes } from "./shiguangComputeBridgeRoutes";
import { bridgeSignature } from "./shiguangBridgeSignature";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import { wechatRegistrationGiftInput } from "../services/accountIdentity";
import { getAccountBalance, grantCredit } from "../services/computeLedger";
import { decideStaleRelease } from "../../shared/computeStaleRelease";
import * as runtime from "../repositories/runtime";

const secret = "test-compute-bridge-secret-at-least-32";
const subject = `shiguang:${"a".repeat(64)}`;
const otherSubject = `shiguang:${"b".repeat(64)}`;
const servers: ReturnType<typeof createServer>[] = [];
beforeEach(() => resetMemoryStateForTesting());
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function fixture(options?: {
  enabled?: boolean;
  canary?: { acceptsNew: () => boolean; acceptsSettlement: () => boolean; admits: (subject: string, userId: number) => boolean };
  remap?: (subject: string, users: Map<string, number>) => number | undefined;
  configuredRoutes?: boolean;
}) {
  const users = new Map<string, number>();
  for (const s of [subject, otherSubject]) {
    await upsertUser({ openId: s, loginMethod: "wechat" });
    const user = (await getUserByOpenId(s))!;
    users.set(s, user.id);
    await grantCredit(wechatRegistrationGiftInput(user.id, s));
  }
  const nonces = new Set<string>();
  const app = express();
  app.use("/api/shiguang", options?.configuredRoutes ? shiguangComputeBridgeRoutes() : createShiguangComputeBridgeRouter({
    enabled: options?.enabled ?? true, secret, ready: async () => true, canary: options?.canary,
    claimNonce: async (_timestamp, nonce) => {
      if (nonces.has(nonce)) return false;
      nonces.add(nonce); return true;
    },
    resolve: async s => options?.remap ? options.remap(s, users) ?? null : users.get(s) ?? null,
    allow: async () => true,
  }));
  const server = createServer(app); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  let sequence = 0;
  const post = async (action: string, body: object, nonce = `compute_nonce_${++sequence}`.padEnd(20, "_"), key = secret) => {
    const route = options?.canary || options?.configuredRoutes ? "/compute-canary" : "/compute";
    const path = `${route}/${action}`, timestamp = String(Date.now());
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

describe("shared compute canary bridge", () => {
  const input = { subject, operationId: "canary-audio", operationType: "storyAudio",
    requestHash: "d".repeat(64), maxCostMinor: 100_000 };

  it("keeps the configured route closed without explicit enablement and a separate key", async () => {
    vi.stubEnv("SHIGUANG_COMPUTE_CANARY_ENABLED", "");
    vi.stubEnv("SHIGUANG_COMPUTE_CANARY_SIGNING_KEY", secret);
    vi.stubEnv("SHIGUANG_COMPUTE_CANARY_ACCEPT_NEW", "true");
    expect((await (await fixture({ configuredRoutes: true })).post("reserve", input)).status).toBe(503);
    vi.stubEnv("SHIGUANG_COMPUTE_CANARY_ENABLED", "true");
    vi.stubEnv("SHIGUANG_BRIDGE_SECRET", secret);
    expect((await (await fixture({ configuredRoutes: true })).post("reserve", input)).status).toBe(503);
    expect(runtime.memoryState.billingOperations).toHaveLength(0);
  });

  it("requires signed admission and never grants access from caller-provided identity fields", async () => {
    let admittedUser: number | undefined;
    const f = await fixture({ canary: { acceptsSettlement: () => true, acceptsNew: () => true, admits: (s, id) => s === subject && id === admittedUser } });
    admittedUser = f.userId;
    expect((await f.post("reserve", input, undefined, "wrong")).status).toBe(401);
    expect((await f.post("reserve", { ...input, userId: f.userId, trial: true })).status).toBe(400);
    expect((await f.post("reserve", { ...input, subject: otherSubject })).status).toBe(403);
    expect((await f.post("balance", { subject: otherSubject })).status).toBe(403);
    expect((await f.post("reserve", { ...input, operationType: "storyImages" })).status).toBe(403);
    expect(runtime.memoryState.billingOperations).toHaveLength(0);
    const replies = await Promise.all([f.post("reserve", input), f.post("reserve", input)]);
    expect(replies.map(r => r.body.outcome).sort()).toEqual(["replayed", "reserved"]);
    expect(runtime.memoryState.billingOperations).toHaveLength(1);
  });

  it("stops new and replayed reserves while the original subject can read the frozen quote and settle once", async () => {
    let running = true;
    const f = await fixture({ canary: { acceptsSettlement: () => true, acceptsNew: () => running, admits: s => running && s === subject } });
    expect((await f.post("reserve", input)).body.outcome).toBe("reserved");
    running = false;
    expect((await f.post("reserve", input)).status).toBe(403);
    expect((await f.post("reserve", { ...input, operationId: "new-request" })).status).toBe(403);
    let settlementEnabled = false;
    const restarted = await fixture({ canary: { acceptsSettlement: () => settlementEnabled, acceptsNew: () => false, admits: () => false },
      remap: (_subject, users) => users.get(subject) });
    const lookup = { subject, operationId: input.operationId, requestHash: input.requestHash };
    expect((await restarted.post("operation", { ...lookup, subject: otherSubject })).status).toBe(404);
    expect((await restarted.post("operation", { ...lookup, requestHash: "e".repeat(64) })).status).toBe(404);
    expect((await restarted.post("operation", lookup)).body).toMatchObject({ status: "reserved", maxCostMinor: 100_000 });
    const unknown = { subject, operationId: input.operationId, outcome: { kind: "submission_unknown" } };
    expect((await restarted.post("settle", unknown)).status).toBe(403);
    expect((await restarted.post("operation", lookup)).body.status).toBe("reserved");
    expect((await getAccountBalance(f.userId)).lifetimeSpentMinor).toBe(0);
    settlementEnabled = true;
    expect((await restarted.post("settle", unknown)).body).toMatchObject({ status: "submission_unknown" });
    const row = runtime.memoryState.billingOperations[0]!;
    expect(decideStaleRelease({
      status: row.status, operationType: row.operationType, holdActive: true,
      createdAt: row.createdAt, now: new Date(row.createdAt.getTime() + 25 * 3600_000),
      evidence: { storedOutput: false, outputUnstored: false, taskInFlight: false },
    }).action).toBe("manual");
    const settlement = { subject, operationId: input.operationId, outcome: { kind: "succeeded", verifiedCostMinor: 25_000 } };
    expect((await restarted.post("settle", { ...settlement, subject: otherSubject })).status).toBe(404);
    expect((await restarted.post("settle", settlement)).body).toMatchObject({ status: "settled", actualCostMinor: 25_000 });
    expect((await restarted.post("settle", settlement)).body).toMatchObject({ status: "settled", actualCostMinor: 25_000 });
    expect((await restarted.post("operation", lookup)).body).toMatchObject({ status: "settled", maxCostMinor: 100_000, actualCostMinor: 25_000 });
    expect((await getAccountBalance(f.userId)).lifetimeSpentMinor).toBe(25_000);
  });

  it("keeps legacy and canary operations independent even with an identical subject and request ID", async () => {
    const legacy = await fixture();
    const canary = await fixture({ canary: { acceptsSettlement: () => true, acceptsNew: () => true, admits: s => s === subject } });
    expect((await legacy.post("reserve", input)).body.outcome).toBe("reserved");
    const lookup = { subject, operationId: input.operationId, requestHash: input.requestHash };
    expect((await canary.post("operation", lookup)).status).toBe(404);
    expect((await canary.post("reserve", { ...input, maxCostMinor: 75_000 })).body.outcome).toBe("reserved");
    expect((await legacy.post("operation", lookup)).body.maxCostMinor).toBe(100_000);
    expect((await canary.post("operation", lookup)).body.maxCostMinor).toBe(75_000);
    expect(runtime.memoryState.billingOperations).toHaveLength(2);
  });
});

describe("shared compute bridge with the real account ledger", () => {
  it("reports an unmapped wallet without a balance, hold, or grant", async () => {
    const { post } = await fixture();
    const unmapped = `shiguang:${"c".repeat(64)}`;
    const before = runtime.memoryState.creditLedgerEntries.length;
    expect((await post("balance", { subject: unmapped })).body).toEqual({
      version: 1, unit: "compute", status: "registration_required",
    });
    expect((await post("statement", { subject: unmapped })).body).toEqual({
      version: 1, available: false, reason: "registration_required",
    });
    expect(runtime.memoryState.creditLedgerEntries).toHaveLength(before);
    expect(await getUserByOpenId(unmapped)).toBeUndefined();
  });

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
