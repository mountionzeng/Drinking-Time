/** Persistence operations for shotDerivations. Local and MySQL behavior share this boundary. */
import { eq, and, isNull, or, sql } from "drizzle-orm";
import {
  stories,
  generatedImages,
  imageSignals,
  storyTimelines,
  InsertShotDerivationDraft,
  shotDerivationDrafts,
  ShotDerivationDraft,
  InsertStoryOperation,
  storyOperations,
  StoryOperation,
} from "../../drizzle/schema";
import {
  applyDefinedValues,
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
} from "./runtime";
import { revisionOf } from "./storyValues";
import { replaceStoryTimelineItemsPreservingOverlays } from "./timelineCodec";

export async function createShotDerivationDraft(
  data: Omit<InsertShotDerivationDraft, "id" | "createdAt" | "updatedAt">
): Promise<ShotDerivationDraft> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: ShotDerivationDraft = {
      id: nextMemoryId("shotDerivationDraft"),
      storyId: data.storyId,
      userId: data.userId,
      sourceStableShotId: data.sourceStableShotId,
      sourceTakeId: data.sourceTakeId,
      sourceTimeSec: data.sourceTimeSec,
      crop: data.crop,
      fullFrameImageUrl: data.fullFrameImageUrl,
      cropImageUrl: data.cropImageUrl,
      referenceRole: data.referenceRole ?? null,
      analysis: data.analysis ?? null,
      proposal: data.proposal ?? null,
      candidateImageIds: data.candidateImageIds ?? null,
      provisionalStableShotId: data.provisionalStableShotId,
      status: data.status ?? "draft",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.shotDerivationDrafts.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(shotDerivationDrafts).values(data);
  const [row] = await db
    .select()
    .from(shotDerivationDrafts)
    .where(eq(shotDerivationDrafts.id, result.insertId));
  return row;
}

