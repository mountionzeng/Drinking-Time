/** Persistence operations for videos. Local and MySQL behavior share this boundary. */
import { eq, and, desc, isNotNull, ne } from "drizzle-orm";
import {
  stories,
  InsertVideoTake,
  videoTakes,
  VideoTake,
  InsertVideoTakeRange,
  videoTakeRanges,
  VideoTakeRange,
  InsertVideoTimelineSelection,
  videoTimelineSelections,
  VideoTimelineSelection,
} from "../../drizzle/schema";
import {
  applyDefinedValues,
  ensureMemoryLoaded,
  getDb,
  memoryState,
  nextMemoryId,
  now,
  persistMemoryState,
  transientState,
} from "./runtime";
import { resolvePromptCompilationIdForAsset } from "./assetLineage";
import { jsonRecord } from "./storyValues";

// ─── Video Takes（图生视频素材）────────────────────────────────────────

export async function createVideoTake(
  data: Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt">
): Promise<VideoTake> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const promptCompilationId = await resolvePromptCompilationIdForAsset(null, {
      explicitPromptCompilationId: data.promptCompilationId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      modality: "video",
    });
    const current = now();
    const row: VideoTake = {
      id: nextMemoryId("videoTake"),
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      sourceImageId: data.sourceImageId ?? null,
      promptCompilationId,
      status: data.status ?? "submitted",
      taskId: data.taskId ?? null,
      provider: data.provider ?? "302",
      model: data.model,
      prompt: data.prompt,
      subtitle: data.subtitle ?? null,
      durationSec: data.durationSec ?? null,
      aspectRatio: data.aspectRatio ?? "16:9",
      videoKey: data.videoKey ?? null,
      videoUrl: data.videoUrl ?? null,
      errorMessage: data.errorMessage ?? null,
      parameterSnapshot: data.parameterSnapshot ?? null,
      idempotencyKey: data.idempotencyKey ?? null,
      extractionCapability: data.extractionCapability ?? "unavailable",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTakes.push(row);
    await persistMemoryState();
    return row;
  }
  const promptCompilationId = await resolvePromptCompilationIdForAsset(db, {
    explicitPromptCompilationId: data.promptCompilationId,
    storyId: data.storyId,
    userId: data.userId,
    stableShotId: data.stableShotId,
    modality: "video",
  });
  const [result] = await db.insert(videoTakes).values({
    ...data,
    promptCompilationId,
  });
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(eq(videoTakes.id, result.insertId));
  return row;
}

export async function updateVideoTake(
  id: number,
  userId: number,
  data: Partial<Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt">>
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const row = memoryState.videoTakes.find(
      take => take.id === id && take.userId === userId
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
    .update(videoTakes)
    .set(data)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  return row ?? null;
}

export async function updateVideoTakeRangesShotIdentity(input: {
  takeId: number;
  storyId: number;
  userId: number;
  stableShotId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    for (const range of memoryState.videoTakeRanges) {
      if (
        range.takeId === input.takeId &&
        range.storyId === input.storyId &&
        range.userId === input.userId
      ) {
        range.stableShotId = input.stableShotId;
        range.updatedAt = now();
      }
    }
    await persistMemoryState();
    return;
  }
  await db
    .update(videoTakeRanges)
    .set({ stableShotId: input.stableShotId })
    .where(
      and(
        eq(videoTakeRanges.takeId, input.takeId),
        eq(videoTakeRanges.storyId, input.storyId),
        eq(videoTakeRanges.userId, input.userId)
      )
    );
}

export async function getVideoTakeById(
  id: number,
  userId: number
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakes.find(
        take => take.id === id && take.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.id, id), eq(videoTakes.userId, userId)));
  return row ?? null;
}

export async function getStoryVideoTakes(
  storyId: number,
  userId: number
): Promise<VideoTake[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTakes
      .filter(take => take.storyId === storyId && take.userId === userId)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(videoTakes)
    .where(and(eq(videoTakes.storyId, storyId), eq(videoTakes.userId, userId)))
    .orderBy(desc(videoTakes.createdAt));
}

