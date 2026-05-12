import { describe, it, expect } from 'vitest';
import { computeDiff, isDiffEmpty, type ProjectState } from './editDiff';

describe('editDiff', () => {
  describe('computeDiff', () => {
    it('should detect card deletion', () => {
      const oldState: ProjectState = {
        cards: [
          { id: '1', title: 'Card 1', content: 'Content 1' },
          { id: '2', title: 'Card 2', content: 'Content 2' },
        ],
      };
      const newState: ProjectState = {
        cards: [{ id: '2', title: 'Card 2', content: 'Content 2' }],
      };

      const diff = computeDiff(oldState, newState);

      expect(diff.cards.deleted).toHaveLength(1);
      expect(diff.cards.deleted[0].id).toBe('1');
      expect(diff.cards.added).toHaveLength(0);
      expect(diff.cards.modified).toHaveLength(0);
    });

    it('should detect card addition', () => {
      const oldState: ProjectState = {
        cards: [{ id: '1', title: 'Card 1', content: 'Content 1' }],
      };
      const newState: ProjectState = {
        cards: [
          { id: '1', title: 'Card 1', content: 'Content 1' },
          { id: '2', title: 'Card 2', content: 'Content 2' },
        ],
      };

      const diff = computeDiff(oldState, newState);

      expect(diff.cards.added).toHaveLength(1);
      expect(diff.cards.added[0].id).toBe('2');
      expect(diff.cards.deleted).toHaveLength(0);
      expect(diff.cards.modified).toHaveLength(0);
    });

    it('should detect card modification', () => {
      const oldState: ProjectState = {
        cards: [{ id: '1', title: 'Card 1', content: 'Old content' }],
      };
      const newState: ProjectState = {
        cards: [{ id: '1', title: 'Card 1', content: 'New content' }],
      };

      const diff = computeDiff(oldState, newState);

      expect(diff.cards.modified).toHaveLength(1);
      expect(diff.cards.modified[0].old.content).toBe('Old content');
      expect(diff.cards.modified[0].new.content).toBe('New content');
      expect(diff.cards.deleted).toHaveLength(0);
      expect(diff.cards.added).toHaveLength(0);
    });

    it('should produce empty diff for identical states', () => {
      const state: ProjectState = {
        cards: [{ id: '1', title: 'Card 1', content: 'Content 1' }],
        script: [{ id: 's1', heading: 'Scene 1', action: 'Action' }],
        shots: [{ shotNo: 1, shotType: 'wide', description: 'Wide shot' }],
      };

      const diff = computeDiff(state, state);

      expect(isDiffEmpty(diff)).toBe(true);
    });

    it('should handle first snapshot (null old state)', () => {
      const newState: ProjectState = {
        cards: [
          { id: '1', title: 'Card 1' },
          { id: '2', title: 'Card 2' },
        ],
        script: [{ id: 's1', heading: 'Scene 1' }],
        shots: [{ shotNo: 1, shotType: 'wide' }],
      };

      const diff = computeDiff(null, newState);

      expect(diff.cards.added).toHaveLength(2);
      expect(diff.script.added).toHaveLength(1);
      expect(diff.shots.added).toHaveLength(1);
      expect(diff.cards.deleted).toHaveLength(0);
      expect(diff.cards.modified).toHaveLength(0);
    });

    it('should ignore metadata changes (createdAt, updatedAt)', () => {
      const oldState: ProjectState = {
        cards: [
          {
            id: '1',
            title: 'Card 1',
            content: 'Content',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };
      const newState: ProjectState = {
        cards: [
          {
            id: '1',
            title: 'Card 1',
            content: 'Content',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-02T00:00:00Z', // Changed
          },
        ],
      };

      const diff = computeDiff(oldState, newState);

      expect(isDiffEmpty(diff)).toBe(true);
    });

    it('should ignore reordering without content changes', () => {
      const oldState: ProjectState = {
        cards: [
          { id: '1', title: 'Card 1' },
          { id: '2', title: 'Card 2' },
        ],
      };
      const newState: ProjectState = {
        cards: [
          { id: '2', title: 'Card 2' },
          { id: '1', title: 'Card 1' },
        ],
      };

      const diff = computeDiff(oldState, newState);

      expect(isDiffEmpty(diff)).toBe(true);
    });

    it('should handle cards, script, and shots modified simultaneously', () => {
      const oldState: ProjectState = {
        cards: [{ id: '1', title: 'Old' }],
        script: [{ id: 's1', heading: 'Old scene' }],
        shots: [{ shotNo: 1, shotType: 'wide' }],
      };
      const newState: ProjectState = {
        cards: [{ id: '1', title: 'New' }],
        script: [{ id: 's1', heading: 'New scene' }],
        shots: [{ shotNo: 1, shotType: 'close-up' }],
      };

      const diff = computeDiff(oldState, newState);

      expect(diff.cards.modified).toHaveLength(1);
      expect(diff.script.modified).toHaveLength(1);
      expect(diff.shots.modified).toHaveLength(1);
    });

    it('should handle very large diff (50+ cards deleted)', () => {
      const oldCards = Array.from({ length: 60 }, (_, i) => ({
        id: `card-${i}`,
        title: `Card ${i}`,
      }));
      const newCards = oldCards.slice(0, 5); // Keep only first 5

      const oldState: ProjectState = { cards: oldCards };
      const newState: ProjectState = { cards: newCards };

      const diff = computeDiff(oldState, newState);

      expect(diff.cards.deleted).toHaveLength(55);
      expect(diff.cards.added).toHaveLength(0);
      expect(diff.cards.modified).toHaveLength(0);
    });

    it('should ignore readinessScore changes in shots', () => {
      const oldState: ProjectState = {
        shots: [
          { shotNo: 1, shotType: 'wide', readinessScore: 0.5 },
        ],
      };
      const newState: ProjectState = {
        shots: [
          { shotNo: 1, shotType: 'wide', readinessScore: 0.9 },
        ],
      };

      const diff = computeDiff(oldState, newState);

      expect(isDiffEmpty(diff)).toBe(true);
    });

    it('should handle empty arrays', () => {
      const oldState: ProjectState = {
        cards: [],
        script: [],
        shots: [],
      };
      const newState: ProjectState = {
        cards: [{ id: '1', title: 'New card' }],
      };

      const diff = computeDiff(oldState, newState);

      expect(diff.cards.added).toHaveLength(1);
      expect(diff.cards.deleted).toHaveLength(0);
    });

    it('should handle undefined arrays', () => {
      const oldState: ProjectState = {};
      const newState: ProjectState = {
        cards: [{ id: '1', title: 'New card' }],
      };

      const diff = computeDiff(oldState, newState);

      expect(diff.cards.added).toHaveLength(1);
      expect(diff.cards.deleted).toHaveLength(0);
    });
  });

  describe('isDiffEmpty', () => {
    it('should return true for empty diff', () => {
      const diff = {
        cards: { deleted: [], added: [], modified: [] },
        script: { deleted: [], added: [], modified: [] },
        shots: { deleted: [], added: [], modified: [] },
      };

      expect(isDiffEmpty(diff)).toBe(true);
    });

    it('should return false when cards are added', () => {
      const diff = {
        cards: { deleted: [], added: [{ id: '1', title: 'New' }], modified: [] },
        script: { deleted: [], added: [], modified: [] },
        shots: { deleted: [], added: [], modified: [] },
      };

      expect(isDiffEmpty(diff)).toBe(false);
    });

    it('should return false when shots are modified', () => {
      const diff = {
        cards: { deleted: [], added: [], modified: [] },
        script: { deleted: [], added: [], modified: [] },
        shots: {
          deleted: [],
          added: [],
          modified: [
            {
              old: { shotNo: 1, shotType: 'wide' },
              new: { shotNo: 1, shotType: 'close-up' },
            },
          ],
        },
      };

      expect(isDiffEmpty(diff)).toBe(false);
    });
  });
});