export async function getShotDerivationDraft(
  id: number,
  userId: number
): Promise<ShotDerivationDraft | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.shotDerivationDrafts.find(
        draft => draft.id === id && draft.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(shotDerivationDrafts)
    .where(
      and(
        eq(shotDerivationDrafts.id, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  return row ?? null;
}

export async function updateShotDerivationDraft(
  id: number,
  userId: number,
  data: Partial<InsertShotDerivationDraft>
): Promise<ShotDerivationDraft | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.shotDerivationDrafts.find(
      draft => draft.id === id && draft.userId === userId
    );
    if (!row) return null;
    applyDefinedValues(
      row as unknown as Record<string, unknown>,
      data as unknown as Record<string, unknown>
    );
    row.updatedAt = now();
    await persistMemoryState();
    return row;
  }
  await db
    .update(shotDerivationDrafts)
    .set(data)
    .where(
      and(
        eq(shotDerivationDrafts.id, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  return getShotDerivationDraft(id, userId);
}

export async function createStoryOperation(
  data: Omit<InsertStoryOperation, "id" | "createdAt" | "updatedAt">
): Promise<StoryOperation> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: StoryOperation = {
      id: nextMemoryId("storyOperation"),
      storyId: data.storyId,
      userId: data.userId,
      kind: data.kind,
      status: data.status ?? "applied",
      beforeState: data.beforeState,
      afterStoryRevision: data.afterStoryRevision,
      afterTimelineVersion: data.afterTimelineVersion,
      draftId: data.draftId ?? null,
      createdAt: current,
      updatedAt: current,
    };
    memoryState.storyOperations.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(storyOperations).values(data);
  const [row] = await db
    .select()
    .from(storyOperations)
    .where(eq(storyOperations.id, result.insertId));
  return row;
}

export async function getStoryOperation(
  id: number,
  userId: number
): Promise<StoryOperation | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.storyOperations.find(
        operation => operation.id === id && operation.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(storyOperations)
    .where(and(eq(storyOperations.id, id), eq(storyOperations.userId, userId)));
  return row ?? null;
}

export async function markStoryOperationReverted(
  id: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.storyOperations.find(
      operation => operation.id === id && operation.userId === userId
    );
    if (row) {
      row.status = "reverted";
      row.updatedAt = now();
      await persistMemoryState();
    }
    return;
  }
  await db
    .update(storyOperations)
    .set({ status: "reverted" })
    .where(and(eq(storyOperations.id, id), eq(storyOperations.userId, userId)));
}

export async function confirmDerivedShotAtomic(input: {
  storyId: number;
  userId: number;
  draftId: number;
  selectedImageId: number;
  stableShotId: string;
  shotNo: string;
  expectedStoryRevision: number;
  expectedTimelineVersion: number;
  nextStoryBody: unknown;
  nextTimelineItems: unknown;
}): Promise<{ operation: StoryOperation; timelineVersion: number }> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const story = memoryState.stories.find(
      row => row.id === input.storyId && row.userId === input.userId
    );
    const draft = memoryState.shotDerivationDrafts.find(
      row =>
        row.id === input.draftId &&
        row.storyId === input.storyId &&
        row.userId === input.userId
    );
    const image = memoryState.generatedImages.find(
      row =>
        row.id === input.selectedImageId &&
        row.storyId === input.storyId &&
        (row.userId === input.userId || row.userId == null)
    );
    const timeline = memoryState.storyTimelines.find(
      row => row.storyId === input.storyId && row.userId === input.userId
    );
    if (!story || !draft || !image) throw new Error("派生草稿或候选图不存在");
    if (draft.status === "confirmed") {
      const existingOperation = memoryState.storyOperations.find(
        operation =>
          operation.storyId === input.storyId &&
          operation.userId === input.userId &&
          operation.draftId === input.draftId &&
          operation.kind === "derive_shot" &&
          operation.status === "applied"
      );
      if (existingOperation) {
        return {
          operation: existingOperation,
          timelineVersion: existingOperation.afterTimelineVersion,
        };
      }
    }
    if (draft.status !== "ready" && draft.status !== "draft") {
      throw new Error("派生草稿状态已变化");
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认派生内容");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新确认插入位置");
    }
    const beforeState = {
      storyBody: story.body,
      timelineItems: timeline?.items ?? null,
      timelineVersion: timeline?.version ?? 0,
      image: {
        id: image.id,
        shotNo: image.shotNo,
        shotIdentity: image.shotIdentity,
        isCurrent: image.isCurrent,
      },
      draftStatus: draft.status,
    };
    story.body = input.nextStoryBody;
    story.updatedAt = now();
    for (const candidate of memoryState.generatedImages) {
      if (
        candidate.storyId === input.storyId &&
        candidate.shotIdentity === input.stableShotId
      ) {
        candidate.isCurrent = candidate.id === image.id;
      }
    }
    image.shotNo = input.shotNo;
    image.shotIdentity = input.stableShotId;
    image.isCurrent = true;
    memoryState.imageSignals.push({
      id: nextMemoryId("imageSignal"),
      userId: input.userId,
      storyId: input.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: { source: "derive_shot", draftId: input.draftId },
      createdAt: now(),
    });
    let timelineVersion: number;
    if (timeline) {
      timeline.items = replaceStoryTimelineItemsPreservingOverlays(
        timeline.items,
        input.nextTimelineItems
      );
      timeline.version += 1;
      timeline.updatedAt = now();
      timelineVersion = timeline.version;
    } else {
      const current = now();
      timelineVersion = 1;
      memoryState.storyTimelines.push({
        id: nextMemoryId("storyTimeline"),
        storyId: input.storyId,
        userId: input.userId,
        version: timelineVersion,
        items: input.nextTimelineItems,
        createdAt: current,
        updatedAt: current,
      });
    }
    draft.status = "confirmed";
    draft.updatedAt = now();
    const operation: StoryOperation = {
      id: nextMemoryId("storyOperation"),
      storyId: input.storyId,
      userId: input.userId,
      kind: "derive_shot",
      status: "applied",
      beforeState,
      afterStoryRevision: revisionOf(input.nextStoryBody),
      afterTimelineVersion: timelineVersion,
      draftId: input.draftId,
      createdAt: now(),
      updatedAt: now(),
    };
    memoryState.storyOperations.push(operation);
    await persistMemoryState();
    return { operation, timelineVersion };
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
    const [draft] = await tx
      .select()
      .from(shotDerivationDrafts)
      .where(
        and(
          eq(shotDerivationDrafts.id, input.draftId),
          eq(shotDerivationDrafts.storyId, input.storyId),
          eq(shotDerivationDrafts.userId, input.userId)
        )
      )
      .for("update")
      .limit(1);
    const [image] = await tx
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, input.selectedImageId),
          eq(generatedImages.storyId, input.storyId),
          or(
            eq(generatedImages.userId, input.userId),
            isNull(generatedImages.userId)
          )
        )
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
    if (!story || !draft || !image) throw new Error("派生草稿或候选图不存在");
    if (draft.status === "confirmed") {
      const [existingOperation] = await tx
        .select()
        .from(storyOperations)
        .where(
          and(
            eq(storyOperations.storyId, input.storyId),
            eq(storyOperations.userId, input.userId),
            eq(storyOperations.draftId, input.draftId),
            eq(storyOperations.kind, "derive_shot"),
            eq(storyOperations.status, "applied")
          )
        )
        .limit(1);
      if (existingOperation) {
        return {
          operation: existingOperation,
          timelineVersion: existingOperation.afterTimelineVersion,
        };
      }
    }
    if (draft.status !== "ready" && draft.status !== "draft") {
      throw new Error("派生草稿状态已变化");
    }
    if (revisionOf(story.body) !== input.expectedStoryRevision) {
      throw new Error("故事已经更新，请重新确认派生内容");
    }
    if ((timeline?.version ?? 0) !== input.expectedTimelineVersion) {
      throw new Error("时间轴已经更新，请重新确认插入位置");
    }
    const beforeState = {
      storyBody: story.body,
      timelineItems: timeline?.items ?? null,
      timelineVersion: timeline?.version ?? 0,
      image: {
        id: image.id,
        shotNo: image.shotNo,
        shotIdentity: image.shotIdentity,
        isCurrent: image.isCurrent,
      },
      draftStatus: draft.status,
    };
    await tx
      .update(stories)
      .set({ body: input.nextStoryBody })
      .where(eq(stories.id, story.id));
    await tx
      .update(generatedImages)
      .set({ isCurrent: false })
      .where(
        and(
          eq(generatedImages.storyId, input.storyId),
          eq(generatedImages.shotIdentity, input.stableShotId)
        )
      );
    await tx
      .update(generatedImages)
      .set({
        shotNo: input.shotNo,
        shotIdentity: input.stableShotId,
        isCurrent: true,
      })
      .where(eq(generatedImages.id, image.id));
    await tx.insert(imageSignals).values({
      userId: input.userId,
      storyId: input.storyId,
      imageId: image.id,
      action: "swipe_right",
      metadata: { source: "derive_shot", draftId: input.draftId },
    });
    let timelineVersion: number;
    if (timeline) {
      timelineVersion = timeline.version + 1;
      await tx
        .update(storyTimelines)
        .set({
          items: replaceStoryTimelineItemsPreservingOverlays(
            timeline.items,
            input.nextTimelineItems
          ),
          version: timelineVersion,
        })
        .where(eq(storyTimelines.id, timeline.id));
    } else {
      timelineVersion = 1;
      await tx.insert(storyTimelines).values({
        storyId: input.storyId,
        userId: input.userId,
        version: timelineVersion,
        items: input.nextTimelineItems,
      });
    }
    await tx
      .update(shotDerivationDrafts)
      .set({ status: "confirmed" })
      .where(eq(shotDerivationDrafts.id, draft.id));
    const [result] = await tx.insert(storyOperations).values({
      storyId: input.storyId,
      userId: input.userId,
      kind: "derive_shot",
      status: "applied",
      beforeState,
      afterStoryRevision: revisionOf(input.nextStoryBody),
      afterTimelineVersion: timelineVersion,
      draftId: input.draftId,
    });
    const [operation] = await tx
      .select()
      .from(storyOperations)
      .where(eq(storyOperations.id, result.insertId));
    return { operation, timelineVersion };
  });
}

