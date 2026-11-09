import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  stories,
  storyChapters,
  storyTimelines,
  type StoryChapter,
} from "../../drizzle/schema";
import {
  readBookWorkflow,
  type BookWorkflowState,
  type ManuscriptContent,
  type ManuscriptKind,
} from "../../shared/bookWorkflow";
import { getStoryRevision } from "../services/storySync";
import {
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  withLocalAggregateMutationLock,
} from "./runtime";

export function manuscriptRows(
  rows: StoryChapter[],
  kind?: ManuscriptKind
): StoryChapter[] {
  const live = rows.filter(row => !row.blocks.manuscriptArchived);
  const legacyKind = live.some(
    row =>
      !row.blocks.manuscriptKind &&
      row.blocks.writingStyle?.some(module => module.format === "shot")
  )
    ? "storyboard"
    : "text";
  const preferred = live.some(
    row => (row.blocks.manuscriptKind ?? legacyKind) === "text"
  )
    ? "text"
    : "storyboard";
  return live.filter(
    row => (row.blocks.manuscriptKind ?? legacyKind) === (kind ?? preferred)
  );
}
export type WorkflowAggregate = {
  state: BookWorkflowState;
  rows: StoryChapter[];
  body: Record<string, unknown>;
};
export type WorkflowChange<T> = (aggregate: WorkflowAggregate) => {
  result: T;
  replace?: { kind: ManuscriptKind; chapters: ManuscriptContent[] };
};

