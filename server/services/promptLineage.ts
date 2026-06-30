import {
  compilePromptTargets,
  type CompiledPromptTarget,
} from "../../shared/promptCompiler";
import type {
  PromptLineageOwner,
  PromptModality,
  PromptRevision,
  PromptRevisionAuthor,
  StoryPromptAggregate,
} from "../../shared/promptLineage";
import {
  PromptLineageValidationError,
  PromptLineageConflictError,
  createPersistentLocalPromptLineageStore,
  loadStoryPromptAggregate,
  type PromptLineageMemoryStore,
} from "./promptLineageStore";
export {
  PromptLineageConflictError,
  PromptLineageValidationError,
} from "./promptLineageStore";
import { and, eq } from "drizzle-orm";
import {
  promptCompilationHeads,
  promptCompilationInputs,
  promptCompilations,
  promptNodes,
  promptOperationReceipts,
  promptRevisions,
  storyPromptStates,
} from "../../drizzle/schema";
import { getDb } from "../db";

type CandidateInput = PromptLineageOwner & {
  nodeId: number;
  content: string;
  weight?: number;
  reason?: string | null;
  authorType: PromptRevisionAuthor;
  expectedVersion: number;
  operationKey: string;
};

type CandidateActionInput = PromptLineageOwner & {
  candidateRevisionId: number;
  expectedVersion: number;
  operationKey: string;
};

type PreviewInput = PromptLineageOwner & {
  candidateRevisionId: number;
};

type RestoreInput = PromptLineageOwner & {
  revisionId: number;
  expectedVersion: number;
  operationKey: string;
};

type PromptTargetRecord = Record<
  Exclude<PromptModality, "shared">,
  CompiledPromptTarget
>;

type GenerationModality = Extract<PromptModality, "image" | "video">;

export type ResolvedGenerationPromptCompilation = {
  mode: "legacy" | "lineage";
  compilationId: number | null;
  finalText: string | null;
};

export type PromptCandidateShotPreview = {
  stableShotId: string;
  current: PromptTargetRecord;
  proposed: PromptTargetRecord;
  impactedModalities: Array<Exclude<PromptModality, "shared">>;
};

export type PromptCandidatePreview = PromptCandidateShotPreview & {
  candidate: PromptRevision;
  shots: PromptCandidateShotPreview[];
};

function findCandidate(
  aggregate: StoryPromptAggregate,
  candidateRevisionId: number,
): PromptRevision {
  const candidate = aggregate.revisions.find(
    revision => revision.id === candidateRevisionId,
  );
  if (!candidate || candidate.status !== "candidate") {
    throw new PromptLineageValidationError(
      `Prompt candidate ${candidateRevisionId} is unavailable`,
    );
  }
  return candidate;
}

function candidateShotIds(
  aggregate: StoryPromptAggregate,
  nodeStableShotId: string | null,
): string[] {
  if (nodeStableShotId) return [nodeStableShotId];
  return Array.from(
    new Set([
      ...aggregate.compilationHeads.map(head => head.stableShotId),
      ...aggregate.nodes
        .map(node => node.stableShotId)
        .filter((value): value is string => Boolean(value)),
    ]),
  ).sort();
}

export function previewPromptCandidate(
  store: PromptLineageMemoryStore,
  input: PreviewInput,
): PromptCandidatePreview {
  const aggregate = store.getStoryAggregate(input);
  return previewPromptCandidateFromAggregate(aggregate, input);
}

export function previewPromptCandidateFromAggregate(
  aggregate: StoryPromptAggregate,
  input: PreviewInput,
): PromptCandidatePreview {
  const candidate = findCandidate(aggregate, input.candidateRevisionId);
  const node = aggregate.nodes.find(item => item.id === candidate.nodeId);
  if (!node) {
    throw new PromptLineageValidationError(
      `Prompt node ${candidate.nodeId} is unavailable`,
    );
  }

  const shots = candidateShotIds(aggregate, node.stableShotId).map(
    stableShotId => {
      const current = compilePromptTargets({
        stableShotId,
        nodes: aggregate.nodes,
        revisions: aggregate.revisions,
        bindings: aggregate.bindings,
      });
      const proposed = compilePromptTargets({
        stableShotId,
        nodes: aggregate.nodes,
        revisions: aggregate.revisions,
        bindings: aggregate.bindings,
        revisionOverrides: { [node.id]: candidate.id },
      });
      const impactedModalities = (
        ["dialogue", "image", "video"] as const
      ).filter(
        modality =>
          current[modality].inputFingerprint !==
          proposed[modality].inputFingerprint,
      );
      return {
        stableShotId,
        current,
        proposed,
        impactedModalities,
      };
    },
  );
  if (shots.length === 0) {
    throw new PromptLineageValidationError(
      "Prompt candidate is not bound to a stable shot",
    );
  }
  return {
    candidate,
    shots,
    ...shots[0],
  };
}