export async function getReusableVideoTakesForStory(
  storyId: number,
  userId: number
): Promise<VideoTake[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTakes
      .filter(
        take =>
          take.userId === userId &&
          take.storyId !== storyId &&
          take.status === "available" &&
          Boolean(take.videoUrl)
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );
  }
  return db
    .select()
    .from(videoTakes)
    .where(
      and(
        eq(videoTakes.userId, userId),
        ne(videoTakes.storyId, storyId),
        eq(videoTakes.status, "available"),
        isNotNull(videoTakes.videoUrl)
      )
    )
    .orderBy(desc(videoTakes.createdAt));
}

export async function findVideoTakeByIdempotencyKey(
  storyId: number,
  userId: number,
  idempotencyKey: string
): Promise<VideoTake | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakes
        .filter(
          take =>
            take.storyId === storyId &&
            take.userId === userId &&
            take.idempotencyKey === idempotencyKey
        )
        .sort((a, b) => b.id - a.id)[0] ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakes)
    .where(
      and(
        eq(videoTakes.storyId, storyId),
        eq(videoTakes.userId, userId),
        eq(videoTakes.idempotencyKey, idempotencyKey)
      )
    )
    .orderBy(desc(videoTakes.id))
    .limit(1);
  return row ?? null;
}

/**
 * 为付费任务预占幂等记录。MySQL 下先锁所属故事行，再查后插；这样即使是
 * 多个服务实例同时确认同一 candidate，也只能有一个调用方拿到 created=true。
 * 该入口只给已经锁定 promptCompilationId 的系统任务使用。
 */
export async function createVideoTakeIdempotently(
  data: Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt"> & {
    idempotencyKey: string;
  }
): Promise<{ take: VideoTake; created: boolean }> {
  const db = await getDb();
  if (!db) {
    const existing = await findVideoTakeByIdempotencyKey(
      data.storyId,
      data.userId,
      data.idempotencyKey
    );
    if (existing) return { take: existing, created: false };
    return { take: await createVideoTake(data), created: true };
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(and(eq(stories.id, data.storyId), eq(stories.userId, data.userId)))
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
    const [existing] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.storyId, data.storyId),
          eq(videoTakes.userId, data.userId),
          eq(videoTakes.idempotencyKey, data.idempotencyKey)
        )
      )
      .orderBy(desc(videoTakes.id))
      .limit(1);
    if (existing) return { take: existing, created: false };

    const [result] = await tx.insert(videoTakes).values({
      ...data,
      promptCompilationId: data.promptCompilationId ?? null,
    });
    const [take] = await tx
      .select()
      .from(videoTakes)
      .where(eq(videoTakes.id, result.insertId))
      .limit(1);
    if (!take) throw new Error("视频任务预占失败");
    return { take, created: true };
  });
}

type EditingTransitionSubmissionSlot = {
  candidateId: string;
  expectedTimelineVersion: number;
  sourceStableShotId: string;
  targetStableShotId: string;
  placementKey?: string;
};

export type EditingTransitionSubmissionClaim =
  | { claimed: true; take: VideoTake }
  | {
      claimed: false;
      take: VideoTake;
      reason: "already_claimed" | "slot_occupied";
      blockingTakeId?: number;
    };

function editingTransitionSubmissionSlot(
  take: VideoTake
): EditingTransitionSubmissionSlot | null {
  const snapshot = jsonRecord(take.parameterSnapshot);
  if (snapshot.kind !== "editing-transition") return null;
  const candidate = jsonRecord(snapshot.candidate);
  const source = jsonRecord(candidate.source);
  const target = jsonRecord(candidate.target);
  const placement = jsonRecord(candidate.placement);
  if (
    typeof candidate.candidateId !== "string" ||
    candidate.storyId !== take.storyId ||
    typeof candidate.expectedTimelineVersion !== "number" ||
    typeof source.stableShotId !== "string" ||
    typeof target.stableShotId !== "string"
  ) {
    return null;
  }
  return {
    candidateId: candidate.candidateId,
    expectedTimelineVersion: candidate.expectedTimelineVersion,
    sourceStableShotId: source.stableShotId,
    targetStableShotId: target.stableShotId,
    ...(placement.kind === "timeline-overlay" &&
    typeof placement.startFrame === "number" &&
    typeof placement.targetEndFrame === "number" &&
    typeof placement.leftImageId === "number" &&
    typeof placement.rightImageId === "number"
      ? {
          placementKey: [
            placement.startFrame,
            placement.targetEndFrame,
            placement.leftImageId,
            placement.rightImageId,
          ].join(":"),
        }
      : {}),
  };
}

