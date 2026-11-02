import { describe, expect, it } from 'vitest';
import { isNewRelease } from './releaseCheck';
describe('loaded page release check', () => {
  it('detects a stale tab including a rollback', () => {
    expect(isNewRelease('release-a', { version: 'release-b' })).toBe(true);
    expect(isNewRelease('release-b', { version: 'release-a' })).toBe(true);
  });
  it('does not mistake the same release or a broken response for an update', () => {
    for (const value of [null, {}, { version: '' }, {version: 123}, { version: 'release-a' }]) {
      expect(isNewRelease('release-a', value)).toBe(false);
    }
    expect(isNewRelease('', {version:'release-a'})).toBe(false);
  });
});

it('blocks writes after detecting a new app release, without reloading or clearing drafts', async () => {
  const { assertCurrentApp, markAppStale } = await import('./releaseCheck');
  expect(() => assertCurrentApp()).not.toThrow();
  markAppStale();
  expect(() => assertCurrentApp()).toThrow('保留草稿，打开新版');
});
