import express from "express";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShiguangComputeBridgeRouter } from "./shiguangComputeBridge";
import { bridgeSignature } from "./shiguangBridgeSignature";
import { resetMemoryStateForTesting, upsertUser, getUserByOpenId } from "../db";
import { ensureWechatRegistrationGift } from "../services/accountIdentity";
import { getAccountBalance } from "../services/computeLedger";

const secret = "test-compute-bridge-secret-at-least-32";
const subject = `shiguang:${"a".repeat(64)}`;
const otherSubject = `shiguang:${"b".repeat(64)}`;
const servers: ReturnType<typeof createServer>[] = [];
beforeEach(() => resetMemoryStateForTesting());
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function fixture() {
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
    enabled: true, secret, ready: async () => true,
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
    return { status: response.status, body: await response.json() };
  };
  return { post, userId: users.get(subject)! };
}

describe("shared compute bridge with the real account ledger", () => {
  it("phone projects the desktop wallet; holds, settlement and retries converge", async () => {
    const { post, userId } = await fixture();
    expect((await post("balance", { subject })).body).toEqual({
      version: 1, unit: "compute", availableMicros: 10_000_000, reservedMicros: 0, spentMicros: 0,
    });
    const operation = { subject, operationId: "request-1", operationType: "chatInterview", requestHash: "c".repeat(64), maxCostMinor: 1_000_000 };
    expect((await post("reserve", operation)).body.outcome).toBe("reserved");
    expect((await post("reserve", operation)).body.outcome).toBe("replayed");
    expect((await post("balance", { subject })).body.availableMicros).toBe(8_000_000);
    const settlement = { subject, operationId: "request-1", outcome: { kind: "succeeded", verifiedCostMinor: 250_000 } };
    await post("settle", settlement);
    await post("settle", settlement);
    const desktop = await getAccountBalance(userId);
    expect(desktop.availableMinor).toBe(4_750_000);
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
});
