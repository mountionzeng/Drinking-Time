/** Persistence operations for timelines. Local and MySQL behavior share this boundary. */
import { eq, and } from "drizzle-orm";
import type { StoryTimelineOverlay } from "../../shared/storyMaterial";
import { mergeStoredStoryTimelineExtensions } from "../persistence/storyTimelinePersistence";
import {
  stories,
  Story,
  StoryBody,
  videoTakes,
  VideoTake,
  storyTimelines,
  StoryTimeline,
} from "../../drizzle/schema";
import {
  MemoryState,
  enqueueLocalPersistenceWrite,
  ensureMemoryLoaded,
  frozenMemoryStateSnapshot,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  persistMemoryStateToDisk,
  withLocalAggregateMutationLock,
  withLocalStoryLock,
  withLocalTimelineLock,
} from "./runtime";
import {
  StoryTimelinePayload,
  decodeStoryTimelinePayload,
  encodeStoryTimelinePayload,
  replaceStoryTimelineItemsPreservingOverlays,
  storyTimelineView,
} from "./timelineCodec";
import {
  jsonRecord,
  persistedStoryBodyRevision,
  revisionOf,
} from "./storyValues";

export async function getStoryTimeline(
  storyId: number,
  userId: number
): Promise<
  (StoryTimeline & { overlays?: unknown; visualLayerState?: unknown }) | null
> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalTimelineLock(storyId, userId, async () => {
      const row =
        memoryState.storyTimelines.find(
          timeline => timeline.storyId === storyId && timeline.userId === userId
        ) ?? null;
      return row ? storyTimelineView(row) : null;
    });
  }
  const [row] = await db
    .select()
    .from(storyTimelines)
    .where(
      and(
        eq(storyTimelines.storyId, storyId),
        eq(storyTimelines.userId, userId)
      )
    )
    .limit(1);
  return row ? storyTimelineView(row) : null;
}

export async function updateStoryTimeline(input: {
  storyId: number;
  userId: number;
  expectedVersion: number;
  items: unknown;
  overlays?: unknown;
  visualLayerState?: unknown;
  /**
   * Non-visual media slices to merge per key (subtitles in U3, audio in U9).
   * A key set here replaces only that slice; every other stored slice is
   * preserved. Visual writers never pass this.
   */
  extensions?: Record<string, unknown>;
}): Promise<
  StoryTimeline & {
    overlays?: unknown;
    visualLayerState?: unknown;
    extensions?: Record<string, unknown>;
  }
> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalTimelineLock(input.storyId, input.userId, async () => {
        const existing = memoryState.storyTimelines.find(
          timeline =>
            timeline.storyId === input.storyId &&
            timeline.userId === input.userId
        );
        if (!existing) {
          if (input.expectedVersion !== 0) throw new Error("时间轴版本已更新");
          const current = now();
          const createdItems = encodeStoryTimelinePayload({
            items: input.items,
            ...(input.overlays === undefined
              ? {}
              : { overlays: input.overlays }),
            ...(input.visualLayerState === undefined
              ? {}
              : { visualLayerState: input.visualLayerState }),
            extensions: mergeStoredStoryTimelineExtensions(
              undefined,
              input.extensions
            ),
          });
          const row: StoryTimeline = {
            id: nextMemoryId("storyTimeline"),
            storyId: input.storyId,
            userId: input.userId,
            version: 1,
            items: createdItems,
            createdAt: current,
            updatedAt: current,
          };
          memoryState.storyTimelines.push(row);
          const rollback = () => {
            const index = memoryState.storyTimelines.indexOf(row);
            if (
              index >= 0 &&
              row.version === 1 &&
              row.items === createdItems &&
              row.updatedAt === memoryState.storyTimelines[index]?.updatedAt
            ) {
              memoryState.storyTimelines.splice(index, 1);
            }
          };
          await persistMemoryState(rollback);
          return storyTimelineView(row);
        }
        if (existing.version !== input.expectedVersion) {
          throw new Error("时间轴版本已更新");
        }
        const currentPayload = decodeStoryTimelinePayload(existing.items);
        const previousItems = existing.items;
        const previousVersion = existing.version;
        const previousUpdatedAt = existing.updatedAt;
        const nextItems = encodeStoryTimelinePayload({
          items: input.items,
          overlays: input.overlays ?? currentPayload.overlays,
          visualLayerState:
            input.visualLayerState ?? currentPayload.visualLayerState,
          extensions: mergeStoredStoryTimelineExtensions(
            existing.items,
            input.extensions
          ),
        });
        const nextVersion = previousVersion + 1;
        const nextUpdatedAt = now();
        existing.items = nextItems;
        existing.version = nextVersion;
        existing.updatedAt = nextUpdatedAt;
        const rollback = () => {
          // A later successful CAS writer may already have advanced this row while
          // our full-state write was in flight. Only roll back the exact values
          // published by this call; never erase a newer in-memory success.
          if (
            existing.items === nextItems &&
            existing.version === nextVersion &&
            existing.updatedAt === nextUpdatedAt
          ) {
            existing.items = previousItems;
            existing.version = previousVersion;
            existing.updatedAt = previousUpdatedAt;
          }
        };
        await persistMemoryState(rollback);
        return storyTimelineView(existing);
      })
    );
  }

  return db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!existing) {
      if (input.expectedVersion !== 0) throw new Error("时间轴版本已更新");
      const [result] = await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        version: 1,
        items: encodeStoryTimelinePayload({
          items: input.items,
          ...(input.overlays === undefined ? {} : { overlays: input.overlays }),
          ...(input.visualLayerState === undefined
            ? {}
            : { visualLayerState: input.visualLayerState }),
          extensions: mergeStoredStoryTimelineExtensions(
            undefined,
            input.extensions
          ),
        }),
      });
      const [created] = await tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, result.insertId));
      return storyTimelineView(created);
    }
    if (existing.version !== input.expectedVersion) {
      throw new Error("时间轴版本已更新");
    }
    const currentPayload = decodeStoryTimelinePayload(existing.items);
    await tx
      .update(storyTimelines)
      .set({
        items: encodeStoryTimelinePayload({
          items: input.items,
          overlays: input.overlays ?? currentPayload.overlays,
          visualLayerState:
            input.visualLayerState ?? currentPayload.visualLayerState,
          extensions: mergeStoredStoryTimelineExtensions(
            existing.items,
            input.extensions
          ),
        }),
        version: existing.version + 1,
      })
      .where(eq(storyTimelines.id, existing.id));
    const [updated] = await tx
      .select()
      .from(storyTimelines)
      .where(eq(storyTimelines.id, existing.id));
    return storyTimelineView(updated);
  });
}

/**
 * Service-only aggregate compare-and-swap for commands that must replace the
 * Story body and the complete Timeline document as one fact. `nextTimeline`
 * is replacement data for the visual fields: an empty overlays array clears
 * overlays, while an omitted overlays/visualLayerState field remains omitted.
 * It never inherits visual fields from the previous document.
 *
 * Non-visual extension slices (subtitles, audio) are the exception: they are
 * preserved from the stored document per key unless `nextTimeline.extensions`
 * explicitly overrides one. A visual-only aggregate command therefore cannot
 * drop a subtitle or audio slice.
 *
 * Local mode takes locks in the fixed Story -> Timeline order and persists an
 * isolated next state before publishing either row to shared memory. SQL mode
 * locks the same rows in the same order inside one transaction.
 */