function sameEditingTransitionSlot(
  left: EditingTransitionSubmissionSlot,
  right: EditingTransitionSubmissionSlot
): boolean {
  if (left.placementKey || right.placementKey) {
    return Boolean(
      left.placementKey &&
        right.placementKey &&
        left.placementKey === right.placementKey
    );
  }
  return (
    left.expectedTimelineVersion === right.expectedTimelineVersion &&
    left.sourceStableShotId === right.sourceStableShotId &&
    left.targetStableShotId === right.targetStableShotId
  );
}

function hasEditingTransitionSubmissionClaim(take: VideoTake): boolean {
  const state = jsonRecord(take.parameterSnapshot).submissionState;
  return state !== "not_started" && state !== "not_submitted";
}

function claimedEditingTransitionTake(take: VideoTake): VideoTake {
  return {
    ...take,
    status: "submitted",
    errorMessage: null,
    parameterSnapshot: {
      ...jsonRecord(take.parameterSnapshot),
      submissionState: "submitting",
      submissionClaimedAt: new Date().toISOString(),
    },
    updatedAt: now(),
  };
}

async function withMemoryVideoTakeSubmissionClaim<T>(
  operation: () => Promise<T>
): Promise<T> {
  const previous = transientState.memoryVideoTakeSubmissionClaimQueue;
  let release: () => void = () => undefined;
  transientState.memoryVideoTakeSubmissionClaimQueue = new Promise<void>(
    resolve => {
      release = resolve;
    }
  );
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/**
 * 原子取得一次付费提交权。MySQL 通过故事行锁把同故事的所有候选串行化，
 * 因而同 candidate 以及同 timeline/source/target 槽位都只能有一个 claimant。
 * 内存模式用同进程互斥执行相同的 compare-and-set。
 */
export async function claimEditingTransitionSubmission(input: {
  takeId: number;
  storyId: number;
  userId: number;
}): Promise<EditingTransitionSubmissionClaim> {
  const decide = (takes: VideoTake[]) => {
    const take = takes.find(item => item.id === input.takeId);
    if (!take) throw new Error("衔接视频任务不存在或无权操作");
    const slot = editingTransitionSubmissionSlot(take);
    if (!slot) throw new Error("衔接视频任务缺少可验证的候选快照");
    if (hasEditingTransitionSubmissionClaim(take)) {
      return {
        claimed: false as const,
        take,
        reason: "already_claimed" as const,
      };
    }
    const blocker = takes.find(other => {
      if (other.id === take.id || !hasEditingTransitionSubmissionClaim(other)) {
        return false;
      }
      const otherSlot = editingTransitionSubmissionSlot(other);
      return Boolean(otherSlot && sameEditingTransitionSlot(slot, otherSlot));
    });
    if (blocker) {
      return {
        claimed: false as const,
        take,
        reason: "slot_occupied" as const,
        blockingTakeId: blocker.id,
      };
    }
    return { claimed: true as const, take: claimedEditingTransitionTake(take) };
  };

  const db = await getDb();
  if (!db) {
    return withMemoryVideoTakeSubmissionClaim(async () => {
      await ensureMemoryLoaded();
      const storyExists = memoryState.stories.some(
        story => story.id === input.storyId && story.userId === input.userId
      );
      if (!storyExists) throw new Error("故事不存在或无权操作");
      const storyTakes = memoryState.videoTakes.filter(
        take => take.storyId === input.storyId && take.userId === input.userId
      );
      const decision = decide(storyTakes);
      if (!decision.claimed) return decision;
      const index = memoryState.videoTakes.findIndex(
        take => take.id === decision.take.id && take.userId === input.userId
      );
      if (index < 0) throw new Error("衔接视频提交权持久化失败");
      const previous = memoryState.videoTakes[index];
      memoryState.videoTakes[index] = decision.take;
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.videoTakes[index] = previous;
        throw error;
      }
      return decision;
    });
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");

    const storyTakes = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .for("update");
    const decision = decide(storyTakes);
    if (!decision.claimed) return decision;

    await tx
      .update(videoTakes)
      .set({
        status: decision.take.status,
        errorMessage: decision.take.errorMessage,
        parameterSnapshot: decision.take.parameterSnapshot,
      })
      .where(
        and(
          eq(videoTakes.id, decision.take.id),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      );
    const [updated] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.id, decision.take.id),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .limit(1);
    if (
      !updated ||
      jsonRecord(updated.parameterSnapshot).submissionState !== "submitting"
    ) {
      throw new Error("衔接视频提交权持久化失败");
    }
    return { claimed: true, take: updated };
  });
}

