import { sourceImageFixture as sourceFixture } from "../testFixtures/sourceImage";
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TrpcContext } from '../_core/context';
import { createChatImageEditPlan } from '../../shared/chatImageEditPlan';
const provider = vi.hoisted(() => ({ editImage: vi.fn(), resume302GptImageTask: vi.fn(), toPublicImageUrl: vi.fn(async (url: string) => url) }));
vi.mock('./imageGen', async actual => ({ ...await actual<typeof import('./imageGen')>(), ...provider }));
vi.mock('./imageEditDimensions', () => ({ readImageDimensions: async () => ({ width: 960, height: 960 }), normalizeImageEditResult: async (result: unknown) => ({ result, checks: {} }) }));
// Keep the real gateway and router. Provider calls are fixtures; unexpected network fails the test.
process.env.DATABASE_URL = '';
const mj = vi.hoisted(() => ({ generateLegnextImage: vi.fn(), resumeLegnextImage: vi.fn() }));
vi.mock('./legnextImage', async actual => ({ ...await actual<typeof import('./legnextImage')>(), ...mj }));
const { storyAgentRouter } = await import('../routers/storyAgent');
const { createStory, updateStory } = await import('../repositories/stories');
const { createGeneratedImage, getStoryGeneratedImages } = await import('../repositories/images');
const { resetMemoryStateForTesting } = await import('../repositories/runtime');
function caller(userId = 123) {
  return storyAgentRouter.createCaller({ user: { id: userId, openId: `user-${userId}`, email: null, name: 'Test', role: 'user', loginMethod: 'manus', createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: 'https', headers: {} }, res: {} } as TrpcContext);
}
beforeEach(() => { resetMemoryStateForTesting(); vi.clearAllMocks(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('unexpected network'); })); });
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const story = await createStory({ userId: 123, title: 'two images', body: {} });
  const images = await Promise.all([1, 2, 3].map(async n => createGeneratedImage({ storyId: story.id, userId: 123, imageUrl: await sourceFixture(n), isCurrent: false })));
  const plan = createChatImageEditPlan(images.map(image => ({ imageId: image.id, imageUrl: image.imageUrl, label: `${image.id}` })), '只调整树冠配色');
  plan.renderRoute = 'storyboard'; plan.images[0].copies = 3; plan.status = 'submitted'; plan.preserve = '严格保留飞机大小、位置、数量、形状和颜色';
  plan.images.forEach((image, i) => { image.role = i === 2 ? 'reference' : 'target'; image.purpose = '饱和度与颜色层次'; });
  const message = { id: 'plan', who: 's', timestamp: 1, imageEditPlan: plan, selectionQuote: { storyId: story.id, stableShotId: 's3' } };
  const precision = { ...message, id: 'precision', imageEditPlan: { ...plan, renderRoute: 'precision' } };
  await updateStory(story.id, 123, { body: { shots: [{ shotNo: 3, stableShotId: 's3' }], videoWorkflow: { keep: 'draft' }, messages: [message, precision] } });
  return { story, images, c: caller(), input: { storyId: story.id, imageEditPlanOutput: { planMessageId: 'plan', imageId: images[0].id, copy: 1 } } };
}

