import { createHash } from "node:crypto";
import {
  canonicalStorySoundPlanContent,
  normalizeStorySoundPlanDraft,
  restoreStorySoundPlanVersion,
  type StorySoundPlanDraft,
  type StorySoundPlanVersion,
  type StorySoundPlanWorkspace,
} from "../../shared/storySoundPlan";
import {
  compareAndSaveStorySoundWorkspaceRecord,
  getOrCreateStorySoundPlanVersionRecord,
  getOrCreateStorySoundRowOperationRecord,
  getStorySoundPlanVersionRecord,
  getStorySoundWorkspaceRecord,
  listStorySoundPlanVersionRecords,
  listStorySoundRowOperationRecords,
} from "../db";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const workspaceFromRecord = (
  row: Awaited<ReturnType<typeof getStorySoundWorkspaceRecord>>
): StorySoundPlanWorkspace | null => {
  if (!row) return null;
  const draft = normalizeStorySoundPlanDraft(row.draft);
  return {
    ...draft,
    storyId: row.storyId,
    userId: row.userId,
    revision: row.revision,
    interviewStatus: row.interviewStatus,
    ...(row.currentStepId ? { currentStepId: row.currentStepId } : {}),
    ...(row.restoredFromVersionId
      ? { restoredFromVersionId: row.restoredFromVersionId }
      : {}),
    ...(row.interviewState == null
      ? {}
      : { interviewState: row.interviewState }),
    selectionByRowId: (row.selectionByRowId ?? {}) as Record<string, boolean>,
  };
};
const versionFromRecord = (
  row: NonNullable<Awaited<ReturnType<typeof getStorySoundPlanVersionRecord>>>
): StorySoundPlanVersion => ({
  ...normalizeStorySoundPlanDraft(row.draft),
  id: row.publicId,
  storyId: row.storyId,
  userId: row.userId,
  versionNumber: row.versionNumber,
  contentDigest: row.contentDigest,
  evidenceSnapshotDigest: row.evidenceSnapshotDigest,
  sourceRevisions: (row.sourceRevisions ?? {}) as Record<string, string>,
  createdAt: row.createdAt.toISOString(),
});

export async function loadStorySoundWorkspace(scope: {
  storyId: number;
  userId: number;
}) {
  return workspaceFromRecord(
    await getStorySoundWorkspaceRecord(scope.storyId, scope.userId)
  );
}

export async function saveStorySoundWorkspace(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  draft: StorySoundPlanDraft;
  interviewStatus: StorySoundPlanWorkspace["interviewStatus"];
  currentStepId?: string;
  restoredFromVersionId?: string;
  interviewState?: unknown;
  selectionByRowId: Record<string, boolean>;
}): Promise<
  | { status: "ok"; workspace: StorySoundPlanWorkspace }
  | { status: "conflict"; revision: number }
> {
  const normalized = normalizeStorySoundPlanDraft(input.draft);
  const row = await compareAndSaveStorySoundWorkspaceRecord({
    storyId: input.storyId,
    userId: input.userId,
    expectedRevision: input.expectedRevision,
    interviewStatus: input.interviewStatus,
    currentStepId: input.currentStepId ?? null,
    restoredFromVersionId: input.restoredFromVersionId ?? null,
    interviewState: input.interviewState ?? null,
    draft: normalized,
    selectionByRowId: input.selectionByRowId,
  });
  if (row) return { status: "ok", workspace: workspaceFromRecord(row)! };
  const latest = await loadStorySoundWorkspace(input);
  return { status: "conflict", revision: latest?.revision ?? 0 };
}

export async function saveStorySoundPlanVersion(input: {
  storyId: number;
  userId: number;
  evidenceSnapshotDigest: string;
  sourceRevisions: Record<string, string>;
}): Promise<StorySoundPlanVersion> {
  const workspace = await loadStorySoundWorkspace(input);
  if (!workspace) throw new Error("Sound plan workspace not found");
  const draft = normalizeStorySoundPlanDraft(workspace);
  const contentDigest = digest(canonicalStorySoundPlanContent(draft));
  const row = await getOrCreateStorySoundPlanVersionRecord({
    storyId: input.storyId,
    userId: input.userId,
    contentDigest,
    evidenceSnapshotDigest: input.evidenceSnapshotDigest,
    sourceRevisions: input.sourceRevisions,
    draft,
  });
  return versionFromRecord(row);
}

export async function listStorySoundPlanVersions(scope: {
  storyId: number;
  userId: number;
}) {
  const rows = await listStorySoundPlanVersionRecords(
    scope.storyId,
    scope.userId
  );
  return rows.map(row => versionFromRecord(row));
}

export async function restoreStorySoundPlanVersionToWorkspace(input: {
  storyId: number;
  userId: number;
  versionId: string;
  expectedRevision: number;
}) {
  const row = await getStorySoundPlanVersionRecord(
    input.versionId,
    input.storyId,
    input.userId
  );
  if (!row) throw new Error("Sound plan version not found");
  const restored = restoreStorySoundPlanVersion(versionFromRecord(row));
  return saveStorySoundWorkspace({
    storyId: input.storyId,
    userId: input.userId,
    expectedRevision: input.expectedRevision,
    draft: restored,
    interviewStatus: "needs_review",
    restoredFromVersionId: restored.restoredFromVersionId,
    interviewState: undefined,
    selectionByRowId: restored.selectionByRowId,
  });
}

export async function getOrCreateStorySoundRowOperation(input: {
  storyId: number;
  userId: number;
  rowId: string;
  versionId: string;
  requestDigest: string;
  quoteId: string;
  amountMinorUnits: number;
  currency: string;
}) {
  if (
    !Number.isSafeInteger(input.amountMinorUnits) ||
    input.amountMinorUnits < 0
  )
    throw new Error("amountMinorUnits must be a non-negative integer");
  const row = await getOrCreateStorySoundRowOperationRecord({
    ...input,
    state: "prepared",
    assetId: null,
    timelineClipId: null,
  });
  return {
    id: row.publicId,
    storyId: row.storyIdSnapshot,
    userId: row.userId,
    rowId: row.rowId,
    versionId: row.versionId,
    requestDigest: row.requestDigest,
    quoteId: row.quoteId,
    state: row.state,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    ...(row.assetId ? { assetId: row.assetId } : {}),
    ...(row.timelineClipId ? { timelineClipId: row.timelineClipId } : {}),
  };
}

export async function listStorySoundRowOperations(input: {
  storyId: number;
  userId: number;
}) {
  return listStorySoundRowOperationRecords({
    storyIdSnapshot: input.storyId,
    userId: input.userId,
  });
}
