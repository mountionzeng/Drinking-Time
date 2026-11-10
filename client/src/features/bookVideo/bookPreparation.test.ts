import { describe, it, expect, vi } from 'vitest';
import { prepareMountedBook, registerBookPreparation, refreshPreparedBook } from './bookPreparation';
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
it('only refreshes the latest editor registration and isolates accounts', async () => {
  const oldRefresh=vi.fn(), latestRefresh=vi.fn();
  const old=registerBookPreparation(30,9,vi.fn(),oldRefresh);
  const latest=registerBookPreparation(30,9,vi.fn(),latestRefresh);
  old();
  await refreshPreparedBook(30,9,[{id:1,version:2}]);
  expect(latestRefresh).toHaveBeenCalledWith([{id:1,version:2}]);
  expect(oldRefresh).not.toHaveBeenCalled();
  await expect(refreshPreparedBook(30,8,[{id:1,version:2}])).rejects.toThrow('回到书页');
  latest();
});
it('does not refresh an unmounted editor when its replacement has no refresh callback', async () => {
  const refresh=vi.fn();
  const old=registerBookPreparation(31,9,vi.fn(),refresh);
  const latest=registerBookPreparation(31,9,vi.fn());
  await expect(refreshPreparedBook(31,9,[{id:1,version:2}])).rejects.toThrow('回到书页');
  expect(refresh).not.toHaveBeenCalled();
  old(); latest();
});