export async function updateStoryAndTimelineAtomic(input: {
  storyId: number;
  userId: number;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimeline: StoryTimelinePayload;
}): Promise<{
  story: Story;
  timeline: StoryTimeline & {
    overlays?: unknown;
    visualLayerState?: unknown;
    extensions?: Record<string, unknown>;
  };
}> {
  const nextStoryRevision = persistedStoryBodyRevision(input.nextStoryBody);
  if (nextStoryRevision !== input.expectedStoryRevision + 1) {
    throw new Error(
      `Story CAS body revision ${nextStoryRevision} must follow expected revision ${input.expectedStoryRevision}`
    );
  }
  // Extension slices ride on the stored row, so the payload can only be
  // finalized once the current row is under lock. `currentValue` is the
  // stored `items` column of the row being replaced (undefined for insert).
  const buildNextTimelinePayload = (currentValue: unknown) =>
    encodeStoryTimelinePayload({
      items: input.nextTimeline.items,
      ...(input.nextTimeline.overlays === undefined
        ? {}
        : { overlays: input.nextTimeline.overlays }),
      ...(input.nextTimeline.visualLayerState === undefined
        ? {}
        : { visualLayerState: input.nextTimeline.visualLayerState }),
      extensions: mergeStoredStoryTimelineExtensions(
        currentValue,
        input.nextTimeline.extensions
      ),
    });
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(input.storyId, input.userId, () =>
        withLocalTimelineLock(input.storyId, input.userId, async () => {
          const storyIndex = memoryState.stories.findIndex(
            row => row.id === input.storyId && row.userId === input.userId
          );
          if (storyIndex < 0) throw new Error("故事不存在或无权操作");
          const story = memoryState.stories[storyIndex];
          const timelineIndex = memoryState.storyTimelines.findIndex(
            row => row.storyId === input.storyId && row.userId === input.userId
          );
          const timeline = memoryState.storyTimelines[timelineIndex];
          if (
            persistedStoryBodyRevision(story.body) !==
            input.expectedStoryRevision
          ) {
            throw new Error("故事已经更新，请重新加载后再试");
          }
          if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
            throw new Error("时间轴已经更新，请重新加载后再试");
          }

          const current = now();
          const nextStory: Story = {
            ...story,
            body: input.nextStoryBody as StoryBody,
            updatedAt: current,
          };
          const nextIds = { ...memoryState.nextIds };
          const nextTimeline: StoryTimeline = timeline
            ? {
                ...timeline,
                items: buildNextTimelinePayload(timeline.items),
                version: timeline.version + 1,
                updatedAt: current,
              }
            : {
                id: nextIds.storyTimeline++,
                storyId: input.storyId,
                userId: input.userId,
                items: buildNextTimelinePayload(undefined),
                version: 1,
                createdAt: current,
                updatedAt: current,
              };
          // This primitive deliberately bypasses optimistic publication: the
          // durable snapshot is written first, then both live rows become
          // visible together. A failed write therefore requires no rollback.
          const nextState: MemoryState = {
            ...memoryState,
            stories: memoryState.stories.map((row, index) =>
              index === storyIndex ? nextStory : row
            ),
            storyTimelines:
              timelineIndex >= 0
                ? memoryState.storyTimelines.map((row, index) =>
                    index === timelineIndex ? nextTimeline : row
                  )
                : [...memoryState.storyTimelines, nextTimeline],
            nextIds,
          };
          const frozenNextState = frozenMemoryStateSnapshot(nextState);
          await enqueueLocalPersistenceWrite(() =>
            persistMemoryStateToDisk(frozenNextState)
          );
          memoryState.stories[storyIndex] = nextStory;
          if (timelineIndex >= 0) {
            memoryState.storyTimelines[timelineIndex] = nextTimeline;
          } else {
            memoryState.storyTimelines.push(nextTimeline);
            memoryState.nextIds.storyTimeline = nextIds.storyTimeline;
          }
          return {
            story: nextStory,
            timeline: storyTimelineView(nextTimeline),
          };
        })
      )
    );
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    if (
      persistedStoryBodyRevision(story.body) !== input.expectedStoryRevision
    ) {
      throw new Error("故事已经更新，请重新加载后再试");
    }

    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新加载后再试");
    }

    await tx
      .update(stories)
      .set({ body: input.nextStoryBody as StoryBody })
      .where(eq(stories.id, story.id));
    let timelineId: number;
    if (timeline) {
      timelineId = timeline.id;
      await tx
        .update(storyTimelines)
        .set({
          items: buildNextTimelinePayload(timeline.items),
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    } else {
      const [inserted] = await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        items: buildNextTimelinePayload(undefined),
        version: 1,
      });
      timelineId = inserted.insertId;
    }
    const [[updatedStory], [updatedTimeline]] = await Promise.all([
      tx.select().from(stories).where(eq(stories.id, story.id)).limit(1),
      tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, timelineId))
        .limit(1),
    ]);
    return {
      story: updatedStory,
      timeline: storyTimelineView(updatedTimeline),
    };
  });
}