it('purchases one storyboard task per target with the approved references and restores every candidate', async () => {
  const { c, input, images, story } = await fixture();
  const read = () => c.chatImageEditBatch({ storyId: story.id, planMessageId: 'plan' });
  const quote = await read();
  expect(quote.items).toHaveLength(2);
  expect(quote.unitEstimatedCny).toBe(0.68);
  expect(quote.remainingEstimatedCny).toBe(1.36);
  expect(await c.generateForMobile({ ...input, costConfirmation: { accepted: true, estimatedCny: 1.43 } })).toMatchObject({ status: 'error' });
  expect(mj.generateLegnextImage).not.toHaveBeenCalled();
  mj.generateLegnextImage.mockImplementation(async (_text, accept) => {
    await accept('legnext:fixture');
    return { status: 'error', providerTaskId: 'legnext:fixture', message: 'pending' };
  });
  const confirmed = { ...input, costConfirmation: { accepted: true as const, estimatedCny: quote.unitEstimatedCny } };
  await c.generateForMobile(confirmed);
  expect(mj.generateLegnextImage).toHaveBeenCalledTimes(1);
  const [prompt, , options] = mj.generateLegnextImage.mock.calls[0];
  expect(prompt).toContain('只调整树冠配色');
  expect(prompt).toContain('飞机大小、位置、数量、形状和颜色');
  expect(options).toMatchObject({ referenceImageUrl: images[0].imageUrl, referenceContextImageUrls: images.slice(1).map(i => i.imageUrl), aspectRatio: '960:960', inlinePoll: false });
  expect(provider.editImage).not.toHaveBeenCalled();
  const candidates = Array.from({ length: 4 }, (_, i) => ({ imageUrl: 'https://example.com/results/'+i+'.png', imageKey: 'results/'+i }));
  mj.resumeLegnextImage.mockResolvedValue({ status: 'ok', ...candidates[0], candidates });
  await c.recoverStoryboardImage({storyId: story.id, requestId: quote.items[0].requestId});
  const result = (await read()).items[0];
  expect(result.candidates?.map(i => i.imageUrl)).toEqual(candidates.map(i => i.imageUrl));
  expect(await c.generateForMobile(confirmed)).toMatchObject({ status: 'ok', candidates: result.candidates });
  expect((await getStoryGeneratedImages(story.id, 123)).every(i => !i.isCurrent)).toBe(true);
  expect(mj.generateLegnextImage).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('delivers the same approved brief, base and ordered reference images to either provider', async () => {
  const { c, input, story } = await fixture();
  mj.generateLegnextImage.mockResolvedValue({ status: 'error', message: 'provider fixture' });
  provider.editImage.mockResolvedValue({ status: 'error', message: 'provider fixture' });
  for (const planMessageId of ['plan', 'precision']) {
    const quote = await c.chatImageEditBatch({ storyId: story.id, planMessageId });
    await c.generateForMobile({ ...input, imageEditPlanOutput: { ...input.imageEditPlanOutput, planMessageId },
      costConfirmation: { accepted: true, estimatedCny: quote.unitEstimatedCny } });
  }
  const [mjPrompt, , mjInputs] = mj.generateLegnextImage.mock.calls[0];
  const [base, precisionPrompt, precisionInputs] = provider.editImage.mock.calls[0];
  expect(mjPrompt).toBe(precisionPrompt);
  expect(mjPrompt).toContain("leading part toward its named target");
  expect(mjPrompt).toContain("material rendering and brush strokes");
  expect(mjInputs.referenceImageUrl).toBe(base);
  expect(mjInputs.referenceContextImageUrls).toEqual(precisionInputs.referenceContextImageUrls);
  expect(mjInputs.characterRef).toBeUndefined();
  expect(mjInputs.styleRef).toBeUndefined();
});

it("reports unreadable source pixels as not submitted before either supplier is called", async()=>{
  const {c,input,story,images}=await fixture();
  const inaccessible=await createGeneratedImage({storyId:story.id,userId:123,imageUrl:"data:image/png;base64,AAAA",isCurrent:false});
  const {getStoryById}=await import("../repositories/stories");
  const snapshot=(await getStoryById(story.id,123))!.body as any;
  const msg=snapshot.messages.find((m:any)=>m.id==="plan");
  msg.imageEditPlan.images[0].imageId=inaccessible.id;
  await updateStory(story.id,123,{body:snapshot});
  const out=await c.generateForMobile({...input,imageEditPlanOutput:{...input.imageEditPlanOutput,imageId:inaccessible.id},costConfirmation:{accepted:true,estimatedCny:0.68}});
  expect(out).toMatchObject({status:"error",error:expect.stringContaining("未提交生成")});
  expect(out).not.toMatchObject({submissionUncertain:true});
  expect(mj.generateLegnextImage).not.toHaveBeenCalled();expect(provider.editImage).not.toHaveBeenCalled();
  expect((await c.chatImageEditBatch({storyId:story.id,planMessageId:"plan"})).items[0].status).toBe("failed");
  expect(await c.visualUnderstanding.sourceFrames({storyId:story.id,imageIds:[images[0].id]})).toMatchObject([{imageId:images[0].id,summary:expect.stringContaining("16×16")}]);
  await expect(caller(124).visualUnderstanding.sourceFrames({storyId:story.id,imageIds:[images[0].id]})).rejects.toThrow();
});
