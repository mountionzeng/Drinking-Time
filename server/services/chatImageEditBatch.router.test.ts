import { sourceImageFixture as sourceFixture } from "../testFixtures/sourceImage";
import { beforeEach, expect, it, vi } from 'vitest';
import type { TrpcContext } from '../_core/context';
import { createChatImageEditPlan } from '../../shared/chatImageEditPlan';
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
async function fixture(count=2) {
  const story = await createStory({ userId: 123, title: 'two images', body: {} });
  const images = await Promise.all(Array.from({length:count+1},(_,i)=>i+1).map(async n => createGeneratedImage({ storyId: story.id, userId: 123, imageUrl: await sourceFixture(n), isCurrent: false })));
  const plan = createChatImageEditPlan(images.map(image => ({ imageId: image.id, imageUrl: image.imageUrl, label: `${image.id}` })), '只调整树冠配色');
  plan.status = 'submitted'; plan.preserve = '飞机大小、位置、数量、形状和颜色';
  plan.images.forEach((image, i) => { image.role = i === count ? 'reference' : 'target'; image.purpose = '饱和度与颜色层次'; });
  const selectionQuote={storyId:story.id,stableShotId:'s3'};
  if (count>2) plan.keyframeBoardId='saved-photos:fixture';
  const board=plan.keyframeBoardId ? [{id:plan.keyframeBoardId,who:'s',selectionQuote,text:'关键帧初稿（'+count+' 张）\n'+images.slice(0,count).map(i=>'[[ref:image%3A'+i.id+']]').join(' ')}] : [];
  await updateStory(story.id, 123, { body: { shots: [{ shotNo: 3, stableShotId: 's3' }], videoWorkflow: { keep: 'draft' }, messages: [...board,{ id: 'plan', who: 's', timestamp: 1, imageEditPlan: plan, selectionQuote: { storyId: story.id, stableShotId: 's3' } }] } });
  return { story, images, c: caller(), input: { storyId: story.id, imageEditPlanOutput: { planMessageId: 'plan', imageId: images[0].id, copy: 1 } } };
}
it.each([2,5])('requires current quote confirmation and resolves each base from a %i-target plan', async count => {
  const f = await fixture(count); const batch = await f.c.chatImageEditBatch({ storyId: f.story.id, planMessageId: 'plan' });
  expect(await f.c.generateForMobile(f.input)).toMatchObject({ status: 'error' });
  expect(await f.c.generateForMobile({ ...f.input, costConfirmation: { accepted: true, estimatedCny: 0 } })).toMatchObject({ status: 'error' });
  expect(provider.editImage).not.toHaveBeenCalled();
  for (const [i, item] of batch.items.entries()) {
    provider.editImage.mockImplementationOnce(async (_url, _prompt, options) => { await options.onProviderTaskAccepted(`receipt-${i}`); return { status: 'error', providerTaskId: `receipt-${i}`, errorCode: 'timeout_pending' }; });
    const input = { ...f.input, imageEditPlanOutput: { ...f.input.imageEditPlanOutput, imageId: item.imageId },
      autoSelect: true, referenceImageUrl: 'https://evil.example/incorrect.png', imageProvider: 'midjourney' as const,
      costConfirmation: { accepted: true as const, estimatedCny: batch.unitEstimatedCny } };
    expect(await f.c.generateForMobile(input)).toMatchObject({ status: 'error', providerTaskId: `receipt-${i}` });
    expect(provider.editImage.mock.calls.at(-1)).toEqual([f.images[i].imageUrl, expect.stringContaining('飞机大小、位置、数量、形状和颜色'), expect.objectContaining({ provider: 'gpt-image', preferStructuralEdit: true, referenceContextImageUrls: count===5 ? [f.images[count].imageUrl] : expect.arrayContaining([f.images[count].imageUrl]) })]);
    await f.c.generateForMobile(input); expect(provider.editImage).toHaveBeenCalledTimes(i + 1);
    provider.resume302GptImageTask.mockResolvedValueOnce({ status: 'ok', imageUrl: `/result-${i}.png`, imageKey: `result-${i}` });
    expect(await f.c.recoverStoryboardImage({ storyId: f.story.id, requestId: item.requestId })).toMatchObject({ status: 'ok' });
    expect(await f.c.generateForMobile(input)).toMatchObject({ status: 'ok' });
    expect(provider.editImage).toHaveBeenCalledTimes(i + 1);
  }
  const finished = await f.c.chatImageEditBatch({ storyId: f.story.id, planMessageId: 'plan' });
  expect(finished.items.map(item => item.status)).toEqual(Array(count).fill('done')); expect(finished.remainingEstimatedCny).toBe(0);
  const images = await getStoryGeneratedImages(f.story.id, 123);
  expect(images).toHaveLength(count*2+1); expect(images.every(image => !image.isCurrent)).toBe(true);
  expect(finished.items.map(item => images.find(image => image.id === item.result!.imageId)?.parentImageId)).toEqual(f.images.slice(0, count).map(image => image.id));
  expect((await getStoryById(f.story.id, 123))?.body).toMatchObject({ videoWorkflow: { keep: 'draft' } });
  expect(fetch).not.toHaveBeenCalled();
});
it('double submission and unknown receipts cannot purchase twice', async () => {
  const f = await fixture(); const batch = await f.c.chatImageEditBatch({ storyId: f.story.id, planMessageId: 'plan' });
  provider.editImage.mockResolvedValue({ status: 'error', submissionUncertain: true, message: 'timeout' });
  const input = { ...f.input, costConfirmation: { accepted: true as const, estimatedCny: batch.unitEstimatedCny } };
  await Promise.all([f.c.generateForMobile(input), f.c.generateForMobile(input)]);
  await f.c.generateForMobile(input); expect(provider.editImage).toHaveBeenCalledTimes(1);
  expect((await f.c.chatImageEditBatch({ storyId: f.story.id, planMessageId: 'plan' })).items[0].status).toBe('unknown');
  await expect(caller(124).generateForMobile(input)).rejects.toThrow();
});