export async function applyStoryTimelineOverlayAtomic(input: {
  storyId: number;
  userId: number;
  takeId: number;
  stableShotId: string;
  expectedStoryRevision: number;
  expectedVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
  nextTimelineOverlays?: unknown;
  nextVisualLayerState?: unknown;
  overlay?: StoryTimelineOverlay;
}): Promise<{
  applied: boolean;
  story: Story;
  timeline: StoryTimeline & { overlays?: unknown };
  take: VideoTake;
}> {
  const snapshotWithApplied = (take: VideoTake) => ({
    ...(take.parameterSnapshot &&
    typeof take.parameterSnapshot === "object" &&
    !Array.isArray(take.parameterSnapshot)
      ? (take.parameterSnapshot as Record<string, unknown>)
      : {}),
    appliedToTimeline: true,
    ...(input.overlay ? { overlayId: input.overlay.id } : {}),
  });
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(input.storyId, input.userId, () =>
        withLocalTimelineLock(input.storyId, input.userId, async () => {
          const storyIndex = memoryState.stories.findIndex(
            row => row.id === input.storyId && row.userId === input.userId
          );
          const timelineIndex = memoryState.storyTimelines.findIndex(
            row => row.storyId === input.storyId && row.userId === input.userId
          );
          const takeIndex = memoryState.videoTakes.findIndex(
            row =>
              row.id === input.takeId &&
              row.storyId === input.storyId &&
              row.userId === input.userId
          );
          if (storyIndex < 0 || timelineIndex < 0 || takeIndex < 0) {
            throw new Error("故事、时间轴或生成视频不存在");
          }
          const story = memoryState.stories[storyIndex];
          const timeline = memoryState.storyTimelines[timelineIndex];
          const take = memoryState.videoTakes[takeIndex];
          const payload = decodeStoryTimelinePayload(timeline.items);
          const overlays = Array.isArray(payload.overlays)
            ? [...payload.overlays]
            : [];
          const overlayExists =
            !input.overlay ||
            overlays.some(
              value =>
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                (value as Record<string, unknown>).id === input.overlay!.id
            );
          const shotExists = storyBodyContainsStableShotId(
            story.body,
            input.stableShotId
          );
          const timelineItemExists = timelineContainsStableShotId(
            payload.items,
            input.stableShotId
          );
          if (
            overlayExists &&
            shotExists &&
            timelineItemExists &&
            jsonRecord(take.parameterSnapshot).appliedToTimeline === true
          ) {
            return {
              applied: false,
              story,
              timeline: storyTimelineView(timeline),
              take,
            };
          }
          if (revisionOf(story.body) !== input.expectedStoryRevision)
            throw new Error("故事已经更新，请重新确认覆盖位置");
          if (timeline.version !== input.expectedVersion)
            throw new Error("时间轴已经更新，请重新确认覆盖位置");
          if (
            !shotExists &&
            !storyBodyContainsStableShotId(
              input.nextStoryBody,
              input.stableShotId
            )
          )
            throw new Error("待写入的故事版缺少生成镜头");
          if (
            !timelineItemExists &&
            !timelineContainsStableShotId(
              input.nextTimelineItems,
              input.stableShotId
            )
          )
            throw new Error("待写入的时间轴缺少生成镜头列");
          const current = now();
          const nextStory = shotExists
            ? story
            : {
                ...story,
                body: input.nextStoryBody as StoryBody,
                updatedAt: current,
              };
          const nextTimeline =
            timelineItemExists && overlayExists
              ? timeline
              : {
                  ...timeline,
                  items: encodeStoryTimelinePayload({
                    items: timelineItemExists
                      ? payload.items
                      : input.nextTimelineItems,
                    overlays:
                      input.nextTimelineOverlays ??
                      (overlayExists
                        ? overlays
                        : [...overlays, input.overlay!]),
                    visualLayerState:
                      input.nextVisualLayerState ?? payload.visualLayerState,
                    extensions: payload.extensions,
                  }),
                  version: timeline.version + 1,
                  updatedAt: current,
                };
          const nextTake = {
            ...take,
            parameterSnapshot: snapshotWithApplied(take),
            errorMessage: null,
            updatedAt: current,
          };
          const nextState: MemoryState = {
            ...memoryState,
            stories: memoryState.stories.map((row, i) =>
              i === storyIndex ? nextStory : row
            ),
            storyTimelines: memoryState.storyTimelines.map((row, i) =>
              i === timelineIndex ? nextTimeline : row
            ),
            videoTakes: memoryState.videoTakes.map((row, i) =>
              i === takeIndex ? nextTake : row
            ),
          };
          const snapshot = frozenMemoryStateSnapshot(nextState);
          await enqueueLocalPersistenceWrite(() =>
            persistMemoryStateToDisk(snapshot)
          );
          memoryState.stories[storyIndex] = nextStory;
          memoryState.storyTimelines[timelineIndex] = nextTimeline;
          memoryState.videoTakes[takeIndex] = nextTake;
          return {
            applied: true,
            story: nextStory,
            timeline: storyTimelineView(nextTimeline),
            take: nextTake,
          };
        })
      )
    );
  }

  return db.transaction(async tx => {
    // All aggregate writers acquire locks in the same deterministic order.
    // Parallel FOR UPDATE queries can reach MySQL in an arbitrary order and
    // deadlock against Story -> Timeline writers.
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    const [take] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.id, input.takeId),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!story || !timeline || !take) {
      throw new Error("故事、时间轴或生成视频不存在");
    }
    const payload = decodeStoryTimelinePayload(timeline.items);
    const overlays = Array.isArray(payload.overlays)
      ? [...payload.overlays]
      : [];
    const overlayExists =
      !input.overlay ||
      overlays.some(
        value =>
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).id === input.overlay!.id
      );
    const shotExists = storyBodyContainsStableShotId(
      story.body,
      input.stableShotId
    );
    const timelineItemExists = timelineContainsStableShotId(
      payload.items,
      input.stableShotId
    );
    if (
      overlayExists &&
      shotExists &&
      timelineItemExists &&
      jsonRecord(take.parameterSnapshot).appliedToTimeline === true
    ) {
      return {
        applied: false,
        story,
        timeline: storyTimelineView(timeline),
        take,
      };
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认覆盖位置");
    }
    if (timeline.version !== input.expectedVersion) {
      throw new Error("时间轴已经更新，请重新确认覆盖位置");
    }
    if (!shotExists) {
      if (
        !storyBodyContainsStableShotId(input.nextStoryBody, input.stableShotId)
      ) {
        throw new Error("待写入的故事版缺少生成镜头");
      }
      await tx
        .update(stories)
        .set({ body: input.nextStoryBody as StoryBody })
        .where(
          and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
        );
    }
    if (!timelineItemExists || !overlayExists) {
      if (
        !timelineItemExists &&
        !timelineContainsStableShotId(
          input.nextTimelineItems,
          input.stableShotId
        )
      ) {
        throw new Error("待写入的时间轴缺少生成镜头列");
      }
      await tx
        .update(storyTimelines)
        .set({
          items: encodeStoryTimelinePayload({
            items: timelineItemExists ? payload.items : input.nextTimelineItems,
            overlays:
              input.nextTimelineOverlays ??
              (overlayExists ? overlays : [...overlays, input.overlay!]),
            visualLayerState:
              input.nextVisualLayerState ?? payload.visualLayerState,
            extensions: payload.extensions,
          }),
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    }
    await tx
      .update(videoTakes)
      .set({ parameterSnapshot: snapshotWithApplied(take), errorMessage: null })
      .where(eq(videoTakes.id, take.id));
    const [[updatedStory], [updatedTimeline], [updatedTake]] =
      await Promise.all([
        tx.select().from(stories).where(eq(stories.id, story.id)).limit(1),
        tx
          .select()
          .from(storyTimelines)
          .where(eq(storyTimelines.id, timeline.id))
          .limit(1),
        tx.select().from(videoTakes).where(eq(videoTakes.id, take.id)).limit(1),
      ]);
    return {
      applied: true,
      story: updatedStory,
      timeline: storyTimelineView(updatedTimeline),
      take: updatedTake,
    };
  });
}