export async function createPromptCandidate(
  store: PromptLineageMemoryStore,
  input: CandidateInput,
): Promise<{ version: number; candidate: PromptRevision }> {
  const aggregate = store.getStoryAggregate(input);
  const node = aggregate.nodes.find(item => item.id === input.nodeId);
  if (!node) {
    throw new PromptLineageValidationError(
      `Prompt node ${input.nodeId} is unavailable`,
    );
  }
  const committed = await store.transact(
    {
      storyId: input.storyId,
      userId: input.userId,
      expectedVersion: input.expectedVersion,
      operationKey: input.operationKey,
    },
    tx =>
      tx.createRevision({
        nodeId: node.id,
        parentRevisionId: node.currentRevisionId,
        content: input.content,
        weight: input.weight,
        reason: input.reason,
        authorType: input.authorType,
        status: "candidate",
      }),
  );
  return { version: committed.version, candidate: committed.result };
}

export async function confirmPromptCandidate(
  store: PromptLineageMemoryStore,
  input: CandidateActionInput,
): Promise<{
  version: number;
  candidate: PromptRevision;
  impactedModalities: Array<Exclude<PromptModality, "shared">>;
}> {
  const preview = previewPromptCandidate(store, input);
  const committed = await store.transact(
    {
      storyId: input.storyId,
      userId: input.userId,
      expectedVersion: input.expectedVersion,
      operationKey: input.operationKey,
    },
    tx => {
      const candidate = tx.confirmRevision(
        preview.candidate.nodeId,
        preview.candidate.id,
      );
      for (const shot of preview.shots) {
        for (const modality of shot.impactedModalities) {
          const compiled = shot.proposed[modality];
          if (!compiled.finalText.trim()) continue;
          tx.createCompilation({
            stableShotId: shot.stableShotId,
            modality,
            finalText: compiled.finalText,
            inputFingerprint: compiled.inputFingerprint,
            revisionIds: compiled.revisionIds,
          });
        }
      }
      return candidate;
    },
  );
  return {
    version: committed.version,
    candidate: committed.result,
    impactedModalities: Array.from(
      new Set(preview.shots.flatMap(shot => shot.impactedModalities)),
    ),
  };
}

export async function rejectPromptCandidate(
  store: PromptLineageMemoryStore,
  input: CandidateActionInput,
): Promise<{ version: number; candidate: PromptRevision }> {
  const aggregate = store.getStoryAggregate(input);
  findCandidate(aggregate, input.candidateRevisionId);
  const committed = await store.transact(
    {
      storyId: input.storyId,
      userId: input.userId,
      expectedVersion: input.expectedVersion,
      operationKey: input.operationKey,
    },
    tx => tx.rejectRevision(input.candidateRevisionId),
  );
  return { version: committed.version, candidate: committed.result };
}

export async function restorePromptRevision(
  store: PromptLineageMemoryStore,
  input: RestoreInput,
): Promise<{ version: number; candidate: PromptRevision }> {
  const aggregate = store.getStoryAggregate(input);
  const historical = aggregate.revisions.find(
    revision => revision.id === input.revisionId,
  );
  if (!historical) {
    throw new PromptLineageValidationError(
      `Prompt revision ${input.revisionId} is unavailable`,
    );
  }
  const node = aggregate.nodes.find(item => item.id === historical.nodeId);
  if (!node || node.currentRevisionId == null) {
    throw new PromptLineageValidationError(
      "Prompt revision cannot be restored without a current parent",
    );
  }
  const committed = await store.transact(
    {
      storyId: input.storyId,
      userId: input.userId,
      expectedVersion: input.expectedVersion,
      operationKey: input.operationKey,
    },
      tx =>
      tx.createRevision({
        nodeId: node.id,
        parentRevisionId: node.currentRevisionId,
        content: historical.content,
        weight: historical.weight,
        authorType: "user",
        reason: `restore revision ${historical.id}`,
        source: "history_restore",
        status: "candidate",
      }),
  );
  return { version: committed.version, candidate: committed.result };
}

