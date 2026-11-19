import { beforeEach, expect, it, vi } from 'vitest';
import type { TrpcContext } from '../_core/context';
const provider = vi.hoisted(() => ({ editImage: vi.fn(), resume302GptImageTask: vi.fn(), toPublicImageUrl: vi.fn(async (url: string) => url) }));
vi.mock('./imageGen', async actual => ({ ...await actual<typeof import('./imageGen')>(), ...provider }));
vi.mock('./imageEditDimensions', () => ({ readImageDimensions: async () => ({ width: 960, height: 960 }), normalizeImageEditResult: async (result: unknown) => ({ result, checks: {} }) }));
// Keep the real gateway and router. Provider calls are fixtures; unexpected network fails the test.
process.env.DATABASE_URL = '';
const { storyAgentRouter } = await import('../routers/storyAgent');
const { createStory, updateStory, getStoryById } = await import('../repositories/stories');
const { createGeneratedImage, getStoryGeneratedImages } = await import('../repositories/images');
const { resetMemoryStateForTesting } = await import('../repositories/runtime');
function caller(userId = 123) {
  return storyAgentRouter.createCaller({ user: { id: userId, openId: `user-${userId}`, email: null, name: 'Test', role: 'user', loginMethod: 'manus', createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: 'https', headers: {} }, res: {} } as TrpcContext);
}
beforeEach(() => { resetMemoryStateForTesting(); vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('unexpected network'); })); });

async function fixture() {
  const story = await createStory({ userId: 123, title: 'single remix', body: {} });
  const source = await createGeneratedImage({ storyId: story.id, userId: 123, imageUrl: 'https://example.com/source.png', isCurrent: true });
  await updateStory(story.id, 123, { body: { shots: [{ shotNo: 3, stableShotId: 's3' }], videoWorkflow: { keep: 'draft' }, messages: [
    { id: 'u', who: 'u', timestamp: 1, text: `[[ref:image%3A${source.id}]] 只缩小飞机，保留颜色` },
    { id: 'q', who: 's', timestamp: 2, text: '已收到 1 张引用，待确认', selectionQuote: { storyId: story.id, stableShotId: 's3' } },
  ] } });
  const { estimateStoryboardMaskedEditCost } = await import('../../shared/imageRenderCost');
  return { story, source, c: caller(), input: { storyId: story.id, chatImageRemixQuoteId: 'q', costConfirmation: { accepted: true as const, estimatedCny: estimateStoryboardMaskedEditCost().estimatedCny } } };
}
it('single remix persists acceptance, returns immediately and restores once without another purchase or adoption', async () => {
  const f = await fixture();
  provider.editImage.mockImplementationOnce(async (_url, _prompt, options) => {
    expect(options.gptSubmitOnly).toBe(true);
    await options.onProviderTaskAccepted('single-receipt');
    return { status: 'error', providerTaskId: 'single-receipt', errorCode: 'timeout_pending' };
  });
  expect(await f.c.generateForMobile({ ...f.input, autoSelect: true, referenceImageUrl: 'https://evil.example/wrong' }))
    .toMatchObject({ status: 'error', providerTaskId: 'single-receipt', recoveryPending: true });
  expect(provider.editImage.mock.calls[0]).toEqual([f.source.imageUrl, expect.stringContaining('只缩小飞机，保留颜色'), expect.any(Object)]);
  const tasks = ((await getStoryById(f.story.id, 123))!.body as any).storyboardImageTasks;
  expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ status: 'accepted', providerTaskId: 'single-receipt' });
  provider.resume302GptImageTask.mockResolvedValueOnce({ status: 'error', providerTaskId: 'single-receipt', errorCode: 'timeout_pending', message: '断线' });
  expect(await f.c.recoverChatImageRemix({ storyId: f.story.id, quoteMessageId: 'q' })).toMatchObject({ pending: true, recoverable: true });
  provider.resume302GptImageTask.mockResolvedValueOnce({ status: 'ok', imageUrl: '/restored.png', imageKey: 'restored' });
  const result = await f.c.recoverChatImageRemix({ storyId: f.story.id, quoteMessageId: 'q' });
  expect(result).toMatchObject({ imageUrl: '/restored.png', sourceImageIds: [f.source.id] });
  await f.c.generateForMobile(f.input);
  await f.c.recoverChatImageRemix({ storyId: f.story.id, quoteMessageId: 'q' });
  expect(provider.editImage).toHaveBeenCalledTimes(1);
  const images = await getStoryGeneratedImages(f.story.id, 123);
  expect(images).toHaveLength(2); expect(images.filter(i => i.isCurrent).map(i => i.id)).toEqual([f.source.id]);
  expect((await getStoryById(f.story.id, 123))?.body).toMatchObject({ videoWorkflow: { keep: 'draft' } });
  expect(fetch).not.toHaveBeenCalled();
});
it('no purchase on quote mismatch, foreign account, duplicate or unknown receipt', async () => {
  const f = await fixture();
  expect(await f.c.generateForMobile({ ...f.input, costConfirmation: undefined })).toMatchObject({ status: 'error' });
  await expect(caller(124).generateForMobile(f.input)).rejects.toThrow();
  expect(provider.editImage).not.toHaveBeenCalled();
  provider.editImage.mockResolvedValue({ status: 'error', submissionUncertain: true, message: 'connection lost' });
  await Promise.all([f.c.generateForMobile(f.input), f.c.generateForMobile(f.input)]);
  await f.c.generateForMobile(f.input);
  expect(provider.editImage).toHaveBeenCalledTimes(1);
  expect(await f.c.recoverChatImageRemix({ storyId: f.story.id, quoteMessageId: 'q' })).toMatchObject({ pending: true, recoverable: false });
});
