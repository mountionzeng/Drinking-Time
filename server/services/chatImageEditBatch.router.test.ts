import { sourceImageFixture as sourceFixture } from "../testFixtures/sourceImage";
import { beforeEach, expect, it, vi } from 'vitest';
import type { TrpcContext } from '../_core/context';
import { createChatImageEditPlan } from '../../shared/chatImageEditPlan';
import type { Task } from './storyboardImageTask';
import { jsonRecord } from '../repositories/storyValues';
import { adjustedImageEditPlanId } from '../../shared/chatImageEditPlan';
import { checkReviewedImageBalance } from './providerImageBalance';
vi.mock('./providerImageBalance', () => ({ checkReviewedImageBalance: vi.fn(async () => 'sufficient') }));
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


async function withPriorFailure(status: Task["status"] = "failed", flags = {}) {
  const f = await fixture();
  const query = { storyId: f.story.id, planMessageId: "plan" };
  const batch = await f.c.chatImageEditBatch(query);
  const body = (await getStoryById(f.story.id, 123))!.body!;
  const task: Task = { id: "legacy", requestId: batch.items[0].requestId, shotIdentity: "s3", status,
    reviewedOutput: f.input.imageEditPlanOutput, createdAt: 1, providerTaskId: "original-302-receipt",
    result: { status: "error", error: "302 GPT-image 状态 401，错误码 -10004", recoveryPending: false }, ...flags };
  const sibling: Task = { id: "sibling", requestId: batch.items[1].requestId, status: "succeeded", shotIdentity: "s3",
    result: {status:"ok", imageId:f.images[1].id, imageUrl:f.images[1].imageUrl, candidates:[]} };
  await updateStory(f.story.id, 123, {body:{ ...body, storyboardImageTasks:[task, sibling] }});
  return { ...f, query, batch, task };
}

it("retries one terminal receipt on the original shot once, reusing the original inputs and preserving the edit", async () => {
  const f = await withPriorFailure();
  const warehouse = () => f.c.warehouseImageAttempts({storyId:f.story.id});
  const [row] = await warehouse();
  const offer = row.offer!;
  expect(row.error).toContain("余额不足");
  const current = await f.c.chatImageEditBatch(f.query);
  expect(current.items[0].retry).toEqual(offer);
  expect(current.items[1].status).toBe("done");
  const retry = { ...f.input, retryFailedImageRequestId:offer.failedId, shotImageRequestId:offer.nextId, conversationShotId:"s3",
    costConfirmation:{accepted:true as const, estimatedCny:offer.unitCny}, autoSelect:true, referenceImageUrl:"wrong" };
  for (const change of [{costConfirmation:undefined}, {costConfirmation:{accepted:true as const,estimatedCny:0}},
    {shotImageRequestId:offer.failedId}, {conversationShotId:"other"}, {retryFailedImageRequestId:undefined}]) {
    expect(await f.c.generateForMobile({...retry,...change})).toMatchObject({status:"error"});
  }
  await expect(caller(124).generateForMobile(retry)).rejects.toThrow();
  await expect(caller(124).warehouseImageAttempts({storyId:f.story.id})).rejects.toThrow();
  expect(checkReviewedImageBalance).not.toHaveBeenCalled();
  provider.editImage.mockImplementation(async (_url, _prompt, opts) => {
    await opts.onProviderTaskAccepted("new-receipt");
    return {status:"error",providerTaskId:"new-receipt",errorCode:"timeout_pending"};
  });
  await Promise.all([f.c.generateForMobile(retry), f.c.generateForMobile(retry)]);
  expect(checkReviewedImageBalance).toHaveBeenCalledOnce();
  expect(provider.editImage).toHaveBeenCalledOnce();
  expect(provider.editImage.mock.calls[0]).toEqual([f.images[0].imageUrl, expect.stringContaining("只调整树冠配色"),
    expect.objectContaining({provider:"gpt-image",referenceContextImageUrls:expect.arrayContaining([f.images[2].imageUrl])})]);
  expect((await warehouse())[0]).toMatchObject({requestIds:[offer.failedId,offer.nextId],status:"accepted",offer:undefined});
  provider.resume302GptImageTask.mockResolvedValueOnce({status:"ok",imageUrl:"/retry-result.png",imageKey:"retry-result"});
  expect(await f.c.recoverStoryboardImage({storyId:f.story.id,requestId:offer.nextId})).toMatchObject({status:"ok"});
  expect(await f.c.generateForMobile(retry)).toMatchObject({status:"ok"});
  expect(provider.editImage).toHaveBeenCalledOnce();
  expect((await warehouse())[0]).toMatchObject({status:"succeeded",offer:undefined});
  const completed = await f.c.chatImageEditBatch(f.query);
  expect(completed.items[1]).toEqual(current.items[1]);
  expect(completed.items[0].result?.imageUrl).toBe("/retry-result.png");
  const result = (await getStoryGeneratedImages(f.story.id,123)).find(row=>row.imageUrl==="/retry-result.png");
  expect(result).toMatchObject({parentImageId:f.images[0].id,isCurrent:false,shotIdentity:"s3"});
  expect((await getStoryById(f.story.id,123))!.body).toMatchObject({videoWorkflow:{keep:"draft"}});
});

