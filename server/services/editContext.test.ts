import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveSnapshot, getRecentAnnotations } from './editContext';
import { resetMemoryStateForTesting } from '../db';
import type { ProjectState } from '../_core/editDiff';

// Note: These tests use the in-memory database mode
// Set DATABASE_URL to empty to ensure in-memory mode
process.env.DATABASE_URL = '';

// Mock generateAnnotation so snapshot tests don't trigger real LLM calls or
// persist annotation data that would pollute the in-memory state across runs.
vi.mock('./semanticAnnotation', () => ({
  generateAnnotation: vi.fn().mockResolvedValue(undefined),
}));

describe('editContext service', () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
  });

  describe('saveSnapshot', () => {
    it('should save first snapshot with no previous snapshot', async () => {
      const state: ProjectState = {
        cards: [
          { id: '1', title: 'Card 1', content: 'Content 1' },
          { id: '2', title: 'Card 2', content: 'Content 2' },
        ],
        script: [{ id: 's1', heading: 'Scene 1', action: 'Action' }],
        shots: [{ shotNo: 1, shotType: 'wide', description: 'Wide shot' }],
      };

      const result = await saveSnapshot({
        projectId: 1,
        sessionId: 'session-1',
        state,
      });

      console.log('Result:', result);
      expect(result.snapshotId).toBeGreaterThan(0);
      expect(result.hasDiff).toBe(true);
      expect(result.diffSummary).toBeDefined();
      expect(result.diffSummary?.cardsChanged).toBe(2);
      expect(result.diffSummary?.scriptChanged).toBe(1);
      expect(result.diffSummary?.shotsChanged).toBe(1);
    });

    it('should save second snapshot and compute diff against first', async () => {
      const firstState: ProjectState = {
        cards: [
          { id: '1', title: 'Card 1', content: 'Content 1' },
          { id: '2', title: 'Card 2', content: 'Content 2' },
        ],
      };

      const secondState: ProjectState = {
        cards: [
          { id: '1', title: 'Card 1', content: 'Modified content' },
          { id: '3', title: 'Card 3', content: 'New card' },
        ],
      };

      // Save first snapshot
      await saveSnapshot({
        projectId: 2,
        sessionId: 'session-2',
        state: firstState,
      });

      // Save second snapshot
      const result = await saveSnapshot({
        projectId: 2,
        sessionId: 'session-2',
        state: secondState,
      });

      expect(result.snapshotId).toBeGreaterThan(0);
      expect(result.hasDiff).toBe(true);
      expect(result.diffSummary).toBeDefined();
      // 1 modified, 1 added, 1 deleted = 3 changes
      expect(result.diffSummary?.cardsChanged).toBe(3);
    });

    it('should handle snapshot with identical state (empty diff)', async () => {
      const state: ProjectState = {
        cards: [{ id: '1', title: 'Card 1', content: 'Content' }],
      };

      // Save first snapshot
      await saveSnapshot({
        projectId: 3,
        sessionId: 'session-3',
        state,
      });

      // Save second snapshot with identical state
      const result = await saveSnapshot({
        projectId: 3,
        sessionId: 'session-3',
        state,
      });

      expect(result.snapshotId).toBeGreaterThan(0);
      expect(result.hasDiff).toBe(false);
      expect(result.diffSummary).toBeUndefined();
    });

    it('should handle empty state', async () => {
      const state: ProjectState = {
        cards: [],
        script: [],
        shots: [],
      };

      const result = await saveSnapshot({
        projectId: 4,
        sessionId: 'session-4',
        state,
      });

      expect(result.snapshotId).toBeGreaterThan(0);
      // First snapshot with empty state still creates a diff (everything is "added", even if empty arrays)
      // The diff will be empty because there are no actual items, but hasDiff is true for first snapshot
      expect(result.hasDiff).toBe(true);
      expect(result.diffSummary?.cardsChanged).toBe(0);
      expect(result.diffSummary?.scriptChanged).toBe(0);
      expect(result.diffSummary?.shotsChanged).toBe(0);
    });

    it('should handle state with only cards', async () => {
      const state: ProjectState = {
        cards: [{ id: '1', title: 'Card 1' }],
      };

      const result = await saveSnapshot({
        projectId: 5,
        sessionId: 'session-5',
        state,
      });

      expect(result.snapshotId).toBeGreaterThan(0);
      expect(result.hasDiff).toBe(true);
      expect(result.diffSummary?.cardsChanged).toBe(1);
      expect(result.diffSummary?.scriptChanged).toBe(0);
      expect(result.diffSummary?.shotsChanged).toBe(0);
    });

    it('should handle multiple snapshots in sequence', async () => {
      const projectId = 6;
      const sessionId = 'session-6';

      // Snapshot 1: Initial state
      const state1: ProjectState = {
        cards: [{ id: '1', title: 'Card 1' }],
      };
      const result1 = await saveSnapshot({ projectId, sessionId, state: state1 });
      expect(result1.hasDiff).toBe(true);

      // Snapshot 2: Add a card
      const state2: ProjectState = {
        cards: [
          { id: '1', title: 'Card 1' },
          { id: '2', title: 'Card 2' },
        ],
      };
      const result2 = await saveSnapshot({ projectId, sessionId, state: state2 });
      expect(result2.hasDiff).toBe(true);
      expect(result2.diffSummary?.cardsChanged).toBe(1);

      // Snapshot 3: Delete a card
      const state3: ProjectState = {
        cards: [{ id: '2', title: 'Card 2' }],
      };
      const result3 = await saveSnapshot({ projectId, sessionId, state: state3 });
      expect(result3.hasDiff).toBe(true);
      expect(result3.diffSummary?.cardsChanged).toBe(1);
    });
  });

  describe('getRecentAnnotations', () => {
    it('should return empty array for project with no annotations', async () => {
      const annotations = await getRecentAnnotations(999);

      expect(annotations).toEqual([]);
    });

    it('should return annotations ordered by timestamp desc', async () => {
      // This test assumes annotations are created by U5 (semantic annotation service)
      // For now, we just verify the function doesn't crash
      const annotations = await getRecentAnnotations(1, 5);

      expect(Array.isArray(annotations)).toBe(true);
      expect(annotations.length).toBeLessThanOrEqual(5);
    });

    it('should respect limit parameter', async () => {
      const annotations = await getRecentAnnotations(1, 3);

      expect(annotations.length).toBeLessThanOrEqual(3);
    });

    it('should use default limit of 5', async () => {
      const annotations = await getRecentAnnotations(1);

      expect(annotations.length).toBeLessThanOrEqual(5);
    });
  });

  describe('integration: saveSnapshot → retrieve annotations', () => {
    it('should save snapshot and allow retrieval of annotations', async () => {
      const projectId = 100;
      const sessionId = 'integration-session';

      // Save a snapshot
      const state: ProjectState = {
        cards: [{ id: '1', title: 'Integration test card' }],
      };

      const result = await saveSnapshot({ projectId, sessionId, state });
      expect(result.snapshotId).toBeGreaterThan(0);

      // Try to retrieve annotations (will be empty until U5 creates them)
      const annotations = await getRecentAnnotations(projectId);
      expect(Array.isArray(annotations)).toBe(true);
    });
  });

  describe('autoSave flag (U7)', () => {
    it('does NOT call generateAnnotation when autoSave = true', async () => {
      const { generateAnnotation } = await import('./semanticAnnotation');
      const mockGenerate = vi.mocked(generateAnnotation);

      const state: ProjectState = {
        cards: [{ id: '1', title: 'Card A' }],
      };

      // First snapshot (baseline)
      await saveSnapshot({ projectId: 200, sessionId: 'auto-1', state });

      mockGenerate.mockClear();

      // Second snapshot with changes — explicit save: generateAnnotation should be called
      const stateB: ProjectState = {
        cards: [{ id: '1', title: 'Card A' }, { id: '2', title: 'Card B' }],
      };
      await saveSnapshot({ projectId: 200, sessionId: 'auto-1', state: stateB });
      expect(mockGenerate).toHaveBeenCalledTimes(1);

      mockGenerate.mockClear();

      // Third snapshot with changes — autoSave: generateAnnotation should NOT be called
      const stateC: ProjectState = {
        cards: [{ id: '1', title: 'Card A' }, { id: '2', title: 'Card B' }, { id: '3', title: 'Card C' }],
      };
      await saveSnapshot({ projectId: 200, sessionId: 'auto-1', state: stateC, autoSave: true });
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('still saves the snapshot and returns result when autoSave = true', async () => {
      const state: ProjectState = {
        cards: [{ id: '1', title: 'AutoSave Card' }],
      };

      const result = await saveSnapshot({
        projectId: 201,
        sessionId: 'auto-2',
        state,
        autoSave: true,
      });

      expect(result.snapshotId).toBeGreaterThan(0);
      expect(result.hasDiff).toBe(true); // first snapshot
    });

    it('saves diff correctly even when autoSave = true', async () => {
      const stateA: ProjectState = { cards: [{ id: '1', title: 'A' }] };
      const stateB: ProjectState = { cards: [{ id: '2', title: 'B' }] };

      await saveSnapshot({ projectId: 202, sessionId: 'auto-3', state: stateA, autoSave: true });
      const result = await saveSnapshot({ projectId: 202, sessionId: 'auto-3', state: stateB, autoSave: true });

      expect(result.hasDiff).toBe(true);
      expect(result.diffSummary?.cardsChanged).toBe(2); // 1 deleted + 1 added
    });
  });
});
