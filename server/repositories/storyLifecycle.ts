/** Persistence operations for storyLifecycle. Local and MySQL behavior share this boundary. */
import { eq, and, inArray, isNull, or, sql } from "drizzle-orm";
import {
  shots,
  stories,
  storySoundRowOperations,
  generatedImages,
  previewMaskedImageOperations,
  storyAudioAssets,
  storyAudioImportOperations,
  imageSignals,
  videoTakes,
  videoTakeRanges,
  videoTimelineSelections,
  storyTimelines,
  shotDerivationDrafts,
  storyOperations,
  storyPromptStates,
  promptNodes,
  promptRevisions,
  promptNodeBindings,
  promptCompilations,
  promptCompilationHeads,
  storyConversations,
  storyConversationMessages,
  storyMessageReferences,
  storyArtPromptBindings,
  promptOperationReceipts,
} from "../../drizzle/schema";
import {
  LEGACY_GUEST_OPEN_ID,
  ensureLocalPromptLineageLoaded,
  ensureMemoryLoaded,
  getDb,
  memoryState,
  now,
  persistLocalPromptLineageStateToDisk,
  persistMemoryState,
} from "./runtime";
import {
  listStoryAudioStorageKeysForStory,
  removeManagedAudioFiles,
} from "./audioAssets";
import { getUserById, getUserByOpenId } from "./users";
import { getOrCreateUserDefaultProject } from "./projects";