/**
 * Atomically publishes a generated ordinary visual shot and marks its paid
 * Take adopted. It intentionally preserves the complete overlay document and
 * never creates a compatibility overlay.
 */
export function applyGeneratedVisualShotAtomic(input: {
  storyId: number;
  userId: number;
  takeId: number;
  stableShotId: string;
  expectedStoryRevision: number;
  expectedVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
  nextTimelineOverlays?: unknown;
  nextVisualLayerState?: unknown;
}) {
  return applyStoryTimelineOverlayAtomic(input);
}

function storyBodyContainsStableShotId(
  body: unknown,
  stableShotId: string
): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const shots = (body as Record<string, unknown>).shots;
  if (!Array.isArray(shots)) return false;
  return shots.some(shot => {
    if (!shot || typeof shot !== "object" || Array.isArray(shot)) return false;
    const record = shot as Record<string, unknown>;
    return [record.stableShotId, record.shotIdentity, record.shotKey].some(
      value => value === stableShotId
    );
  });
}

function timelineContainsStableShotId(
  items: unknown,
  stableShotId: string
): boolean {
  const timelineItems = decodeStoryTimelinePayload(items).items;
  return (
    Array.isArray(timelineItems) &&
    timelineItems.some(item => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        return false;
      return (item as Record<string, unknown>).stableShotId === stableShotId;
    })
  );
}

