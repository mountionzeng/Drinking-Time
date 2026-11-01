import { describe, it, expect, vi } from 'vitest';
import { prepareMountedBook, registerBookPreparation } from './bookPreparation';
describe('leaving the mobile book', () => {
  it('awaits the owner save and propagates failures instead of discarding a draft', async () => {
    const save=vi.fn().mockRejectedValue(new Error('版本冲突'));
    const release=registerBookPreparation(3,9,save);
    await expect(prepareMountedBook(3,9)).rejects.toThrow('版本冲突');
    expect(save).toHaveBeenCalledOnce();
    release();
    await expect(prepareMountedBook(3,9)).resolves.toBeUndefined();
  });
  it('does not flush a different account or story', async () => {
    const save=vi.fn(); const release=registerBookPreparation(3,9,save);
    await prepareMountedBook(4,9); await prepareMountedBook(3,8);
    expect(save).not.toHaveBeenCalled(); release();
  });
});
