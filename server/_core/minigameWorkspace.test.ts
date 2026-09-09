import express from "express";
import type { Server } from "node:http";
import { beforeAll, afterAll, beforeEach, it, expect, vi } from "vitest";
import {
  createStory,
  getStoryById,
  getUserById,
  getUserByOpenId,
  resetMemoryStateForTesting,
  upsertUser,
  upsertEmotionDailyLetter,
} from "../db";
import { createMinigameRouter } from "./minigameRouter";
import { dispatchMinigameWorkspace } from "./minigameWorkspace";
import { createGameSessions } from "./minigameSession";

// Only replace production MySQL readiness/user loading. Procedures, persistence,
// CAS and ownership are real, using root Vitest's per-file temporary data path.
vi.mock("../services/accountIdentity", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/accountIdentity")>()),
  getAccountWorkspaceUser: (id: number) => getUserById(id),
}));
const secret = "workspace-test-signing-secret-32-characters",
  appId = "wxd6aeb0bc3a031d39";
let server: Server,
  base: string,
  userId: number,
  otherId: number,
  storyId: number,
  token: string;
beforeAll(async () => {
  process.env.MINIGAME_SESSION_SECRET = secret;
  const app = express();
  app.use(
    "/api/minigame",
    createMinigameRouter({
      enabled: true,
      wechatEnabled: false,
      secret,
      appId,
      ready: async () => true,
      getUser: getUserById,
      allow: async () => true,
      password: async () => null,
      wechat: async () => null,
      bind: async () => "invalid_code",
      stories: async () => [],
      document: async () => null,
      workspace: dispatchMinigameWorkspace,
    })
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("missing test address");
  base = `http://127.0.0.1:${address.port}/api/minigame/workspace/`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
beforeEach(async () => {
  resetMemoryStateForTesting();
  await upsertUser({ openId: "game-owner", name: "Owner", role: "user" });
  await upsertUser({ openId: "game-other", name: "Other", role: "user" });
  const user = (await getUserByOpenId("game-owner"))!;
  userId = user.id;
  otherId = (await getUserByOpenId("game-other"))!.id;
  storyId = (await createStory({ userId, title: "Original", body: {} })).id;
  token = await createGameSessions(secret, appId, getUserById).issue(user);
});
async function request(operation: string, input: unknown = {}, bearer = token) {
  return fetch(base + operation, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
      cookie: "app_session_id=not-a-game-credential",
    },
    body: JSON.stringify(input),
  });
}
it("real Web body persistence round-trips and refuses a stale revision without overwriting", async () => {
  const init = await request("body.initialize", { storyId });
  expect(init.status).toBe(200);
  const { result: document } = await init.json();
  const input = {
    storyId,
    versionId: document.versionId,
    platform: document.platform,
    baseBodyRevision: document.bodyRevision,
    body: "Game edit",
  };
  const saved = await (await request("body.save", input)).json();
  expect(saved.result.status).toBe("saved");
  const stale = await (
    await request("body.save", { ...input, body: "Stale overwrite" })
  ).json();
  expect(stale.result).toMatchObject({
    status: "conflict",
    latestDocument: { body: "Game edit" },
  });
  const read = await (await request("body.read", { storyId })).json();
  expect(read.result.body).toBe("Game edit");
});
it("real caller cannot read another owner or turn a create action into an update", async () => {
  const other = (
    await createStory({ userId: otherId, title: "Private", body: {} })
  ).id;
  expect(
    (await request("body.read", { storyId: other, userId: otherId })).status
  ).toBe(404);
  expect(
    (await request("chat.list", { storyId: other, userId: otherId })).status
  ).toBe(404);
  const created = await (
    await request("stories.create", {
      id: storyId,
      title: "Overwrite",
      userId: otherId,
    })
  ).json();
  expect(created.result.id).not.toBe(storyId);
  expect((await getStoryById(storyId, userId))?.title).toBe("Original");
  expect(await getStoryById(created.result.id, otherId)).toBeNull();
});
it("account response omits secrets and unknown operations remain closed", async () => {
  const data = await (await request("account.read")).json();
  expect(Object.keys(data.result).sort()).toEqual([
    "email",
    "id",
    "name",
    "recoveryScope",
  ]);
  expect(data.result.recoveryScope).toMatch(/^[0-9a-f]{64}$/);
  expect((await request("admin.users")).status).toBe(404);
  expect((await request("body.save", {}, "wrong-token")).status).toBe(401);
});
it("letter reads and message edits remain owner-scoped and revision guarded", async () => {
  const date = "2026-09-07";
  await upsertEmotionDailyLetter({
    userId,
    letterDate: date,
    userMessage: "Mine",
    dailyReference: {},
    analysisSeed: {},
  });
  await upsertEmotionDailyLetter({
    userId: otherId,
    letterDate: date,
    userMessage: "Private",
    dailyReference: {},
    analysisSeed: {},
  });
  const list = await (
    await request("letters.list", { userId: otherId, limit: 90 })
  ).json();
  expect(list.result).toHaveLength(1);
  expect(list.result[0].userMessage).toBe("Mine");
  const edit = await request("letters.rewrite", {
    letterDate: date,
    userMessage: "Updated",
    expectedRevision: 1,
    userId: otherId,
  });
  expect(edit.status).toBe(200);
  expect(
    (
      await request("letters.rewrite", {
        letterDate: date,
        userMessage: "Stale",
        expectedRevision: 1,
      })
    ).status
  ).toBe(409);
  const next = await (await request("letters.list", { limit: 90 })).json();
  expect(next.result[0].userMessage).toBe("Updated");
});