/**
 * 聊聊生成的衔接镜头需要同时进入故事体和时间轴。这个写入点只承担两件事：
 * 版本校验与原子落库。视频 Take 在调用前已经完成，重复确认则按 stableShotId
 * 幂等返回，不会再次插入同一镜头。
 */
export async function insertTransitionShotAtomic(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
}): Promise<{
  applied: boolean;
  story: Story;
  timeline: StoryTimeline;
}> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(input.storyId, input.userId, () =>
        withLocalTimelineLock(input.storyId, input.userId, async () => {
          const storyIndex = memoryState.stories.findIndex(
            row => row.id === input.storyId && row.userId === input.userId
          );
          const timelineIndex = memoryState.storyTimelines.findIndex(
            row => row.storyId === input.storyId && row.userId === input.userId
          );
          const story = memoryState.stories[storyIndex];
          const timeline = memoryState.storyTimelines[timelineIndex];
          if (storyIndex < 0) throw new Error("故事不存在或无权操作");
          if (storyBodyContainsStableShotId(story.body, input.stableShotId)) {
            if (!timeline)
              throw new Error("衔接镜头已经存在，但时间轴记录缺失");
            return { applied: false, story, timeline };
          }
          if (revisionOf(story.body) !== input.expectedStoryRevision) {
            throw new Error("故事已经更新，请重新确认衔接位置");
          }
          if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
            throw new Error("时间轴已经更新，请重新确认衔接位置");
          }

          const current = now();
          const nextStory = {
            ...story,
            body: input.nextStoryBody as StoryBody,
            updatedAt: current,
          };
          const nextIds = { ...memoryState.nextIds };
          let savedTimeline: StoryTimeline;
          if (timeline) {
            savedTimeline = {
              ...timeline,
              items: replaceStoryTimelineItemsPreservingOverlays(
                timeline.items,
                input.nextTimelineItems
              ),
              version: timeline.version + 1,
              updatedAt: current,
            };
          } else {
            savedTimeline = {
              id: nextIds.storyTimeline++,
              storyId: input.storyId,
              userId: input.userId,
              version: 1,
              items: input.nextTimelineItems,
              createdAt: current,
              updatedAt: current,
            };
          }
          const nextState: MemoryState = {
            ...memoryState,
            stories: memoryState.stories.map((row, i) =>
              i === storyIndex ? nextStory : row
            ),
            storyTimelines:
              timelineIndex >= 0
                ? memoryState.storyTimelines.map((row, i) =>
                    i === timelineIndex ? savedTimeline : row
                  )
                : [...memoryState.storyTimelines, savedTimeline],
            nextIds,
          };
          await enqueueLocalPersistenceWrite(() =>
            persistMemoryStateToDisk(frozenMemoryStateSnapshot(nextState))
          );
          memoryState.stories[storyIndex] = nextStory;
          if (timelineIndex >= 0)
            memoryState.storyTimelines[timelineIndex] = savedTimeline;
          else {
            memoryState.storyTimelines.push(savedTimeline);
            memoryState.nextIds.storyTimeline = nextIds.storyTimeline;
          }
          return { applied: true, story: nextStory, timeline: savedTimeline };
        })
      )
    );
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    if (storyBodyContainsStableShotId(story.body, input.stableShotId)) {
      if (!timeline) throw new Error("衔接镜头已经存在，但时间轴记录缺失");
      return { applied: false, story, timeline };
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认衔接位置");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新确认衔接位置");
    }

    await tx
      .update(stories)
      .set({ body: input.nextStoryBody as StoryBody })
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      );

    let timelineId: number;
    if (timeline) {
      timelineId = timeline.id;
      await tx
        .update(storyTimelines)
        .set({
          items: replaceStoryTimelineItemsPreservingOverlays(
            timeline.items,
            input.nextTimelineItems
          ),
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    } else {
      const [created] = await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        version: 1,
        items: input.nextTimelineItems,
      });
      timelineId = created.insertId;
    }

    const [[savedStory], [savedTimeline]] = await Promise.all([
      tx.select().from(stories).where(eq(stories.id, input.storyId)).limit(1),
      tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, timelineId))
        .limit(1),
    ]);
    if (!savedStory || !savedTimeline) {
      throw new Error("衔接镜头写入后读取失败");
    }
    return { applied: true, story: savedStory, timeline: savedTimeline };
  });
}

