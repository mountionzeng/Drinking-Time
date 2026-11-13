import express from "express";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  memoryState,
  resetMemoryStateForTesting,
  getDb,
} from "../repositories/runtime";
import { ENV } from "./env";
import { bridgeSignature } from "./shiguangBridgeSignature";
import {
  storyMailboxNativeRoutes,
  storyMailboxNativeMediaRoutes,
} from "./storyMailboxNative";
import { createStory } from "../repositories/stories";
import { previewMailboxStory } from "../repositories/storyMailboxActions";
import {
  createMailboxHandoff,
  confirmMailboxHandoff,
  shareNativeMailbox,
  readNativeMailbox,
} from "../repositories/storyMailboxHandoff";
import { nativeMailboxDocument } from "../services/storyMailboxNativeView";
import { localVideoDir } from "../services/videoMedia";
import type { User } from "../../drizzle/schema";
vi.mock("../services/accountIdentity", () => ({
  accountDatabaseReady: async () => true,
  allowShiguangDesktopTransferAttempt: async () => true,
}));
const nonces = vi.hoisted(() => new Set<string>());
vi.mock("../repositories/shiguangBridgeNonces", () => ({
  claimShiguangBridgeNonce: async (timestamp: string, nonce: string) => {
    const key = timestamp + nonce;
    if (nonces.has(key)) return false;
    nonces.add(key);
    return true;
  },
}));
let server: Server, base: string, timestamp: string, dir: string;
const secret = "mailbox-http-test-secret-more-than-32";
beforeEach(async () => {
  nonces.clear();
  timestamp = String(Date.now());
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("WECHAT_MAILBOX_ENABLED", "true");
  vi.stubEnv("SHIGUANG_BRIDGE_SECRET", secret);
  vi.spyOn(ENV, "cookieSecret", "get").mockReturnValue(secret);
  dir = await mkdtemp(path.join(tmpdir(), "mailbox-media-http-"));
  vi.spyOn(ENV, "localImageDir", "get").mockReturnValue(
    path.join(dir, "images")
  );
  resetMemoryStateForTesting();
  await getDb();
  const app = express();
  app.use("/api/shiguang", storyMailboxNativeRoutes());
  app.use("/api/mailbox-native-media", storyMailboxNativeMediaRoutes());
  server = createServer(app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}/api/shiguang/mailbox`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(r => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function post(body: unknown, nonce: string, signatureBody = body) {
  return fetch(base, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shiguang-timestamp": timestamp,
      "x-shiguang-nonce": nonce,
      "x-shiguang-signature": bridgeSignature(
        secret,
        "/mailbox",
        timestamp,
        nonce,
        signatureBody
      ),
    },
    body: JSON.stringify(body),
  });
}
it("requires the signed cloud subject and accepted replay check; rejects browser identity injection", async () => {
  const body = { subject: `shiguang:${"a".repeat(64)}`, action: "list" };
  expect((await post(body, "valid-nonce-000000001")).status).toBe(200);
  expect((await post(body, "valid-nonce-000000001")).status).toBe(401);
  expect(
    (
      await post(
        { ...body, subject: `shiguang:${"b".repeat(64)}` },
        "valid-nonce-000000002",
        body
      )
    ).status
  ).toBe(401);
  expect(
    (await post({ ...body, userId: 7 }, "valid-nonce-000000003")).status
  ).toBe(409);
  expect(memoryState.storyMailboxWechatBindings).toEqual([]);
});
it("fails closed while the feature is disabled", async () => {
  vi.stubEnv("WECHAT_MAILBOX_ENABLED", "false");
  expect(
    (
      await post(
        { subject: `shiguang:${"a".repeat(64)}`, action: "list" },
        "valid-nonce-000000004"
      )
    ).status
  ).toBe(503);
});
it("streams only retained media with a current signature, supports ranges and revokes old friend URLs", async () => {
  const owner = `shiguang:${"a".repeat(64)}`,
    friend = `shiguang:${"b".repeat(64)}`;
  memoryState.users.push({ id: 1, name: "Owner" } as User);
  const storyId = (
    await createStory({ userId: 1, title: "Paper boat", body: {} })
  ).id;
  const preview = await previewMailboxStory(1, storyId);
  const result = await createMailboxHandoff(1, {
    storyId,
    requestId: randomUUID(),
    fingerprint: preview.fingerprint,
  });
  await confirmMailboxHandoff(owner, result.code);
  const { row } = await readNativeMailbox(owner, result.id);
  const file = `mailbox-${randomUUID()}.mp4`;
  await mkdir(localVideoDir(), { recursive: true });
  await writeFile(path.join(localVideoDir(), file), "0123456789");
  row.snapshot.videos = [
    { id: 1, videoUrl: "/api/videos/take-1.mp4" },
  ] as typeof row.snapshot.videos;
  row.snapshot.videoFiles = { "/api/videos/take-1.mp4": file };
  const share = await shareNativeMailbox(owner, result.id);
  const view = await readNativeMailbox(friend, result.id, share.token!);
  const media = new URL(
    nativeMailboxDocument(view.row, view.mine).media[0].url
  );
  const localUrl = new URL(media.pathname + media.search, base).toString();
  const response = await fetch(localUrl, { headers: { range: "bytes=2-5" } });
  expect(response.status).toBe(206);
  expect(await response.text()).toBe("2345");
  expect(response.headers.get("content-type")).toContain("video/mp4");
  expect(
    (
      await fetch(
        localUrl.replace(/token=[a-f0-9]+/, `token=${"0".repeat(64)}`)
      )
    ).status
  ).toBe(404);
  expect((await fetch(localUrl.replace(/e=\d+/, "e=1"))).status).toBe(404);
  await shareNativeMailbox(owner, result.id, true);
  expect((await fetch(localUrl)).status).toBe(404);
  await shareNativeMailbox(owner, result.id);
  expect((await fetch(localUrl)).status).toBe(404);
});
