import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as runtime from "./repositories/runtime";
import { createStory, getStoryById } from "./repositories/stories";
import { storyContextShareRouter } from "./routers/storyContextShare";
import { artworkShareRouter } from "./routers/artworkShare";
import { textDraftsRouter } from "./routers/textDrafts";
import {
  normalizePublishingDraftState,
  emptyPublishingDraftState,
  upsertPublishingPlatformDraft,
} from "../shared/publishingDraft";
import { readTextDraftHistory } from "../shared/textDraftHistory";
const ctx = (id: number | null) =>
  ({
    user: id
      ? { id, name: "朋友", loginMethod: "email", openId: `user-${id}` }
      : null,
    req: {},
    res: { setHeader: vi.fn() },
  }) as unknown as TrpcContext;
const work = {
  platform: "xiaohongshu" as const,
  title: "海边",
  body: "这是分享的作品",
  tags: [],
};
const rewrite = {
  operationToken: randomUUID(),
  content: { title: work.title, body: "朋友建议的新正文", tags: [] },
};
beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  runtime.resetMemoryStateForTesting();
});

for (const kind of ["story", "artwork"] as const)
  describe(`${kind} share permissions`, () => {
    const caller = (id: number | null) =>
      kind === "story"
        ? storyContextShareRouter.createCaller(ctx(id))
        : artworkShareRouter.createCaller(ctx(id));
    async function fixture(permissions = { rewrite: true, fork: true }) {
      const { id } = await createStory({
        userId: 10,
        title: "私有标题",
        body: {
          _revision: 1,
          publishing: upsertPublishingPlatformDraft(
            emptyPublishingDraftState(),
            { platform: work.platform, content: work }
          ),
          messages: [{ role: "user", content: "私人聊天" }],
          cards: [{ title: "私人记忆", content: "不能泄露" }],
        },
      });
      let token: string;
      if (kind === "story") {
        const owner = storyContextShareRouter.createCaller(ctx(10));
        const preview = await owner.preview({ storyId: id, permissions });
        token = (
          await owner.create({
            storyId: id,
            permissions,
            fingerprint: preview.fingerprint,
          })
        ).path.slice(3);
      } else {
        token = randomUUID();
        const buffer = await sharp({
          create: { width: 8, height: 8, channels: 3, background: "white" },
        })
          .png()
          .toBuffer();
        await artworkShareRouter
          .createCaller(ctx(10))
          .create({
            storyId: id,
            token,
            title: work.title,
            permissions,
            work,
            pages: [`data:image/png;base64,${buffer.toString("base64")}`],
          });
      }
      return { id, token };
    }
    it("publishes only the selected work; denies actions without the corresponding grant", async () => {
      const { token } = await fixture({ rewrite: false, fork: false });
      expect(JSON.stringify(await caller(null).read({ token }))).not.toMatch(
        /私人|不能泄露|userId|storyId/
      );
      await expect(caller(20).accept({ token })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller(20).contribute({ token, ...rewrite })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller(null).contribute({ token, ...rewrite })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      const guest =
        kind === "story"
          ? storyContextShareRouter.createCaller({
              ...ctx(20),
              user: { ...ctx(20).user!, loginMethod: "guest" },
            })
          : artworkShareRouter.createCaller({
              ...ctx(20),
              user: { ...ctx(20).user!, loginMethod: "guest" },
            });
      await expect(
        guest.contribute({ token, ...rewrite })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
    it("creates one recipient-owned story, with no author memory or chat, even with concurrent retries", async () => {
      const { token, id } = await fixture({ rewrite: false, fork: true });
      const before = structuredClone(await getStoryById(id, 10));
      const results = await Promise.all(
        Array.from({ length: 5 }, () => caller(20).accept({ token }))
      );
      expect(new Set(results.map(row => row.storyId)).size).toBe(1);
      const created = await getStoryById(results[0].storyId, 20);
      expect(created?.body).toMatchObject({ messages: [], cards: [] });
      expect(JSON.stringify(created)).not.toMatch(/私人|不能泄露/);
      expect(await getStoryById(results[0].storyId, 10)).toBeNull();
      expect(await getStoryById(id, 10)).toEqual(before);
    });
    it("submits one candidate; only the author's explicit adoption changes publishing", async () => {
      const { token, id } = await fixture({ rewrite: true, fork: false });
      const before = (await getStoryById(id, 10))!.body as Record<
        string,
        unknown
      >;
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          caller(20).contribute({ token, ...rewrite })
        )
      );
      expect(results).toEqual(Array(4).fill({ submitted: true }));
      const body = (await getStoryById(id, 10))!.body as Record<
        string,
        unknown
      >;
      expect(body.publishing).toEqual(before.publishing);
      expect(body.cards).toEqual(before.cards);
      expect(body.messages).toEqual(before.messages);
      const history = readTextDraftHistory(body.textDraftHistory);
      expect(history.versions).toHaveLength(1);
      expect(history.versions[0]).toMatchObject({
        contribution: { userId: 20, authorName: "朋友" },
        originalLearningEnabled: false,
        generated: rewrite.content,
      });
      expect(history.versions[0].adoption).toBeUndefined();
      await expect(
        caller(20).contribute({
          token,
          ...rewrite,
          content: { ...rewrite.content, body: "different" },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const adoption = {
        storyId: id,
        versionId: history.versions[0].id,
        expectedRevision: history.revision,
        expectedPublishingRevision: normalizePublishingDraftState(
          body.publishing
        ).revision,
        content: rewrite.content,
        feedback: "",
      };
      await expect(
        textDraftsRouter.createCaller(ctx(20)).adopt(adoption)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        textDraftsRouter
          .createCaller(ctx(10))
          .adopt({ ...adoption, expectedPublishingRevision: 999 })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const adopted = await textDraftsRouter
        .createCaller(ctx(10))
        .adopt(adoption);
      expect(adopted.publishing.drafts.xiaohongshu?.content.body).toBe(
        rewrite.content.body
      );
      expect(adopted.history.versions[0].adoption?.learningEnabled).toBe(false);
    });
    it("revocation denies both actions including retries, but preserves existing copies", async () => {
      const { id, token } = await fixture();
      const copy = await caller(20).accept({ token });
      await caller(20).contribute({ token, ...rewrite });
      await caller(10).revoke({ storyId: id });
      await expect(caller(20).accept({ token })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        caller(20).contribute({ token, ...rewrite })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await getStoryById(copy.storyId, 20)).not.toBeNull();
    });
    it("does not grant new privileges to legacy links", async () => {
    const { token } = await fixture();
    const rows = kind === "story" ? runtime.memoryState.storyContextShares : runtime.memoryState.artworkShares;
    delete rows[0].snapshot.permissions;
    await expect(caller(20).contribute({ token, ...rewrite })).rejects.toMatchObject({ code: "FORBIDDEN" });
    if (kind === "story") expect(await caller(20).accept({ token })).toHaveProperty("storyId");
    else await expect(caller(20).accept({ token })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rolls back a failed candidate write and rejects deleted sources", async () => {
      const { id, token } = await fixture();
      const before = structuredClone(await getStoryById(id, 10));
      vi.spyOn(runtime, "persistMemoryState").mockRejectedValueOnce(
        new Error("disk-full")
      );
      await expect(
        caller(20).contribute({ token, ...rewrite })
      ).rejects.toThrow("disk-full");
      expect(await getStoryById(id, 10)).toEqual(before);
      runtime.memoryState.stories = runtime.memoryState.stories.filter(
        row => row.id !== id
      );
      await expect(
        caller(20).contribute({ token, ...rewrite })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

describe("share preview permissions", () => {
  it("binds grants to the exact preview and defaults to view only", async () => {
    const { id } = await createStory({ userId: 10, title: "作品", body: {} });
    const owner = storyContextShareRouter.createCaller(ctx(10));
    const preview = await owner.preview({ storyId: id, article: work });
    expect(preview.snapshot.permissions).toEqual({ rewrite: false, fork: false });
    await expect(owner.create({ storyId: id, article: work, permissions: { rewrite: true, fork: true }, fingerprint: preview.fingerprint })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