export type StartEndShotSubmissionClaim =
  | { claimed: true; take: VideoTake }
  | {
      claimed: false;
      take: VideoTake;
      reason: "already_claimed";
    };

function validateStartEndShotTake(take: VideoTake) {
  const snapshot = jsonRecord(take.parameterSnapshot);
  if (
    snapshot.kind !== "shot-start-end" ||
    snapshot.stableShotId !== take.stableShotId
  ) {
    throw new Error("首尾帧视频任务缺少可验证的镜头快照");
  }
  return snapshot;
}

function claimStartEndShotTake(take: VideoTake): VideoTake {
  const snapshot = validateStartEndShotTake(take);
  const state = snapshot.submissionState;
  if (state !== "not_started" && state !== "not_submitted") return take;
  return {
    ...take,
    status: "submitted",
    errorMessage: null,
    parameterSnapshot: {
      ...snapshot,
      submissionState: "submitting",
      submissionClaimedAt: new Date().toISOString(),
    },
    updatedAt: now(),
  };
}

/** 原子取得单镜头首尾帧付费提交权，避免双击或多实例重复扣费。 */
export async function claimStartEndShotSubmission(input: {
  takeId: number;
  storyId: number;
  userId: number;
}): Promise<StartEndShotSubmissionClaim> {
  const decide = (take: VideoTake) => {
    const claimed = claimStartEndShotTake(take);
    return claimed === take
      ? {
          claimed: false as const,
          take,
          reason: "already_claimed" as const,
        }
      : { claimed: true as const, take: claimed };
  };

  const db = await getDb();
  if (!db) {
    return withMemoryVideoTakeSubmissionClaim(async () => {
      await ensureMemoryLoaded();
      const storyExists = memoryState.stories.some(
        story => story.id === input.storyId && story.userId === input.userId
      );
      if (!storyExists) throw new Error("故事不存在或无权操作");
      const index = memoryState.videoTakes.findIndex(
        take =>
          take.id === input.takeId &&
          take.storyId === input.storyId &&
          take.userId === input.userId
      );
      if (index < 0) throw new Error("首尾帧视频任务不存在或无权操作");
      const decision = decide(memoryState.videoTakes[index]);
      if (!decision.claimed) return decision;
      const previous = memoryState.videoTakes[index];
      memoryState.videoTakes[index] = decision.take;
      try {
        await persistMemoryState();
      } catch (error) {
        memoryState.videoTakes[index] = previous;
        throw error;
      }
      return decision;
    });
  }

  return db.transaction(async tx => {
    const [story] = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(eq(stories.id, input.storyId), eq(stories.userId, input.userId))
      )
      .for("update")
      .limit(1);
    if (!story) throw new Error("故事不存在或无权操作");
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
    if (!take) throw new Error("首尾帧视频任务不存在或无权操作");
    const decision = decide(take);
    if (!decision.claimed) return decision;
    await tx
      .update(videoTakes)
      .set({
        status: decision.take.status,
        errorMessage: decision.take.errorMessage,
        parameterSnapshot: decision.take.parameterSnapshot,
      })
      .where(
        and(
          eq(videoTakes.id, input.takeId),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      );
    const [updated] = await tx
      .select()
      .from(videoTakes)
      .where(
        and(
          eq(videoTakes.id, input.takeId),
          eq(videoTakes.storyId, input.storyId),
          eq(videoTakes.userId, input.userId)
        )
      )
      .limit(1);
    if (
      !updated ||
      jsonRecord(updated.parameterSnapshot).submissionState !== "submitting"
    ) {
      throw new Error("首尾帧视频提交权持久化失败");
    }
    return { claimed: true, take: updated };
  });
}

export async function createVideoTakeRange(
  data: Omit<InsertVideoTakeRange, "id" | "createdAt" | "updatedAt">
): Promise<VideoTakeRange> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const row: VideoTakeRange = {
      id: nextMemoryId("videoTakeRange"),
      takeId: data.takeId,
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      startSec: data.startSec,
      endSec: data.endSec,
      label: data.label ?? null,
      source: data.source ?? "manual",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTakeRanges.push(row);
    await persistMemoryState();
    return row;
  }
  const [result] = await db.insert(videoTakeRanges).values(data);
  const [row] = await db
    .select()
    .from(videoTakeRanges)
    .where(eq(videoTakeRanges.id, result.insertId));
  return row;
}