/** Lock the story and chapters together. Source checks and target replacement commit atomically. */
export async function mutateBookWorkflow<T>(
  input: { storyId: number; userId: number; expectedTimelineVersion?: number },
  change: WorkflowChange<T>
): Promise<T> {
  const missing = () =>
    new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  const prepare = (body: unknown, rows: StoryChapter[]) => {
    const record = structuredClone((body ?? {}) as Record<string, unknown>);
    const state = readBookWorkflow(record.bookWorkflow);
    const outcome = change({
      body: record,
      state,
      rows: structuredClone(rows),
    });
    state.revision++;
    const nextBody = {
      ...record,
      bookWorkflow: state,
      _revision: getStoryRevision(record) + 1,
    };
    if (Buffer.byteLength(JSON.stringify(nextBody), "utf8") > 4 * 1024 * 1024)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "作品版本记录已达容量上限，历史和当前稿均保留，请新建作品继续。",
      });
    return { outcome, body: nextBody };
  };
  const db = await getDb();
  if (db)
    return db.transaction(async tx => {
      const [story] = await tx
        .select()
        .from(stories)
        .where(
          and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
        )
        .for("update");
      if (!story) throw missing();
      if (input.expectedTimelineVersion !== undefined) {
        const [timeline] = await tx
          .select()
          .from(storyTimelines)
          .where(
            and(
              eq(storyTimelines.storyId, input.storyId),
              eq(storyTimelines.userId, input.userId)
            )
          )
          .for("update");
        if ((timeline?.version ?? 0) !== input.expectedTimelineVersion)
          throw new TRPCError({
            code: "CONFLICT",
            message: "剪辑已有新修改，请重新核对后保存视频版本。",
          });
      }
      const rows = await tx
        .select()
        .from(storyChapters)
        .where(
          and(
            eq(storyChapters.storyId, input.storyId),
            eq(storyChapters.userId, input.userId)
          )
        )
        .orderBy(asc(storyChapters.position), asc(storyChapters.id))
        .for("update");
      const { outcome, body } = prepare(story.body, rows);
      if (outcome.replace) {
        const { kind, chapters } = outcome.replace;
        const targets = manuscriptRows(rows, kind),
          legacyStoryboard = manuscriptRows(rows, "storyboard");
        for (const row of rows.filter(row => !row.blocks.manuscriptArchived)) {
          const rowKind =
            row.blocks.manuscriptKind ??
            (legacyStoryboard.some(item => item.id === row.id)
              ? "storyboard"
              : "text");
          const position = targets.findIndex(item => item.id === row.id),
            content = position >= 0 ? chapters[position] : undefined;
          if (content)
            await tx
              .update(storyChapters)
              .set({
                ...content,
                position,
                blocks: {
                  ...content.blocks,
                  manuscriptKind: kind,
                  manuscriptArchived: false,
                },
                version: row.version + 1,
              })
              .where(eq(storyChapters.id, row.id));
          else if (!row.blocks.manuscriptKind || rowKind === kind)
            await tx
              .update(storyChapters)
              .set({
                blocks: {
                  ...row.blocks,
                  manuscriptKind: rowKind,
                  ...(rowKind === kind ? { manuscriptArchived: true } : {}),
                },
                version: row.version + 1,
              })
              .where(eq(storyChapters.id, row.id));
        }
        for (const [position, content] of chapters.entries())
          if (position >= targets.length)
            await tx
              .insert(storyChapters)
              .values({
                storyId: input.storyId,
                userId: input.userId,
                ...content,
                position,
                blocks: {
                  ...content.blocks,
                  manuscriptKind: kind,
                  manuscriptArchived: false,
                },
              });
      }
      await tx
        .update(stories)
        .set({ body })
        .where(eq(stories.id, input.storyId));
      return outcome.result;
    });
  return withLocalAggregateMutationLock(async () => {
    const story = memoryState.stories.find(
      row => row.id === input.storyId && row.userId === input.userId
    );
    if (!story) throw missing();
    if (input.expectedTimelineVersion !== undefined) {
      const timeline = memoryState.storyTimelines.find(
        row => row.storyId === input.storyId && row.userId === input.userId
      );
      if ((timeline?.version ?? 0) !== input.expectedTimelineVersion)
        throw new TRPCError({
          code: "CONFLICT",
          message: "剪辑已有新修改，请重新核对后保存视频版本。",
        });
    }
    const rows = memoryState.storyChapters
      .filter(
        row => row.storyId === input.storyId && row.userId === input.userId
      )
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const { outcome, body } = prepare(story.body, rows);
    const oldBody = story.body,
      oldUpdatedAt = story.updatedAt;
    const before = structuredClone(rows);
    try {
      if (outcome.replace) {
        const { kind, chapters } = outcome.replace;
        const targets = manuscriptRows(rows, kind),
          legacyStoryboard = manuscriptRows(rows, "storyboard");
        for (const row of rows.filter(row => !row.blocks.manuscriptArchived)) {
          const rowKind =
            row.blocks.manuscriptKind ??
            (legacyStoryboard.some(item => item.id === row.id)
              ? "storyboard"
              : "text");
          const position = targets.findIndex(item => item.id === row.id),
            content = position >= 0 ? chapters[position] : undefined;
          if (content)
            Object.assign(row, structuredClone(content), {
              position,
              blocks: {
                ...structuredClone(content.blocks),
                manuscriptKind: kind,
                manuscriptArchived: false,
              },
              version: row.version + 1,
              updatedAt: now(),
            });
          else if (!row.blocks.manuscriptKind || rowKind === kind) {
            row.blocks = {
              ...row.blocks,
              manuscriptKind: rowKind,
              ...(rowKind === kind ? { manuscriptArchived: true } : {}),
            };
            row.version++;
            row.updatedAt = now();
          }
        }
        for (const [position, content] of chapters.entries())
          if (position >= targets.length)
            memoryState.storyChapters.push({
              storyId: input.storyId,
              userId: input.userId,
              ...structuredClone(content),
              id: nextMemoryId("storyChapter"),
              position,
              blocks: {
                ...structuredClone(content.blocks),
                manuscriptKind: kind,
                manuscriptArchived: false,
              },
              version: 1,
              createdAt: now(),
              updatedAt: now(),
            });
      }
      story.body = body;
      story.updatedAt = now();
      await persistMemoryState();
    } catch (error) {
      story.body = oldBody;
      story.updatedAt = oldUpdatedAt;
      memoryState.storyChapters = [
        ...memoryState.storyChapters.filter(
          row => row.storyId !== input.storyId || row.userId !== input.userId
        ),
        ...before,
      ];
      throw error;
    }
    return outcome.result;
  });
}
