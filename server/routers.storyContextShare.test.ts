import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as runtime from "./repositories/runtime";
import {
  createStory,
  getStoryById,
  updateStoryBodyIfRevision,
} from "./repositories/stories";
import { storyContextShareRouter } from "./routers/storyContextShare";
import {
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
  normalizePublishingDraftState,
} from "../shared/publishingDraft";
import { inheritedStoryReference } from "../shared/storyContextShare";
import { prepareStoryBody } from "./services/storySync";
import { readFile } from "node:fs/promises";

vi.mock("./services/promptLineageStore", () => ({
  loadStoryPromptAggregate: vi.fn(async () => null),
}));

const caller = (userId: number | null) =>
  storyContextShareRouter.createCaller({
    user: userId ? { id: userId } : null,
    res: { setHeader: vi.fn() },
    req: {},
  } as unknown as TrpcContext);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  runtime.resetMemoryStateForTesting();
});

async function fixture() {
  const publishing = upsertPublishingPlatformDraft(
    emptyPublishingDraftState(),
    {
      platform: "xiaohongshu",
      content: {
        title: "海边的朋友",
        body: "甲和乙一起在海边长大。",
        tags: ["成长"],
      },
    }
  );
  const { id } = await createStory({
    userId: 10,
    title: "故事A",
    body: {
      _revision: 1,
      publishing,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "甲喜欢收集贝壳。",
          photoUrl: "private-photo",
        },
      ],
      cards: [],
      shots: [],
      accountSecret: "never-share",
    },
  });
  const preview = await caller(10).preview({
    storyId: id,
    includeConversation: true,
  });
  const created = await caller(10).create({
    storyId: id,
    includeConversation: true,
    fingerprint: preview.fingerprint,
  });
  return { id, token: created.path.slice(3), preview };
}

