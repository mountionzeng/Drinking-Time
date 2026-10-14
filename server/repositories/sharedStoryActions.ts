import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  artworkShares,
  stories,
  storyContextShares,
  storyContextShareImports,
  type Story,
  type InsertStory,
} from "../../drizzle/schema";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";
import {
  type SharePermissions,
  type SharedWork,
  VIEW_ONLY,
} from "../../shared/sharePermissions";
import type { StoryContextSnapshot } from "../../shared/storyContextShare";
import type { ArtworkSnapshot } from "../../shared/artworkShare";
import { buildInheritedStoryInput } from "../services/storyContextSnapshot";
import {
  readTextDraftHistory,
  textDraftVersionSchema,
  type TextDraftContent,
} from "../../shared/textDraftHistory";
import { getStoryRevision, prepareStoryBody } from "../services/storySync";

export type ShareKind = "story" | "artwork";
type Share = {
  storyId: number;
  userId: number;
  revokedAt: Date | null;
  snapshot: StoryContextSnapshot | ArtworkSnapshot;
};
const unavailable = () =>
  new TRPCError({ code: "NOT_FOUND", message: "分享已停止或故事不存在" });
const denied = () =>
  new TRPCError({ code: "FORBIDDEN", message: "作者没有开放此权限" });
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function source(share: Share, kind: ShareKind) {
  if (kind === "story") {
    const snapshot = share.snapshot as StoryContextSnapshot;
    return {
      snapshot,
      work: snapshot.article,
      permissions: snapshot.permissions ?? { rewrite: false, fork: true },
    };
  }
  const snapshot = share.snapshot as ArtworkSnapshot;
  return {
    snapshot: null,
    work: snapshot.work,
    permissions: snapshot.permissions ?? VIEW_ONLY,
  };
}
export function workSnapshot(
  work: SharedWork,
  permissions: SharePermissions
): StoryContextSnapshot {
  return {
    version: 1,
    title: work.title,
    article: work,
    permissions,
    logline: "",
    theme: "",
    arc: "",
    summary: "",
    referenceText: "",
    core: null,
    cards: [],
    characters: [],
    intent: null,
    conversation: [],
  };
}

/** Availability, permissions, replay and writes share one lock/transaction. No model calls. */
async function withShare<T>(
  kind: ShareKind,
  tokenHash: string,
  action: (
    share: Share,
    story: Story,
    storage: {
      receipt(userId: number): Promise<number | undefined>;
      create(input: InsertStory, userId: number): Promise<number>;
      save(body: Story["body"]): Promise<void>;
    }
  ) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      const table = kind === "story" ? storyContextShares : artworkShares;
      const [share] = await tx
        .select()
        .from(table)
        .where(eq(table.tokenHash, tokenHash))
        .for("update");
      if (!share || share.revokedAt) throw unavailable();
      const [story] = await tx
        .select()
        .from(stories)
        .where(
          and(eq(stories.id, share.storyId), eq(stories.userId, share.userId))
        )
        .for("update");
      if (!story) throw unavailable();
      return action(share, story, {
        async receipt(userId) {
          const [row] = await tx
            .select()
            .from(storyContextShareImports)
            .where(
              and(
                eq(storyContextShareImports.tokenHash, tokenHash),
                eq(storyContextShareImports.userId, userId)
              )
            );
          return row?.storyId;
        },
        async create(input, userId) {
          const [result] = await tx
            .insert(stories)
            .values({ ...input, userId, projectId: null });
          await tx
            .insert(storyContextShareImports)
            .values({ tokenHash, userId, storyId: result.insertId });
          return result.insertId;
        },
        async save(body) {
          await tx
            .update(stories)
            .set({ body, updatedAt: now() })
            .where(
              and(eq(stories.id, story.id), eq(stories.userId, share.userId))
            );
        },
      });
    });
  return withLocalAggregateMutationLock(async () => {
    const rows =
      kind === "story"
        ? memoryState.storyContextShares
        : memoryState.artworkShares;
    const share = rows.find(
      row => row.tokenHash === tokenHash && !row.revokedAt
    );
    if (!share) throw unavailable();
    const story = memoryState.stories.find(
      row => row.id === share.storyId && row.userId === share.userId
    );
    if (!story) throw unavailable();
    const before = {
      stories: structuredClone(memoryState.stories),
      receipts: structuredClone(memoryState.storyContextShareImports),
    };
    try {
      let changed = false;
      const result = await action(share, story, {
        async receipt(userId) {
          return memoryState.storyContextShareImports.find(
            row => row.tokenHash === tokenHash && row.userId === userId
          )?.storyId;
        },
        async create(input, userId) {
          const id = nextMemoryId("story");
          memoryState.stories.push({
            id,
            userId,
            projectId: null,
            title: input.title,
            logline: input.logline ?? null,
            theme: input.theme ?? null,
            arc: input.arc ?? null,
            summary: input.summary ?? null,
            body: input.body,
            createdAt: now(),
            updatedAt: now(),
          });
          memoryState.storyContextShareImports.push({
            tokenHash,
            userId,
            storyId: id,
          });
          changed = true;
          return id;
        },
        async save(body) {
          story.body = body;
          story.updatedAt = now();
          changed = true;
        },
      });
      if (changed) await persistMemoryState();
      return result;
    } catch (error) {
      memoryState.stories = before.stories;
      memoryState.storyContextShareImports = before.receipts;
      throw error;
    }
  });
}