export async function getStoryVideoTakeRanges(
  storyId: number,
  userId: number
): Promise<VideoTakeRange[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTakeRanges
      .filter(range => range.storyId === storyId && range.userId === userId)
      .sort(
        (left, right) => left.startSec - right.startSec || left.id - right.id
      );
  }
  return db
    .select()
    .from(videoTakeRanges)
    .where(
      and(
        eq(videoTakeRanges.storyId, storyId),
        eq(videoTakeRanges.userId, userId)
      )
    )
    .orderBy(videoTakeRanges.startSec, videoTakeRanges.id);
}

export async function getVideoTakeRangeById(
  id: number,
  userId: number
): Promise<VideoTakeRange | null> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return (
      memoryState.videoTakeRanges.find(
        range => range.id === id && range.userId === userId
      ) ?? null
    );
  }
  const [row] = await db
    .select()
    .from(videoTakeRanges)
    .where(and(eq(videoTakeRanges.id, id), eq(videoTakeRanges.userId, userId)));
  return row ?? null;
}

export async function getStoryVideoTimelineSelections(
  storyId: number,
  userId: number
): Promise<VideoTimelineSelection[]> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    return memoryState.videoTimelineSelections.filter(
      selection => selection.storyId === storyId && selection.userId === userId
    );
  }
  return db
    .select()
    .from(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, storyId),
        eq(videoTimelineSelections.userId, userId)
      )
    );
}

export async function setVideoTimelineSelection(
  data: Omit<InsertVideoTimelineSelection, "id" | "createdAt" | "updatedAt">
): Promise<VideoTimelineSelection> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    const current = now();
    const existing = memoryState.videoTimelineSelections.find(
      selection =>
        selection.storyId === data.storyId &&
        selection.userId === data.userId &&
        selection.stableShotId === data.stableShotId
    );
    if (existing) {
      existing.takeId = data.takeId;
      existing.rangeId = data.rangeId ?? null;
      existing.selectionType = data.selectionType ?? "full_take";
      existing.updatedAt = current;
      await persistMemoryState();
      return existing;
    }
    const row: VideoTimelineSelection = {
      id: nextMemoryId("videoTimelineSelection"),
      storyId: data.storyId,
      userId: data.userId,
      stableShotId: data.stableShotId,
      takeId: data.takeId,
      rangeId: data.rangeId ?? null,
      selectionType: data.selectionType ?? "full_take",
      createdAt: current,
      updatedAt: current,
    };
    memoryState.videoTimelineSelections.push(row);
    await persistMemoryState();
    return row;
  }
  const [existing] = await db
    .select()
    .from(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, data.storyId),
        eq(videoTimelineSelections.userId, data.userId),
        eq(videoTimelineSelections.stableShotId, data.stableShotId)
      )
    )
    .limit(1);
  if (existing) {
    await db
      .update(videoTimelineSelections)
      .set(data)
      .where(eq(videoTimelineSelections.id, existing.id));
    const [updated] = await db
      .select()
      .from(videoTimelineSelections)
      .where(eq(videoTimelineSelections.id, existing.id));
    return updated;
  }
  const [result] = await db.insert(videoTimelineSelections).values(data);
  const [row] = await db
    .select()
    .from(videoTimelineSelections)
    .where(eq(videoTimelineSelections.id, result.insertId));
  return row;
}

export async function clearVideoTimelineSelection(
  storyId: number,
  userId: number,
  stableShotId: string
): Promise<void> {
  const db = await getDb();
  if (!db) {
    await ensureMemoryLoaded();
    memoryState.videoTimelineSelections =
      memoryState.videoTimelineSelections.filter(
        selection =>
          !(
            selection.storyId === storyId &&
            selection.userId === userId &&
            selection.stableShotId === stableShotId
          )
      );
    await persistMemoryState();
    return;
  }
  await db
    .delete(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, storyId),
        eq(videoTimelineSelections.userId, userId),
        eq(videoTimelineSelections.stableShotId, stableShotId)
      )
    );
}