export async function deleteStory(id: number, userId: number): Promise<void> {
  const db = await getDb();
  // Managed audio bytes live on local disk in every mode; capture the storage
  // keys before the rows go so the files can be removed after (best effort —
  // an FK cascade only takes the metadata).
  const audioStorageKeys = await listStoryAudioStorageKeysForStory({
    storyId: id,
    userId,
  });
  if (!db) {
    const idx = memoryState.stories.findIndex(
      s => s.id === id && s.userId === userId
    );
    if (idx >= 0) {
      memoryState.stories.splice(idx, 1);
      memoryState.storyAudioAssets = memoryState.storyAudioAssets.filter(
        asset => !(asset.storyId === id && asset.userId === userId)
      );
      memoryState.storyAudioImportOperations =
        memoryState.storyAudioImportOperations.filter(
          op => !(op.storyId === id && op.userId === userId)
        );
      memoryState.storySoundWorkspaces =
        memoryState.storySoundWorkspaces.filter(
          row => !(row.storyId === id && row.userId === userId)
        );
      memoryState.storySoundPlanVersions =
        memoryState.storySoundPlanVersions.filter(
          row => !(row.storyId === id && row.userId === userId)
        );
      const deletedAt = now();
      memoryState.storySoundRowOperations =
        memoryState.storySoundRowOperations.flatMap(row => {
          if (row.storyId !== id || row.userId !== userId) return [row];
          if (
            row.amountMinorUnits > 0 ||
            [
              "submitting",
              "submission_unknown",
              "provider_succeeded_media_missing",
              "ready",
            ].includes(row.state)
          ) {
            return [
              {
                ...row,
                storyId: null,
                tombstonedAt: deletedAt,
                updatedAt: deletedAt,
              },
            ];
          }
          return [];
        });
      // 级联删除该故事的镜头（评审 P1）：故事是唯一单位，删故事后其镜头按
      // storyId 再也取不到、永不清理，会成孤儿。同删避免悬挂数据。
      memoryState.shots = memoryState.shots.filter(
        s => !(s.storyId === id && s.userId === userId)
      );
      memoryState.generatedImages = memoryState.generatedImages.filter(
        image => !(image.storyId === id && image.userId === userId)
      );
      memoryState.imageSignals = memoryState.imageSignals.filter(
        signal => !(signal.storyId === id && signal.userId === userId)
      );
      memoryState.videoTakes = memoryState.videoTakes.filter(
        take => !(take.storyId === id && take.userId === userId)
      );
      memoryState.videoTakeRanges = memoryState.videoTakeRanges.filter(
        range => !(range.storyId === id && range.userId === userId)
      );
      memoryState.videoTimelineSelections =
        memoryState.videoTimelineSelections.filter(
          selection =>
            !(selection.storyId === id && selection.userId === userId)
        );
      memoryState.storyTimelines = memoryState.storyTimelines.filter(
        timeline => !(timeline.storyId === id && timeline.userId === userId)
      );
      memoryState.shotDerivationDrafts =
        memoryState.shotDerivationDrafts.filter(
          draft => !(draft.storyId === id && draft.userId === userId)
        );
      memoryState.storyOperations = memoryState.storyOperations.filter(
        operation => !(operation.storyId === id && operation.userId === userId)
      );
      await ensureLocalPromptLineageLoaded();
      const promptLineage = memoryState.promptLineage;
      const owned = <T extends { storyId: number; userId: number }>(item: T) =>
        item.storyId === id && item.userId === userId;
      const removedCompilationIds = new Set(
        promptLineage.compilations
          .filter(owned)
          .map(compilation => compilation.id)
      );
      const removedMessageIds = new Set(
        promptLineage.messages.filter(owned).map(message => message.id)
      );
      promptLineage.storyStates = promptLineage.storyStates.filter(
        item => !owned(item)
      );
      promptLineage.nodes = promptLineage.nodes.filter(item => !owned(item));
      promptLineage.revisions = promptLineage.revisions.filter(
        item => !owned(item)
      );
      promptLineage.bindings = promptLineage.bindings.filter(
        item => !owned(item)
      );
      promptLineage.compilations = promptLineage.compilations.filter(
        item => !owned(item)
      );
      promptLineage.compilationInputs = promptLineage.compilationInputs.filter(
        item => !removedCompilationIds.has(item.compilationId)
      );
      promptLineage.compilationHeads = promptLineage.compilationHeads.filter(
        item => !owned(item)
      );
      promptLineage.conversations = promptLineage.conversations.filter(
        item => !owned(item)
      );
      promptLineage.messages = promptLineage.messages.filter(
        item => !owned(item)
      );
      promptLineage.messageReferences = promptLineage.messageReferences.filter(
        item => !owned(item) && !removedMessageIds.has(item.messageId)
      );
      promptLineage.storyArtBindings = promptLineage.storyArtBindings.filter(
        item => !owned(item)
      );
      promptLineage.operationReceipts = promptLineage.operationReceipts.filter(
        item => !owned(item)
      );
      await persistLocalPromptLineageStateToDisk(promptLineage);
      await persistMemoryState();
    }
    await removeManagedAudioFiles(audioStorageKeys);
    return;
  }
  await db
    .delete(storyOperations)
    .where(
      and(eq(storyOperations.storyId, id), eq(storyOperations.userId, userId))
    );
  await db
    .delete(shotDerivationDrafts)
    .where(
      and(
        eq(shotDerivationDrafts.storyId, id),
        eq(shotDerivationDrafts.userId, userId)
      )
    );
  await db
    .delete(storyTimelines)
    .where(
      and(eq(storyTimelines.storyId, id), eq(storyTimelines.userId, userId))
    );
  await db
    .delete(videoTimelineSelections)
    .where(
      and(
        eq(videoTimelineSelections.storyId, id),
        eq(videoTimelineSelections.userId, userId)
      )
    );
  await db
    .delete(videoTakeRanges)
    .where(
      and(eq(videoTakeRanges.storyId, id), eq(videoTakeRanges.userId, userId))
    );
  await db
    .delete(videoTakes)
    .where(and(eq(videoTakes.storyId, id), eq(videoTakes.userId, userId)));
  await db
    .delete(imageSignals)
    .where(and(eq(imageSignals.storyId, id), eq(imageSignals.userId, userId)));
  await db
    .delete(generatedImages)
    .where(
      and(eq(generatedImages.storyId, id), eq(generatedImages.userId, userId))
    );
  await db
    .delete(shots)
    .where(and(eq(shots.storyId, id), eq(shots.userId, userId)));
  await db
    .delete(storyAudioAssets)
    .where(
      and(eq(storyAudioAssets.storyId, id), eq(storyAudioAssets.userId, userId))
    );
  await db
    .delete(storyAudioImportOperations)
    .where(
      and(
        eq(storyAudioImportOperations.storyId, id),
        eq(storyAudioImportOperations.userId, userId)
      )
    );
  await db.transaction(async tx => {
    await tx
      .delete(storySoundRowOperations)
      .where(
        and(
          eq(storySoundRowOperations.storyId, id),
          eq(storySoundRowOperations.userId, userId),
          eq(storySoundRowOperations.amountMinorUnits, 0),
          inArray(storySoundRowOperations.state, ["prepared", "failed"])
        )
      );
    await tx
      .update(storySoundRowOperations)
      .set({ storyId: null, tombstonedAt: now() })
      .where(
        and(
          eq(storySoundRowOperations.storyId, id),
          eq(storySoundRowOperations.userId, userId)
        )
      );
  });
  await db
    .delete(stories)
    .where(and(eq(stories.id, id), eq(stories.userId, userId)));
  await removeManagedAudioFiles(audioStorageKeys);
}

