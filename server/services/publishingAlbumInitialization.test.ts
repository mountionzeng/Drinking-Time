import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), book: vi.fn() }));
vi.mock('./publishingPersistence', () => ({ getPublishingDraftState: mocks.read, writePublishingDraftState: mocks.write }));
vi.mock('./bookVideoSource', () => ({ readBookVideoSource: mocks.book }));
import { initializePublishingAlbum } from './publishingAlbumPersistence';
const input = { storyId: 7, userId: 3, versionId: 'v1', baseContainerRevision: 2, baseVersionRevision: 1, operationToken: 'album-test', bookSource: true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ publishing: { core: null, versions: [{ versionId: 'v1', activePlatform: 'xiaohongshu', drafts: {} }] } });
  mocks.book.mockResolvedValue({ layout: { body: '当前书里的新文字。', illustrations: [] } });
  mocks.write.mockImplementation(async value => value);
});
it('builds an album from the saved book without requiring a legacy core or platform draft', async () => {
  const result = await initializePublishingAlbum(input);
  expect(mocks.book).toHaveBeenCalledWith(expect.objectContaining({storyId: 7, userId: 3}));
  expect((result as any).operation.album.pages.map((p: any) => p.text).join('')).toBe('当前书里的新文字。');
  expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({operation: expect.objectContaining({baseContainerRevision: 2, baseVersionRevision: 1})}));
});
it('does not silently fall back to an older platform draft when the book cannot be read', async () => {
  mocks.book.mockResolvedValue(null);
  await expect(initializePublishingAlbum(input)).rejects.toThrow('先写入并保存书稿');
  expect(mocks.write).not.toHaveBeenCalled();
});