export async function undoDerivedShotAtomic(
  operationId: number,
  userId: number
): Promise<void> {
  type DerivationBeforeState = {
    storyBody?: unknown;
    timelineItems?: unknown;
    timelineVersion?: number;
    image?: {
      id?: number;
      shotNo?: string | null;
      shotIdentity?: string | null;
      isCurrent?: boolean;
    };
    draftStatus?: ShotDerivationDraft["status"];
  };

  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const operation = memoryState.storyOperations.find(
      row => row.id === operationId && row.userId === userId
    );
    if (!operation || operation.status !== "applied") {
      throw new Error("撤销记录不存在或已经撤销");
    }
    const before = operation.beforeState as DerivationBeforeState;
    const story = memoryState.stories.find(
      row => row.id === operation.storyId && row.userId === userId
    );
    const timeline = memoryState.storyTimelines.find(
      row => row.storyId === operation.storyId && row.userId === userId
    );
    if (
      !story ||
      revisionOf(story.body) !== operation.afterStoryRevision ||
      (timeline?.version ?? 0) !== operation.afterTimelineVersion
    ) {
      throw new Error("派生后已有新的编辑，不能直接撤销");
    }
    const image =
      before.image?.id != null
        ? memoryState.generatedImages.find(
            row =>
              row.id === before.image?.id &&
              row.storyId === operation.storyId &&
              (row.userId === userId || row.userId == null)
          )
        : null;
    const draft =
      operation.draftId != null
        ? memoryState.shotDerivationDrafts.find(
            row =>
              row.id === operation.draftId &&
              row.storyId === operation.storyId &&
              row.userId === userId
          )
        : null;
    const snapshot = {
      storyBody: story.body,
      storyUpdatedAt: story.updatedAt,
      timelineItems: timeline?.items,
      timelineVersion: timeline?.version,
      timelineUpdatedAt: timeline?.updatedAt,
      image: image
        ? {
            shotNo: image.shotNo,
            shotIdentity: image.shotIdentity,
            isCurrent: image.isCurrent,
          }
        : null,
      draftStatus: draft?.status,
      draftUpdatedAt: draft?.updatedAt,
      operationStatus: operation.status,
      operationUpdatedAt: operation.updatedAt,
      imageSignals: [...memoryState.imageSignals],
    };
    try {
      const changedAt = now();
      story.body = before.storyBody;
      story.updatedAt = changedAt;
      if (timeline) {
        timeline.items = replaceStoryTimelineItemsPreservingOverlays(
          timeline.items,
          before.timelineItems ?? []
        );
        timeline.version += 1;
        timeline.updatedAt = changedAt;
      }
      if (image) {
        image.shotNo = before.image?.shotNo ?? null;
        image.shotIdentity = before.image?.shotIdentity ?? null;
        image.isCurrent = before.image?.isCurrent ?? false;
      }
      if (draft) {
        draft.status = "reverted";
        draft.updatedAt = changedAt;
      }
      memoryState.imageSignals = memoryState.imageSignals.filter(signal => {
        if (
          signal.userId !== userId ||
          signal.storyId !== operation.storyId ||
          signal.action !== "swipe_right"
        ) {
          return true;
        }
        const metadata =
          signal.metadata &&
          typeof signal.metadata === "object" &&
          !Array.isArray(signal.metadata)
            ? (signal.metadata as Record<string, unknown>)
            : {};
        return !(
          metadata.source === "derive_shot" &&
          Number(metadata.draftId) === operation.draftId
        );
      });
      operation.status = "reverted";
      operation.updatedAt = changedAt;
      await persistMemoryState();
    } catch (error) {
      story.body = snapshot.storyBody;
      story.updatedAt = snapshot.storyUpdatedAt;
      if (timeline) {
        timeline.items = snapshot.timelineItems;
        timeline.version = snapshot.timelineVersion!;
        timeline.updatedAt = snapshot.timelineUpdatedAt!;
      }
      if (image && snapshot.image) {
        image.shotNo = snapshot.image.shotNo;
        image.shotIdentity = snapshot.image.shotIdentity;
        image.isCurrent = snapshot.image.isCurrent;
      }
      if (draft && snapshot.draftStatus && snapshot.draftUpdatedAt) {
        draft.status = snapshot.draftStatus;
        draft.updatedAt = snapshot.draftUpdatedAt;
      }
      operation.status = snapshot.operationStatus;
      operation.updatedAt = snapshot.operationUpdatedAt;
      memoryState.imageSignals = snapshot.imageSignals;
      throw error;
    }
    return;
  }

  await db.transaction(async tx => {
    const [operation] = await tx
      .select()
      .from(storyOperations)
      .where(
        and(
          eq(storyOperations.id, operationId),
          eq(storyOperations.userId, userId)
        )
      )
      .for("update")
      .limit(1);
    if (!operation || operation.status !== "applied") {
      throw new Error("撤销记录不存在或已经撤销");
    }
    const before = operation.beforeState as DerivationBeforeState;
    const [story] = await tx
      .select()
      .from(stories)
      .where(and(eq(stories.id, operation.storyId), eq(stories.userId, userId)))
      .for("update")
      .limit(1);
    const [timeline] = await tx
      .select()
      .from(storyTimelines)
      .where(
        and(
          eq(storyTimelines.storyId, operation.storyId),
          eq(storyTimelines.userId, userId)
        )
      )
      .for("update")
      .limit(1);
    if (
      !story ||
      revisionOf(story.body) !== operation.afterStoryRevision ||
      (timeline?.version ?? 0) !== operation.afterTimelineVersion
    ) {
      throw new Error("派生后已有新的编辑，不能直接撤销");
    }
    await tx
      .update(stories)
      .set({ body: before.storyBody })
      .where(eq(stories.id, story.id));
    if (timeline) {
      await tx
        .update(storyTimelines)
        .set({
          items: before.timelineItems ?? [],
          version: timeline.version + 1,
        })
        .where(eq(storyTimelines.id, timeline.id));
    }
    if (before.image?.id != null) {
      await tx
        .update(generatedImages)
        .set({
          shotNo: before.image.shotNo ?? null,
          shotIdentity: before.image.shotIdentity ?? null,
          isCurrent: before.image.isCurrent ?? false,
        })
        .where(
          and(
            eq(generatedImages.id, before.image.id),
            eq(generatedImages.storyId, operation.storyId),
            or(
              eq(generatedImages.userId, userId),
              isNull(generatedImages.userId)
            )
          )
        );
    }
    if (operation.draftId != null) {
      await tx
        .update(shotDerivationDrafts)
        .set({ status: "reverted" })
        .where(
          and(
            eq(shotDerivationDrafts.id, operation.draftId),
            eq(shotDerivationDrafts.storyId, operation.storyId),
            eq(shotDerivationDrafts.userId, userId)
          )
        );
      await tx
        .delete(imageSignals)
        .where(
          and(
            eq(imageSignals.storyId, operation.storyId),
            eq(imageSignals.userId, userId),
            eq(imageSignals.action, "swipe_right"),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${imageSignals.metadata}, '$.source')) = 'derive_shot'`,
            sql`CAST(JSON_UNQUOTE(JSON_EXTRACT(${imageSignals.metadata}, '$.draftId')) AS UNSIGNED) = ${operation.draftId}`
          )
        );
    }
    await tx
      .update(storyOperations)
      .set({ status: "reverted" })
      .where(eq(storyOperations.id, operation.id));
  });
}