export function forkSharedStory(
  kind: ShareKind,
  tokenHash: string,
  userId: number
) {
  return withShare(kind, tokenHash, async (share, _story, storage) => {
    const data = source(share, kind);
    if (!data.permissions.fork) throw denied();
    const prior = await storage.receipt(userId);
    if (prior) return prior;
    const snapshot =
      data.snapshot ?? (data.work ? workSnapshot(data.work, VIEW_ONLY) : null);
    if (!snapshot) throw denied();
    return storage.create(buildInheritedStoryInput(snapshot, userId), userId);
  });
}

export function contributeSharedStory(
  kind: ShareKind,
  tokenHash: string,
  input: {
    userId: number;
    authorName: string;
    operationToken: string;
    content: TextDraftContent;
  }
) {
  return withShare(kind, tokenHash, async (share, story, storage) => {
    const data = source(share, kind);
    if (!data.permissions.rewrite || !data.work) throw denied();
    const body = structuredClone((story.body ?? {}) as Record<string, unknown>);
    const history = readTextDraftHistory(body.textDraftHistory);
    const id = `shared-${hash([kind, tokenHash, input.userId, input.operationToken])}`;
    const requestHash = hash(input.content);
    const existing = history.versions.find(row => row.id === id);
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new TRPCError({
          code: "CONFLICT",
          message: "这次提交已完成，请重新打开改写提交新版本",
        });
      return { submitted: true as const };
    }
    if (history.versions.length >= 100)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "作者的候选版本已满，请联系作者整理后再提交",
      });
    const timestamp = Date.now();
    history.versions.push(
      textDraftVersionSchema.parse({
        id,
        requestHash,
        sequence: Math.max(0, ...history.versions.map(row => row.sequence)) + 1,
        status: "ready",
        createdAt: timestamp,
        completedAt: timestamp,
        request: {
          storyId: story.id,
          operationToken: id,
          expectedRevision: history.revision,
          platform: data.work.platform,
          parentId: null,
          basis: data.work,
          messages: [],
          instruction: "朋友协助改写，等待作者确认采用",
          source: "reference",
        },
        contribution: { userId: input.userId, authorName: input.authorName },
        conversationSnapshot: [],
        conversationDelta: [],
        promptVersion: "share-contribution-v1",
        libraryVersion: "none",
        systemPrompt: "",
        modelMessage: "",
        modelLabel: `${input.authorName} · 协助改写`,
        originalLearningEnabled: false,
        generated: input.content,
      })
    );
    history.revision++;
    body.textDraftHistory = history;
    const prepared = prepareStoryBody(
      body,
      getStoryRevision(story.body) + 1,
      body
    );
    if (Buffer.byteLength(JSON.stringify(prepared), "utf8") > 5_000_000)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "故事容量已满，请联系作者",
      });
    await storage.save(prepared);
    // Never return author ids, history, memories or unpublished text to the recipient.
    return { submitted: true as const };
  });
}