export function listPromptRevisionHistory(
  store: PromptLineageMemoryStore,
  input: PromptLineageOwner & {
    nodeId: number;
    cursor?: number;
    limit?: number;
  },
): { items: PromptRevision[]; nextCursor: number | null } {
  const aggregate = store.getStoryAggregate(input);
  if (!aggregate.nodes.some(node => node.id === input.nodeId)) {
    throw new PromptLineageValidationError(
      `Prompt node ${input.nodeId} is unavailable`,
    );
  }
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const items = aggregate.revisions
    .filter(
      revision =>
        revision.nodeId === input.nodeId &&
        (input.cursor == null || revision.id < input.cursor),
    )
    .sort((left, right) => right.id - left.id)
    .slice(0, limit);
  return {
    items,
    nextCursor: items.length === limit ? items[items.length - 1].id : null,
  };
}

function receiptRevisionId(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const revisionId = (value as { revisionId?: unknown }).revisionId;
  return typeof revisionId === "number" ? revisionId : null;
}

async function aggregateAfterMutation(
  owner: PromptLineageOwner,
  revisionId: number,
): Promise<{ aggregate: StoryPromptAggregate; revision: PromptRevision }> {
  const aggregate = await loadStoryPromptAggregate(owner);
  const revision = aggregate?.revisions.find(item => item.id === revisionId);
  if (!aggregate || !revision) {
    throw new PromptLineageValidationError(
      `Prompt revision ${revisionId} was not persisted`,
    );
  }
  return { aggregate, revision };
}

export async function getStoryPromptProjection(
  owner: PromptLineageOwner,
): Promise<StoryPromptAggregate | null> {
  return loadStoryPromptAggregate(owner);
}

export async function resolveGenerationPromptCompilation(input: PromptLineageOwner & {
  stableShotId: string;
  modality: GenerationModality;
  expectedCompilationId?: number | null;
}): Promise<ResolvedGenerationPromptCompilation> {
  const aggregate = await loadStoryPromptAggregate(input);
  if (!aggregate) {
    if (input.expectedCompilationId != null) {
      throw new PromptLineageValidationError("故事提示词尚未迁移，无法校验生成版本");
    }
    return {
      mode: "legacy",
      compilationId: null,
      finalText: null,
    };
  }

  const head = aggregate.compilationHeads.find(
    candidate =>
      candidate.stableShotId === input.stableShotId &&
      candidate.modality === input.modality,
  );
  if (!head) {
    throw new PromptLineageValidationError(
      `当前镜头还没有确认的${input.modality === "image" ? "图片" : "视频"}提示词`,
    );
  }
  if (
    input.expectedCompilationId != null &&
    input.expectedCompilationId !== head.currentCompilationId
  ) {
    throw new PromptLineageValidationError(
      `当前镜头的${input.modality === "image" ? "图片" : "视频"}提示词已经更新，请刷新后重试`,
    );
  }

  const compilation = aggregate.compilations.find(
    candidate => candidate.id === head.currentCompilationId,
  );
  if (!compilation) {
    throw new PromptLineageValidationError(
      `当前镜头的${input.modality === "image" ? "图片" : "视频"}提示词编译记录缺失`,
    );
  }

  return {
    mode: "lineage",
    compilationId: compilation.id,
    finalText: compilation.finalText,
  };
}