it("checks credit before preparation and requires a fresh click after each definite failure", async () => {
  const f = await fixture();
  const query={storyId:f.story.id,planMessageId:"plan"};
  const original = await f.c.chatImageEditBatch(query);
  const first = {...f.input, costConfirmation:{accepted:true as const,estimatedCny:original.unitEstimatedCny}};
  vi.mocked(checkReviewedImageBalance).mockResolvedValueOnce("insufficient").mockResolvedValueOnce("insufficient");
  expect(await f.c.generateForMobile(first)).toMatchObject({status:"error",error:expect.stringContaining("尚未提交")});
  const a=(await f.c.chatImageEditBatch(query)).items[0].retry!;
  const click = {...first, retryFailedImageRequestId:a.failedId,shotImageRequestId:a.nextId,conversationShotId:"s3"};
  expect(await f.c.generateForMobile(click)).toMatchObject({status:"error",error:expect.stringContaining("余额不足")});
  const b=(await f.c.chatImageEditBatch(query)).items[0].retry!;
  expect(b.failedId).toBe(a.nextId);
  expect(b.nextId).not.toBe(a.nextId);
  await f.c.generateForMobile(click);
  expect(checkReviewedImageBalance).toHaveBeenCalledTimes(2);
  expect(provider.editImage).not.toHaveBeenCalled();
  const body=jsonRecord((await getStoryById(f.story.id,123))!.body);
  const messages=Array.isArray(body.messages) ? body.messages : [];
  await updateStory(f.story.id,123,{body:{...body,messages:[...messages,{id:adjustedImageEditPlanId("plan"),who:"s",text:"changed",timestamp:2}]}});
  expect((await f.c.warehouseImageAttempts({storyId:f.story.id}))[0].offer).toBeUndefined();
  await expect(f.c.generateForMobile({...click,retryFailedImageRequestId:b.failedId,shotImageRequestId:b.nextId})).rejects.toThrow("已调整");
});

it.each([["unknown",{}],["accepted",{}],["failed",{providerResultUrl:"/existing"}],
  ["failed",{result:{status:"error",submissionUncertain:true,error:"timeout"}}]] as const)(
  "cannot buy another output for a %s receipt with protected state", async (status,flags) => {
    const f=await withPriorFailure(status,flags);
    expect((await f.c.chatImageEditBatch(f.query)).items[0].retry).toBeUndefined();
    expect((await f.c.warehouseImageAttempts({storyId:f.story.id})).some(row=>row.offer)).toBe(false);
    expect(await f.c.generateForMobile({...f.input,retryFailedImageRequestId:f.task.requestId,
      costConfirmation:{accepted:true,estimatedCny:f.batch.unitEstimatedCny}})).toMatchObject({status:"error"});
    expect(provider.editImage).not.toHaveBeenCalled();
  });

it("recovers a historical output without saved output metadata using the original request ID", async () => {
  const f = await withPriorFailure("failed", { reviewedOutput: undefined });
  const [row] = await f.c.warehouseImageAttempts({storyId: f.story.id});
  expect(row.offer?.failedId).toBe(f.task.requestId);
  expect(row.offer?.imageId).toBe(f.images[0].id);
});