/**
 * Revert a structural split without rewinding either revision counter. The
 * caller supplies the pre-split documents with a fresh story revision; this
 * function owns the cross-document CAS and transaction boundary.
 */
export async function restoreSplitStoryShotAtomic(input: {
  storyId: number;
  userId: number;
  splitStableShotId: string;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
}): Promise<{ story: Story; timeline: StoryTimeline }> {
  const validate = (story: Story, timeline: StoryTimeline | null) => {
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已在切割后继续编辑，无法安全撤销");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已在切割后继续编辑，无法安全撤销");
    }
    if (!storyBodyContainsStableShotId(story.body, input.splitStableShotId)) {
      throw new Error("切割产生的镜头已经不存在，无法撤销");
    }
    if (
      storyBodyContainsStableShotId(
        input.nextStoryBody,
        input.splitStableShotId
      )
    ) {
      throw new Error("撤销快照仍包含切割镜头");
    }
    if (
      !timeline ||
      !timelineContainsStableShotId(timeline.items, input.splitStableShotId)
    ) {
      throw new Error("切割产生的时间轴镜头已经不存在，无法撤销");
    }
    if (
      timelineContainsStableShotId(
        input.nextTimelineItems,
        input.splitStableShotId
      )
    ) {
      throw new Error("撤销时间轴快照仍包含切割镜头");
    }
  };

  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return withLocalAggregateMutationLock(() =>
      withLocalStoryLock(input.storyId, input.userId, () =>
        withLocalTimelineLock(input.storyId, input.userId, async () => {
          const storyIndex = memoryState.stories.findIndex(
            row => row.id === input.storyId && row.userId === input.userId
          );
          const timelineIndex = memoryState.storyTimelines.findIndex(
            row => row.storyId === input.storyId && row.userId === input.userId
          );
          const story = memoryState.stories[storyIndex];
          const timeline =
            timelineIndex >= 0
              ? memoryState.storyTimelines[timelineIndex]
              : null;
          if (storyIndex < 0) throw new Error("故事不存在或无权操作");
          validate(story, timeline);
          const current = now();
          const nextStory = {
            ...story,
            body: input.nextStoryBody as StoryBody,
            updatedAt: current,
          };
          const nextTimeline = {
            ...timeline!,
            items: replaceStoryTimelineItemsPreservingOverlays(
              timeline!.items,
              input.nextTimelineItems
            ),
            version: timeline!.version + 1,
            updatedAt: current,
          };
          const nextState: MemoryState = {
            ...memoryState,
            stories: memoryState.stories.map((row, i) =>
              i === storyIndex ? nextStory : row
            ),
            storyTimelines: memoryState.storyTimelines.map((row, i) =>
              i === timelineIndex ? nextTimeline : row
            ),
          };
          await enqueueLocalPersistenceWrite(() =>
            persistMemoryStateToDisk(frozenMemoryStateSnapshot(nextState))
          );
          memoryState.stories[storyIndex] = nextStory;
          memoryState.storyTimelines[timelineIndex] = nextTimeline;
          return { story: nextStory, timeline: nextTimeline };
        })
      )
    );
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select()
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, input.storyId),
          eq(storyTimelines.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    validate(story, timeline ?? null);
    await tx
      .update(stories)
      .set({ body: input.nextStoryBody as StoryBody })
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      );
    await tx
      .update(storyTimelines)
      .set({
        items: replaceStoryTimelineItemsPreservingOverlays(
          timeline.items,
          input.nextTimelineItems
        ),
        version: timeline.version + 1,
      })
      .where(eq(storyTimelines.id, timeline.id));
    const [[savedStory], [savedTimeline]] = await Promise.all([
      tx.select().from(stories).where(eq(stories.id, input.storyId)).limit(1),
      tx
        .select()
        .from(storyTimelines)
        .where(eq(storyTimelines.id, timeline.id))
        .limit(1),
    ]);
    if (!savedStory || !savedTimeline) throw new Error("切割撤销后读取失败");
    return { story: savedStory, timeline: savedTimeline };
  });
}