export async function createPromptCandidateForStory(
  input: CandidateInput,
): Promise<{ version: number; candidate: PromptRevision }> {
  const db = await getDb();
  if (!db) {
    return createPromptCandidate(
      await createPersistentLocalPromptLineageStore(),
      input,
    );
  }

  const result = await db.transaction(async tx => {
    const [priorReceipt] = await tx
      .select()
      .from(promptOperationReceipts)
      .where(
        and(
          eq(promptOperationReceipts.storyId, input.storyId),
          eq(promptOperationReceipts.userId, input.userId),
          eq(promptOperationReceipts.operationKey, input.operationKey),
        ),
      )
      .limit(1);
    const priorRevisionId = receiptRevisionId(priorReceipt?.result);
    if (priorReceipt && priorRevisionId != null) {
      return {
        version: priorReceipt.committedVersion,
        revisionId: priorRevisionId,
      };
    }

    const [state] = await tx
      .select()
      .from(storyPromptStates)
      .where(
        and(
          eq(storyPromptStates.storyId, input.storyId),
          eq(storyPromptStates.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!state) {
      throw new PromptLineageValidationError("故事提示词尚未迁移");
    }
    if (state.version !== input.expectedVersion) {
      throw new PromptLineageConflictError(
        `Expected prompt lineage version ${input.expectedVersion}, received ${state.version}`,
        state.version,
      );
    }
    const [node] = await tx
      .select()
      .from(promptNodes)
      .where(
        and(
          eq(promptNodes.id, input.nodeId),
          eq(promptNodes.storyId, input.storyId),
          eq(promptNodes.userId, input.userId),
        ),
      )
      .limit(1);
    if (!node) {
      throw new PromptLineageValidationError(
        `Prompt node ${input.nodeId} is unavailable`,
      );
    }
    const [revisionInsert] = await tx.insert(promptRevisions).values({
      storyId: input.storyId,
      userId: input.userId,
      nodeId: node.id,
      parentRevisionId: node.currentRevisionId,
      content: input.content.trim(),
      weight: input.weight,
      authorType: input.authorType,
      authorUserId: input.authorType === "user" ? input.userId : null,
      reason: input.reason?.trim() || null,
      status: "candidate",
    });
    const nextVersion = state.version + 1;
    await tx
      .update(storyPromptStates)
      .set({ version: nextVersion })
      .where(eq(storyPromptStates.id, state.id));
    await tx.insert(promptOperationReceipts).values({
      storyId: input.storyId,
      userId: input.userId,
      operationKey: input.operationKey,
      committedVersion: nextVersion,
      result: { revisionId: revisionInsert.insertId },
    });
    return { version: nextVersion, revisionId: revisionInsert.insertId };
  });
  const { revision } = await aggregateAfterMutation(input, result.revisionId);
  return { version: result.version, candidate: revision };
}

export async function previewPromptCandidateForStory(
  input: PreviewInput,
): Promise<PromptCandidatePreview> {
  const aggregate = await loadStoryPromptAggregate(input);
  if (!aggregate) {
    throw new PromptLineageValidationError("故事提示词尚未迁移");
  }
  return previewPromptCandidateFromAggregate(aggregate, input);
}

export async function confirmPromptCandidateForStory(
  input: CandidateActionInput,
): Promise<{
  version: number;
  candidate: PromptRevision;
  impactedModalities: Array<Exclude<PromptModality, "shared">>;
}> {
  const db = await getDb();
  if (!db) {
    return confirmPromptCandidate(
      await createPersistentLocalPromptLineageStore(),
      input,
    );
  }

  const preview = await previewPromptCandidateForStory(input);
  const result = await db.transaction(async tx => {
    const [priorReceipt] = await tx
      .select()
      .from(promptOperationReceipts)
      .where(
        and(
          eq(promptOperationReceipts.storyId, input.storyId),
          eq(promptOperationReceipts.userId, input.userId),
          eq(promptOperationReceipts.operationKey, input.operationKey),
        ),
      )
      .limit(1);
    const priorRevisionId = receiptRevisionId(priorReceipt?.result);
    if (priorReceipt && priorRevisionId != null) {
      return {
        version: priorReceipt.committedVersion,
        revisionId: priorRevisionId,
      };
    }
    const [state] = await tx
      .select()
      .from(storyPromptStates)
      .where(
        and(
          eq(storyPromptStates.storyId, input.storyId),
          eq(storyPromptStates.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!state) {
      throw new PromptLineageValidationError("故事提示词尚未迁移");
    }
    if (state.version !== input.expectedVersion) {
      throw new PromptLineageConflictError(
        `Expected prompt lineage version ${input.expectedVersion}, received ${state.version}`,
        state.version,
      );
    }
    const [revision] = await tx
      .select()
      .from(promptRevisions)
      .where(
        and(
          eq(promptRevisions.id, input.candidateRevisionId),
          eq(promptRevisions.storyId, input.storyId),
          eq(promptRevisions.userId, input.userId),
          eq(promptRevisions.status, "candidate"),
        ),
      )
      .limit(1);
    if (!revision) {
      throw new PromptLineageValidationError(
        `Prompt candidate ${input.candidateRevisionId} is unavailable`,
      );
    }
    await tx
      .update(promptRevisions)
      .set({ status: "confirmed", decidedAt: new Date() })
      .where(eq(promptRevisions.id, revision.id));
    await tx
      .update(promptNodes)
      .set({ currentRevisionId: revision.id })
      .where(
        and(
          eq(promptNodes.id, revision.nodeId),
          eq(promptNodes.storyId, input.storyId),
          eq(promptNodes.userId, input.userId),
        ),
      );
    for (const shot of preview.shots) {
      for (const modality of shot.impactedModalities) {
        const compiled = shot.proposed[modality];
        if (!compiled.finalText.trim()) continue;
        const [compilationInsert] = await tx.insert(promptCompilations).values({
          storyId: input.storyId,
          userId: input.userId,
          stableShotId: shot.stableShotId,
          modality,
          finalText: compiled.finalText,
          inputFingerprint: compiled.inputFingerprint,
        });
        await tx.insert(promptCompilationInputs).values(
          compiled.revisionIds.map((revisionId, position) => ({
            compilationId: compilationInsert.insertId,
            revisionId,
            position,
          })),
        );
        await tx
          .insert(promptCompilationHeads)
          .values({
            storyId: input.storyId,
            userId: input.userId,
            stableShotId: shot.stableShotId,
            modality,
            currentCompilationId: compilationInsert.insertId,
          })
          .onDuplicateKeyUpdate({
            set: {
              currentCompilationId: compilationInsert.insertId,
              updatedAt: new Date(),
            },
          });
      }
    }
    const nextVersion = state.version + 1;
    await tx
      .update(storyPromptStates)
      .set({ version: nextVersion })
      .where(eq(storyPromptStates.id, state.id));
    await tx.insert(promptOperationReceipts).values({
      storyId: input.storyId,
      userId: input.userId,
      operationKey: input.operationKey,
      committedVersion: nextVersion,
      result: { revisionId: revision.id },
    });
    return { version: nextVersion, revisionId: revision.id };
  });
  const { revision } = await aggregateAfterMutation(input, result.revisionId);
  return {
    version: result.version,
    candidate: revision,
    impactedModalities: Array.from(
      new Set(preview.shots.flatMap(shot => shot.impactedModalities)),
    ),
  };
}

export async function rejectPromptCandidateForStory(
  input: CandidateActionInput,
): Promise<{ version: number; candidate: PromptRevision }> {
  const db = await getDb();
  if (!db) {
    return rejectPromptCandidate(
      await createPersistentLocalPromptLineageStore(),
      input,
    );
  }
  const result = await db.transaction(async tx => {
    const [state] = await tx
      .select()
      .from(storyPromptStates)
      .where(
        and(
          eq(storyPromptStates.storyId, input.storyId),
          eq(storyPromptStates.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!state) {
      throw new PromptLineageValidationError("故事提示词尚未迁移");
    }
    if (state.version !== input.expectedVersion) {
      throw new PromptLineageConflictError(
        `Expected prompt lineage version ${input.expectedVersion}, received ${state.version}`,
        state.version,
      );
    }
    const [revision] = await tx
      .select()
      .from(promptRevisions)
      .where(
        and(
          eq(promptRevisions.id, input.candidateRevisionId),
          eq(promptRevisions.storyId, input.storyId),
          eq(promptRevisions.userId, input.userId),
          eq(promptRevisions.status, "candidate"),
        ),
      )
      .limit(1);
    if (!revision) {
      throw new PromptLineageValidationError(
        `Prompt candidate ${input.candidateRevisionId} is unavailable`,
      );
    }
    await tx
      .update(promptRevisions)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(eq(promptRevisions.id, revision.id));
    const nextVersion = state.version + 1;
    await tx
      .update(storyPromptStates)
      .set({ version: nextVersion })
      .where(eq(storyPromptStates.id, state.id));
    await tx.insert(promptOperationReceipts).values({
      storyId: input.storyId,
      userId: input.userId,
      operationKey: input.operationKey,
      committedVersion: nextVersion,
      result: { revisionId: revision.id },
    });
    return { version: nextVersion, revisionId: revision.id };
  });
  const { revision } = await aggregateAfterMutation(input, result.revisionId);
  return { version: result.version, candidate: revision };
}

export async function restorePromptRevisionForStory(
  input: RestoreInput,
): Promise<{
  version: number;
  candidate: PromptRevision;
  impactedModalities: Array<Exclude<PromptModality, "shared">>;
}> {
  const db = await getDb();
  let restored: { version: number; candidate: PromptRevision };
  if (!db) {
    restored = await restorePromptRevision(
      await createPersistentLocalPromptLineageStore(),
      input,
    );
  } else {
    const aggregate = await loadStoryPromptAggregate(input);
    const historical = aggregate?.revisions.find(
      revision => revision.id === input.revisionId,
    );
    const node = historical
      ? aggregate?.nodes.find(item => item.id === historical.nodeId)
      : null;
    if (!historical || !node || node.currentRevisionId == null) {
      throw new PromptLineageValidationError(
        `Prompt revision ${input.revisionId} is unavailable`,
      );
    }
    restored = await createPromptCandidateForStory({
      storyId: input.storyId,
      userId: input.userId,
      nodeId: node.id,
      content: historical.content,
      weight: historical.weight,
      reason: `restore revision ${historical.id}`,
      authorType: "user",
      expectedVersion: input.expectedVersion,
      operationKey: input.operationKey,
    });
  }

  return confirmPromptCandidateForStory({
    storyId: input.storyId,
    userId: input.userId,
    candidateRevisionId: restored.candidate.id,
    expectedVersion: restored.version,
    operationKey: `${input.operationKey}:confirm`,
  });
}
