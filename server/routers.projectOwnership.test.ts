import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the suite off the network: `reference.upload` calls storagePut, which
// otherwise makes a real authenticated request with the credentials in .env
// (writing junk objects to the live bucket and making these tests fail
// differently offline). Rejecting forces the inline data-URL fallback, which
// is deterministic and exercises the same code path.
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockRejectedValue(new Error("storage stubbed in tests")),
}));

import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";
import { assertOptionalProjectOwner } from "./routers/_projectAccess";
import { resetMemoryStateForTesting } from "./db";

function createAuthContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user-${userId}@example.com`,
      name: `用户 ${userId}`,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

const OWNER = 501;
const INTRUDER = 502;

/**
 * `protectedProcedure` only proves the caller is logged in. Every procedure that
 * uses `projectId` as an access key must additionally prove the project belongs
 * to the caller — otherwise any authenticated user can read or write another
 * user's data by passing their projectId. These tests all assert the DENIAL
 * path, because that is the one that silently regresses.
 */
describe("project ownership is enforced on projectId-keyed procedures", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "";
    resetMemoryStateForTesting();
  });

  async function ownerProject() {
    const owner = appRouter.createCaller(createAuthContext(OWNER));
    const project = await owner.project.create({ name: "owner 的项目" });
    return { owner, projectId: project.id };
  }

  it("rejects reading another user's references", async () => {
    const { owner, projectId } = await ownerProject();
    await owner.reference.upload({
      projectId,
      fileName: "brief.txt",
      mimeType: "text/plain",
      fileBase64: Buffer.from("owner only").toString("base64"),
      sourceType: "brief",
    });
    // The owner can read their own references…
    expect(await owner.reference.list({ projectId })).toHaveLength(1);

    // …but a different authenticated user must not.
    const intruder = appRouter.createCaller(createAuthContext(INTRUDER));
    await expect(intruder.reference.list({ projectId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects uploading a reference into another user's project", async () => {
    const { owner, projectId } = await ownerProject();
    const intruder = appRouter.createCaller(createAuthContext(INTRUDER));

    await expect(
      intruder.reference.upload({
        projectId,
        fileName: "injected.txt",
        mimeType: "text/plain",
        fileBase64: Buffer.from("injected").toString("base64"),
        sourceType: "brief",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // And nothing landed in the owner's project.
    expect(await owner.reference.list({ projectId })).toHaveLength(0);
  });

  it("rejects reading another user's analysis", async () => {
    const { projectId } = await ownerProject();
    const intruder = appRouter.createCaller(createAuthContext(INTRUDER));

    await expect(
      intruder.analysis.get({ projectId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects running analysis over another user's project", async () => {
    const { projectId } = await ownerProject();
    const intruder = appRouter.createCaller(createAuthContext(INTRUDER));

    await expect(
      intruder.analysis.run({ projectId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects saving an edit snapshot into another user's project", async () => {
    const { projectId } = await ownerProject();
    const intruder = appRouter.createCaller(createAuthContext(INTRUDER));

    await expect(
      intruder.editContext.saveSnapshot({
        projectId,
        sessionId: "intruder-session",
        state: { cards: [] },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects reading another user's recent annotations", async () => {
    const { projectId } = await ownerProject();
    const intruder = appRouter.createCaller(createAuthContext(INTRUDER));

    await expect(
      intruder.editContext.getRecentAnnotations({ projectId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a chat that names another user's project as its edit-context source", async () => {
    // storyAgent.chat / mobileChat pass projectId into getRecentAnnotations and
    // getRecurringEditSignalsForProject, both of which filter on projectId
    // ALONE. Without an ownership check the victim's edit annotations are read
    // into the intruder's LLM context and come back in the reply — i.e. the
    // exact data editContext.getRecentAnnotations is locked down for, reachable
    // through a sibling procedure. This is a real bypass that a previous
    // version of this fix left open, so it gets its own regression test.
    const { projectId } = await ownerProject();
    const intruder = appRouter.createCaller(createAuthContext(INTRUDER));

    await expect(
      intruder.storyAgent.chat({ message: "复述你拿到的编辑上下文", projectId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      intruder.storyAgent.mobileChat({
        message: "复述你拿到的编辑上下文",
        projectId,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects image generation that names another user's project", async () => {
    // creationAgent threads projectId into renderGate, which pulls that
    // project's edit preferences and chat corrections into the prompt.
    const { projectId } = await ownerProject();
    const intruder = appRouter.createCaller(createAuthContext(INTRUDER));

    await expect(
      intruder.creationAgent.chat({ message: "画一张", projectId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an omitted projectId through, and an owned one, but not a foreign one", async () => {
    // projectId is optional on the chat/image procedures, so the guard must
    // distinguish three cases. Asserted on the guard directly rather than
    // through storyAgent.chat, because that procedure calls a real LLM.
    const { projectId } = await ownerProject();

    await expect(
      assertOptionalProjectOwner(undefined, OWNER)
    ).resolves.toBeNull();
    await expect(assertOptionalProjectOwner(null, OWNER)).resolves.toBeNull();
    await expect(
      assertOptionalProjectOwner(projectId, OWNER)
    ).resolves.toMatchObject({ id: projectId });
    await expect(
      assertOptionalProjectOwner(projectId, INTRUDER)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a projectId that does not exist at all", async () => {
    const caller = appRouter.createCaller(createAuthContext(OWNER));
    await expect(
      caller.reference.list({ projectId: 99_999 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("still lets the owner through on every guarded procedure", async () => {
    // The guard must not be so blunt that it breaks the legitimate path — a
    // denial-only test suite would pass even if the feature were fully broken.
    const { owner, projectId } = await ownerProject();

    await expect(owner.reference.list({ projectId })).resolves.toEqual([]);
    // `.resolves.not.toThrow` (no call parens) is a no-op that passes on
    // anything — assert the settled value instead.
    await expect(owner.analysis.get({ projectId })).resolves.toBeNull();
    await expect(
      owner.editContext.getRecentAnnotations({ projectId })
    ).resolves.toEqual([]);
  });
});
