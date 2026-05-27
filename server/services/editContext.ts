/**
 * Edit context service
 * Business logic for snapshot storage, diff computation, and annotation retrieval
 */

import {
  createEditSnapshot,
  getLatestEditSnapshot,
  getRecentSemanticAnnotations,
  type EditSnapshot,
  type SemanticAnnotation,
} from '../db';
import { computeDiff, isDiffEmpty, type ProjectState } from '../_core/editDiff';
import { generateAnnotation } from './semanticAnnotation';

export interface InlineCorrection {
  originalText: string;
  modifiedText: string;
  instruction: string;
  sourceType: string;
}

export interface SaveSnapshotInput {
  projectId: number;
  sessionId: string;
  state: ProjectState;
  /** When true (auto-save timer), skips semantic annotation generation. */
  autoSave?: boolean;
  /** When set, this snapshot was triggered by an inline selection edit. */
  inlineCorrection?: InlineCorrection;
}

export interface SaveSnapshotResult {
  snapshotId: number;
  hasDiff: boolean;
  diffSummary?: {
    cardsChanged: number;
    scriptChanged: number;
    shotsChanged: number;
  };
}

/**
 * Save a new snapshot and compute diff from previous snapshot
 * Returns snapshotId and diff summary
 */
export async function saveSnapshot(
  input: SaveSnapshotInput,
): Promise<SaveSnapshotResult> {
  const { projectId, sessionId, state, autoSave = false, inlineCorrection } = input;

  // Query previous snapshot for this project
  const previousSnapshot = await getLatestEditSnapshot(projectId);

  // Compute diff if there's a previous snapshot
  let diff = null;
  let previousSnapshotId = null;

  if (previousSnapshot) {
    previousSnapshotId = previousSnapshot.id;
    const previousState = previousSnapshot.state as ProjectState;
    diff = computeDiff(previousState, state);

    // If diff is empty, still save snapshot but mark as no changes
    if (isDiffEmpty(diff)) {
      diff = null;
    }
  } else {
    // First snapshot - compute diff against null to mark everything as added
    diff = computeDiff(null, state);
  }

  // Store new snapshot
  const snapshot = await createEditSnapshot({
    projectId,
    sessionId,
    state,
    previousSnapshotId,
    diff: diff ?? null,
  });

  // Build diff summary
  const diffSummary = diff
    ? {
        cardsChanged:
          diff.cards.added.length +
          diff.cards.deleted.length +
          diff.cards.modified.length,
        scriptChanged:
          diff.script.added.length +
          diff.script.deleted.length +
          diff.script.modified.length,
        shotsChanged:
          diff.shots.added.length +
          diff.shots.deleted.length +
          diff.shots.modified.length,
      }
    : undefined;

  // Generate semantic annotation when there's a meaningful diff against a previous snapshot.
  // Skipped for auto-saved snapshots (timer-triggered) — annotations only generated on
  // explicit generation requests. Errors swallowed inside generateAnnotation (never blocks).
  if (!autoSave && diff !== null && previousSnapshotId !== null) {
    const recentAnnotations = await getRecentSemanticAnnotations(projectId, 3);
    await generateAnnotation({
      diff,
      snapshotId: snapshot.id,
      previousSnapshotId,
      previousAnnotations: recentAnnotations,
      inlineCorrection,
    });
  }

  return {
    snapshotId: snapshot.id,
    hasDiff: diff !== null,
    diffSummary,
  };
}

/**
 * Retrieve recent semantic annotations for a project
 * Returns up to `limit` annotations ordered by timestamp desc
 */
export async function getRecentAnnotations(
  projectId: number,
  limit = 5,
): Promise<SemanticAnnotation[]> {
  return getRecentSemanticAnnotations(projectId, limit);
}
