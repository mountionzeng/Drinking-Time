import { describe, expect, it, vi } from 'vitest';
import { createActionFacade } from './actionFacade';

describe('createActionFacade', () => {
  it('keeps stable function identities while calling the latest actions', () => {
    const firstSave = vi.fn((value: string) => `first:${value}`);
    const secondSave = vi.fn((value: string) => `second:${value}`);
    const actionsRef = {
      current: {
        save: firstSave,
      },
    };

    const facade = createActionFacade(actionsRef, ['save']);
    const stableSave = facade.save;

    expect(facade.save('one')).toBe('first:one');
    actionsRef.current = { save: secondSave };

    expect(facade.save).toBe(stableSave);
    expect(facade.save('two')).toBe('second:two');
    expect(firstSave).toHaveBeenCalledWith('one');
    expect(secondSave).toHaveBeenCalledWith('two');
  });

  it('throws a focused error when an action is missing', () => {
    const facade = createActionFacade<{ save: () => void }>({ current: null }, ['save']);

    expect(() => facade.save()).toThrow('StoryAgent action "save" is not ready');
  });
});