export type LegacyGuestClaimResult = {
  sourceUserId: number | null;
  targetUserId: number;
  targetProjectId: number | null;
  migratedStoryIds: number[];
  migratedStoryCount: number;
  reason: "claimed" | "no_legacy_user" | "same_user" | "no_stories";
};

export async function claimLegacyGuestStories(
  targetUserId: number,
  sourceUserId?: number
): Promise<LegacyGuestClaimResult> {
  const sourceUser =
    sourceUserId == null
      ? await getUserByOpenId(LEGACY_GUEST_OPEN_ID)
      : await getUserById(sourceUserId);
  if (!sourceUser) {
    return {
      sourceUserId: null,
      targetUserId,
      targetProjectId: null,
      migratedStoryIds: [],
      migratedStoryCount: 0,
      reason: "no_legacy_user",
    };
  }
  if (sourceUser.id === targetUserId) {
    return {
      sourceUserId: sourceUser.id,
      targetUserId,
      targetProjectId: null,
      migratedStoryIds: [],
      migratedStoryCount: 0,
      reason: "same_user",
    };
  }

  const targetProject = await getOrCreateUserDefaultProject(targetUserId);
  const db = await getDb();

  if (!db) {
    await ensureMemoryLoaded();
    const sourceStories = memoryState.stories.filter(
      story => story.userId === sourceUser.id
    );
    if (sourceStories.length === 0) {
      return {
        sourceUserId: sourceUser.id,
        targetUserId,
        targetProjectId: targetProject.id,
        migratedStoryIds: [],
        migratedStoryCount: 0,
        reason: "no_stories",
      };
    }

    const storyIds = new Set(sourceStories.map(story => story.id));
    const current = now();

    for (const story of sourceStories) {
      story.userId = targetUserId;
      story.projectId = targetProject.id;
      story.updatedAt = current;
    }
    for (const shot of memoryState.shots) {
      if (shot.userId !== sourceUser.id) continue;
      if (!shot.storyId || !storyIds.has(shot.storyId)) continue;
      shot.userId = targetUserId;
      shot.projectId = targetProject.id;
      shot.updatedAt = current;
    }
    for (const image of memoryState.generatedImages) {
      const belongsToStory =
        image.storyId != null && storyIds.has(image.storyId);
      const belongsToLegacyUser =
        image.userId === sourceUser.id || image.userId == null;
      if (!belongsToStory || !belongsToLegacyUser) continue;
      image.userId = targetUserId;
      image.projectId = targetProject.id;
    }
    for (const signal of memoryState.imageSignals) {
      if (signal.userId !== sourceUser.id) continue;
      if (!storyIds.has(signal.storyId)) continue;
      signal.userId = targetUserId;
    }
    for (const take of memoryState.videoTakes) {
      if (take.userId !== sourceUser.id) continue;
      if (!storyIds.has(take.storyId)) continue;
      take.userId = targetUserId;
      take.updatedAt = current;
    }
    for (const range of memoryState.videoTakeRanges) {
      if (range.userId !== sourceUser.id) continue;
      if (!storyIds.has(range.storyId)) continue;
      range.userId = targetUserId;
      range.updatedAt = current;
    }
    for (const selection of memoryState.videoTimelineSelections) {
      if (selection.userId !== sourceUser.id) continue;
      if (!storyIds.has(selection.storyId)) continue;
      selection.userId = targetUserId;
      selection.updatedAt = current;
    }
    for (const timeline of memoryState.storyTimelines) {
      if (timeline.userId !== sourceUser.id) continue;
      if (!storyIds.has(timeline.storyId)) continue;
      timeline.userId = targetUserId;
      timeline.updatedAt = current;
    }
    for (const draft of memoryState.shotDerivationDrafts) {
      if (draft.userId !== sourceUser.id) continue;
      if (!storyIds.has(draft.storyId)) continue;
      draft.userId = targetUserId;
      draft.updatedAt = current;
    }
    for (const operation of memoryState.storyOperations) {
      if (operation.userId !== sourceUser.id) continue;
      if (!storyIds.has(operation.storyId)) continue;
      operation.userId = targetUserId;
      operation.updatedAt = current;
    }
    for (const operation of memoryState.previewMaskedImageOperations) {
      if (operation.userId !== sourceUser.id) continue;
      if (!storyIds.has(operation.storyId)) continue;
      operation.userId = targetUserId;
      operation.updatedAt = current;
    }

    await ensureLocalPromptLineageLoaded();
    const promptLineage = memoryState.promptLineage;
    const reassignOwnedStoryRows = <
      T extends { storyId: number; userId: number },
    >(
      rows: T[]
    ) => {
      for (const row of rows) {
        if (row.userId !== sourceUser.id) continue;
        if (!storyIds.has(row.storyId)) continue;
        row.userId = targetUserId;
      }
    };
    reassignOwnedStoryRows(promptLineage.storyStates);
    reassignOwnedStoryRows(promptLineage.nodes);
    for (const revision of promptLineage.revisions) {
      if (revision.userId === sourceUser.id && storyIds.has(revision.storyId)) {
        revision.userId = targetUserId;
      }
      if (revision.authorUserId === sourceUser.id) {
        revision.authorUserId = targetUserId;
      }
    }
    reassignOwnedStoryRows(promptLineage.bindings);
    reassignOwnedStoryRows(promptLineage.compilations);
    reassignOwnedStoryRows(promptLineage.compilationHeads);
    reassignOwnedStoryRows(promptLineage.conversations);
    reassignOwnedStoryRows(promptLineage.messages);
    reassignOwnedStoryRows(promptLineage.messageReferences);
    reassignOwnedStoryRows(promptLineage.storyArtBindings);
    reassignOwnedStoryRows(promptLineage.operationReceipts);

    await persistLocalPromptLineageStateToDisk(promptLineage);
    await persistMemoryState();
    return {
      sourceUserId: sourceUser.id,
      targetUserId,
      targetProjectId: targetProject.id,
      migratedStoryIds: Array.from(storyIds),
      migratedStoryCount: storyIds.size,
      reason: "claimed",
    };
  }

  const sourceStories = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.userId, sourceUser.id));
  if (sourceStories.length === 0) {
    return {
      sourceUserId: sourceUser.id,
      targetUserId,
      targetProjectId: targetProject.id,
      migratedStoryIds: [],
      migratedStoryCount: 0,
      reason: "no_stories",
    };
  }

  const storyIds = sourceStories.map(story => story.id);

  await db.transaction(async tx => {
    const storyScope = (
      storyIdColumn: { name: string },
      userIdColumn: { name: string }
    ) =>
      and(
        eq(userIdColumn as any, sourceUser.id),
        inArray(storyIdColumn as any, storyIds)
      );

    await tx
      .update(shots)
      .set({ userId: targetUserId, projectId: targetProject.id })
      .where(storyScope(shots.storyId, shots.userId));
    await tx
      .update(generatedImages)
      .set({ userId: targetUserId, projectId: targetProject.id })
      .where(
        and(
          inArray(generatedImages.storyId, storyIds),
          or(
            eq(generatedImages.userId, sourceUser.id),
            isNull(generatedImages.userId)
          )
        )
      );
    await tx
      .update(previewMaskedImageOperations)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          previewMaskedImageOperations.storyId,
          previewMaskedImageOperations.userId
        )
      );
    await tx
      .update(imageSignals)
      .set({ userId: targetUserId })
      .where(storyScope(imageSignals.storyId, imageSignals.userId));
    await tx
      .update(videoTakes)
      .set({ userId: targetUserId })
      .where(storyScope(videoTakes.storyId, videoTakes.userId));
    await tx
      .update(videoTakeRanges)
      .set({ userId: targetUserId })
      .where(storyScope(videoTakeRanges.storyId, videoTakeRanges.userId));
    await tx
      .update(videoTimelineSelections)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          videoTimelineSelections.storyId,
          videoTimelineSelections.userId
        )
      );
    await tx
      .update(storyTimelines)
      .set({ userId: targetUserId })
      .where(storyScope(storyTimelines.storyId, storyTimelines.userId));
    await tx
      .update(shotDerivationDrafts)
      .set({ userId: targetUserId })
      .where(
        storyScope(shotDerivationDrafts.storyId, shotDerivationDrafts.userId)
      );
    await tx
      .update(storyOperations)
      .set({ userId: targetUserId })
      .where(storyScope(storyOperations.storyId, storyOperations.userId));
    await tx
      .update(storyPromptStates)
      .set({ userId: targetUserId })
      .where(storyScope(storyPromptStates.storyId, storyPromptStates.userId));
    await tx
      .update(promptNodes)
      .set({ userId: targetUserId })
      .where(storyScope(promptNodes.storyId, promptNodes.userId));
    await tx
      .update(promptRevisions)
      .set({
        userId: targetUserId,
        authorUserId: sql`CASE WHEN ${promptRevisions.authorUserId} = ${sourceUser.id} THEN ${targetUserId} ELSE ${promptRevisions.authorUserId} END`,
      })
      .where(storyScope(promptRevisions.storyId, promptRevisions.userId));
    await tx
      .update(promptNodeBindings)
      .set({ userId: targetUserId })
      .where(storyScope(promptNodeBindings.storyId, promptNodeBindings.userId));
    await tx
      .update(promptCompilations)
      .set({ userId: targetUserId })
      .where(storyScope(promptCompilations.storyId, promptCompilations.userId));
    await tx
      .update(promptCompilationHeads)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          promptCompilationHeads.storyId,
          promptCompilationHeads.userId
        )
      );
    await tx
      .update(storyConversations)
      .set({ userId: targetUserId })
      .where(storyScope(storyConversations.storyId, storyConversations.userId));
    await tx
      .update(storyConversationMessages)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          storyConversationMessages.storyId,
          storyConversationMessages.userId
        )
      );
    await tx
      .update(storyMessageReferences)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          storyMessageReferences.storyId,
          storyMessageReferences.userId
        )
      );
    await tx
      .update(storyArtPromptBindings)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          storyArtPromptBindings.storyId,
          storyArtPromptBindings.userId
        )
      );
    await tx
      .update(promptOperationReceipts)
      .set({ userId: targetUserId })
      .where(
        storyScope(
          promptOperationReceipts.storyId,
          promptOperationReceipts.userId
        )
      );
    await tx
      .update(stories)
      .set({ userId: targetUserId, projectId: targetProject.id })
      .where(
        and(eq(stories.userId, sourceUser.id), inArray(stories.id, storyIds))
      );
  });

  return {
    sourceUserId: sourceUser.id,
    targetUserId,
    targetProjectId: targetProject.id,
    migratedStoryIds: storyIds,
    migratedStoryCount: storyIds.length,
    reason: "claimed",
  };
}

export async function claimGuestStories(
  sourceUserId: number,
  targetUserId: number
): Promise<LegacyGuestClaimResult> {
  return claimLegacyGuestStories(targetUserId, sourceUserId);
}