describe("story context sharing", () => {
  it("allows anonymous preview, but requires login to import and ownership to manage", async () => {
    const { id, token, preview } = await fixture();
    expect((await caller(null).read({ token })).snapshot).toEqual(
      preview.snapshot
    );
    expect(JSON.stringify(await caller(null).read({ token }))).not.toContain(
      "never-share"
    );
    expect(JSON.stringify(await caller(null).read({ token }))).not.toContain(
      "private-photo"
    );
    await expect(caller(null).accept({ token })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const guest = storyContextShareRouter.createCaller({
      user: { id: 99, loginMethod: "guest", openId: "guest:test" },
      res: { setHeader: vi.fn() },
    } as unknown as TrpcContext);
    await expect(guest.accept({ token })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller(20).preview({ storyId: id, includeConversation: false })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(20).revoke({ storyId: id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(runtime.memoryState.stories).toHaveLength(1);
    expect(runtime.memoryState.storyContextShareImports).toHaveLength(0);
    expect((await caller(10).preview({ storyId: id })).activeLinks).toBe(1);
  });

  it("creates independent owned stories and one durable receipt for concurrent retries", async () => {
    const { id, token } = await fixture();
    const before = structuredClone(await getStoryById(id, 10));
    const results = await Promise.all(
      Array.from({ length: 6 }, () => caller(20).accept({ token }))
    );
    expect(new Set(results.map(result => result.storyId)).size).toBe(1);
    const importedId = results[0].storyId;
    expect(importedId).not.toBe(id);
    const imported = (await getStoryById(importedId, 20))!;
    expect(await getStoryById(importedId, 30)).toBeNull();
    expect(imported.projectId).toBeNull();
    expect(imported.body).toMatchObject({
      _revision: 1,
      messages: [],
      cards: [],
      shots: [],
    });
    expect(inheritedStoryReference(imported.body)).toContain("甲喜欢收集贝壳");
    const next = prepareStoryBody(
      {
        shots: [],
        messages: [{ role: "user", content: "我想改成山里的故事" }],
      },
      2,
      imported.body
    );
    await updateStoryBodyIfRevision({
      id: importedId,
      userId: 20,
      expectedRevision: 1,
      body: next,
    });
    expect(await getStoryById(id, 10)).toEqual(before);
    expect(
      inheritedStoryReference((await getStoryById(importedId, 20))?.body)
    ).toContain("甲喜欢收集贝壳");
    expect((await caller(30).accept({ token })).storyId).not.toBe(importedId);
    const disk = JSON.parse(
      await readFile(process.env.LOCAL_PERSIST_PATH!, "utf8")
    );
    expect(disk.storyContextShares).toHaveLength(1);
    expect(disk.storyContextShareImports).toHaveLength(2);
    expect(JSON.stringify(disk.storyContextShares)).not.toContain(token);
    expect(runtime.memoryState.personalMemory.events).toHaveLength(0);
  });

  it("keeps the shared snapshot fixed and revocation leaves existing recipient stories intact", async () => {
    const { id, token } = await fixture();
    const imported = await caller(20).accept({ token });
    await updateStoryBodyIfRevision({
      id,
      userId: 10,
      expectedRevision: 1,
      body: { _revision: 2, messages: [], shots: [] },
    });
    expect((await caller(null).read({ token })).snapshot.article?.body).toBe(
      "甲和乙一起在海边长大。"
    );
    await caller(10).revoke({ storyId: id });
    expect((await caller(10).preview({ storyId: id })).activeLinks).toBe(0);
    await expect(caller(null).read({ token })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller(30).accept({ token })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await getStoryById(imported.storyId, 20)).not.toBeNull();
  });

  it("refuses deleted sources and unknown tokens", async () => {
    const { id, token } = await fixture();
    runtime.memoryState.stories = runtime.memoryState.stories.filter(
      story => story.id !== id
    );
    await expect(caller(null).read({ token })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller(20).accept({ token })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller(null).read({ token: "A".repeat(43) })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rolls back both the story and receipt on failed persistence, allowing a clean retry", async () => {
    const { token } = await fixture();
    const persist = vi
      .spyOn(runtime, "persistMemoryState")
      .mockRejectedValueOnce(new Error("disk-full"));
    await expect(caller(20).accept({ token })).rejects.toThrow("disk-full");
    expect(runtime.memoryState.stories).toHaveLength(1);
    expect(runtime.memoryState.storyContextShareImports).toHaveLength(0);
    persist.mockRestore();
    const result = await caller(20).accept({ token });
    expect(await getStoryById(result.storyId, 20)).not.toBeNull();
    expect(runtime.memoryState.storyContextShareImports).toHaveLength(1);
  });

  it("rolls back a failed revocation and never publishes failed share creation", async () => {
    const { id, token, preview } = await fixture();
    const persist = vi
      .spyOn(runtime, "persistMemoryState")
      .mockRejectedValue(new Error("disk-full"));
    await expect(caller(10).revoke({ storyId: id })).rejects.toThrow(
      "disk-full"
    );
    expect((await caller(null).read({ token })).snapshot).toEqual(
      preview.snapshot
    );
    await expect(
      caller(10).create({
        storyId: id,
        includeConversation: true,
        fingerprint: preview.fingerprint,
      })
    ).rejects.toThrow("disk-full");
    expect(runtime.memoryState.storyContextShares).toHaveLength(1);
    persist.mockRestore();
  });

  it("requires the exact preview and includes visible uncommitted article edits only in the share", async () => {
    const { id } = await fixture();
    const article = {
      platform: "xiaohongshu" as const,
      title: "当前标题",
      body: "编辑器里的最新正文",
      tags: [],
    };
    const preview = await caller(10).preview({
      storyId: id,
      article,
      includeConversation: false,
    });
    await expect(
      caller(10).create({
        storyId: id,
        article: { ...article, body: "different" },
        includeConversation: false,
        fingerprint: preview.fingerprint,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const { path } = await caller(10).create({
      storyId: id,
      article,
      includeConversation: false,
      fingerprint: preview.fingerprint,
    });
    const { snapshot } = await caller(null).read({ token: path.slice(3) });
    expect(snapshot.article).toEqual(article);
    expect(snapshot.conversation).toEqual([]);
    const original = (await getStoryById(id, 10))!;
    expect(
      normalizePublishingDraftState(
        (original.body as Record<string, unknown>).publishing
      ).drafts.xiaohongshu!.content.body
    ).toBe("甲和乙一起在海边长大。");
  });
});
