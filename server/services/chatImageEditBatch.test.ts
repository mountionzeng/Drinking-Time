import { beforeEach, expect, it } from 'vitest';
process.env.DATABASE_URL = '';
import { resetMemoryStateForTesting } from '../repositories/runtime';
import { createStory, getStoryById, updateStory } from '../repositories/stories';
import { createGeneratedImage } from '../repositories/images';
import { createChatImageEditPlan, imageEditPlanOutput, adjustedImageEditPlanId } from '../../shared/chatImageEditPlan';
import { inlineImageToken } from '../../shared/inlineChatImages';
import { readChatImageEditBatch, imageEditBatchRequestId } from './chatImageEditBatch';
beforeEach(() => resetMemoryStateForTesting());
async function fixture() {
  const story = await createStory({ userId: 123, title: '两图', body: {} });
  const images = await Promise.all([1, 2, 3].map(n => createGeneratedImage({ storyId: story.id, userId: 123, imageUrl: `/${n}.png`, isCurrent: n === 1 })));
  const plan = createChatImageEditPlan(images.map(image => ({ imageId: image.id, imageUrl: image.imageUrl, label: `#${image.id}` })), '仅修改森林配色');
  plan.status = 'submitted'; plan.preserve = '飞机大小、位置、数量、形状和颜色';
  plan.images.forEach((ref, i) => { ref.role = i === 2 ? 'reference' : 'target'; ref.purpose = i === 2 ? '饱和度、颜色分布和层次' : '保留构图'; });
  const body: Record<string, any> = { shots: [{ stableShotId: 's3', shotNo: 3 }], videoWorkflow: { draft: 'keep' },
    messages: [{ id: 'plan', who: 's', timestamp: 1, imageEditPlan: plan, selectionQuote: { storyId: story.id, stableShotId: 's3' } }] };
  await updateStory(story.id, 123, { body });
  return { story, images, plan, body, input: { storyId: story.id, userId: 123, planMessageId: 'plan' } };
}
it('prepares both original bases with common references, stable identities and no writes', async () => {
  const f = await fixture(); const before = await getStoryById(f.story.id, 123);
  const batch = await readChatImageEditBatch(f.input);
  expect(batch.items.map(item => item.request.referenceImageUrl)).toEqual(['/1.png', '/2.png']);
  expect(batch.items.map(item => item.request.referenceContextImageUrls)).toEqual([['/2.png', '/3.png'], ['/1.png', '/3.png']]);
  expect(batch.items.every(item => item.request.explicitInstruction.includes('飞机大小、位置、数量、形状和颜色'))).toBe(true);
  expect(batch.remainingEstimatedCny).toBe(batch.unitEstimatedCny * 2);
  expect(new Set(batch.items.map(item => item.requestId)).size).toBe(2);
  expect(await readChatImageEditBatch(f.input)).toEqual(batch);
  expect(await getStoryById(f.story.id, 123)).toEqual(before);
});
it('reuses a completed legacy output and quotes only its unfinished sibling', async () => {
  const f = await fixture(); const output = imageEditPlanOutput(f.plan, f.images[0].id, 1);
  f.body.messages.push({ id: 'user', who: 'u', text: output.refs.map(ref => inlineImageToken(ref.imageId)).join(' ') + '\n' + output.instruction, timestamp: 2 },
    { id: 'quote', who: 's', text: '已收到 3 张引用，仅修改第一张', timestamp: 3, selectionQuote: { storyId: f.story.id, stableShotId: 's3' } });
  await updateStory(f.story.id, 123, { body: f.body });
  expect((await readChatImageEditBatch(f.input)).items[0].status).toBe('unknown');
  const image = await createGeneratedImage({ storyId: f.story.id, userId: 123, imageUrl: '/done.png', generationType: 'inpaint', prompt: `gateway\n${output.instruction}`, isCurrent: false });
  const batch = await readChatImageEditBatch(f.input);
  expect(batch.items[0]).toMatchObject({ status: 'done', result: { imageId: image.id } });
  expect(batch.items[1].status).toBe('ready'); expect(batch.remainingEstimatedCny).toBe(batch.unitEstimatedCny);
  await createGeneratedImage({ storyId: f.story.id, userId: 123, imageUrl: '/duplicate.png', generationType: 'inpaint', prompt: output.instruction, isCurrent: false });
  await expect(readChatImageEditBatch(f.input)).rejects.toThrow('多个候选');
});
it.each(['pending', 'unknown', 'failed'] as const)('keeps %s receipts out of the purchasable quote', async status => {
  const f = await fixture(); const requestId = imageEditBatchRequestId(f.story.id, 'plan', f.images[0].id, 1);
  f.body.storyboardImageTasks = [{ requestId, shotIdentity: 's3', status: status === 'pending' ? 'accepted' : status, providerTaskId: status === 'pending' ? 'receipt' : undefined, result: { status: 'error', error: '保留原任务' } }];
  await updateStory(f.story.id, 123, { body: f.body });
  const batch = await readChatImageEditBatch(f.input);
  expect(batch.items[0].status).toBe(status); expect(batch.remainingEstimatedCny).toBe(batch.unitEstimatedCny);
});
it('rejects foreign ownership, changed plans, missing references and stale shot identities', async () => {
  const f = await fixture(); await expect(readChatImageEditBatch({ ...f.input, userId: 124 })).rejects.toThrow();
  f.body.messages.push({ id: adjustedImageEditPlanId('plan') }); await updateStory(f.story.id, 123, { body: f.body });
  await expect(readChatImageEditBatch(f.input)).rejects.toThrow('调整');
  f.body.messages.pop(); f.body.shots = []; await updateStory(f.story.id, 123, { body: f.body });
  await expect(readChatImageEditBatch(f.input)).rejects.toThrow('镜头');
  f.body.shots = [{ stableShotId: 's3', shotNo: 3 }]; f.plan.images[0].imageId = 999999;
  await updateStory(f.story.id, 123, { body: f.body }); await expect(readChatImageEditBatch(f.input)).rejects.toThrow('不可用');
});

it('prepares a full board in review order, reading only one base plus its style reference per request', async () => {
  const f = await fixture();
  for (let n=4;n<=6;n++) f.images.push(await createGeneratedImage({storyId:f.story.id,userId:123,imageUrl:'/'+n+'.png',isCurrent:false}));
  const boardId='saved-photos:board';
  const plan={...f.plan,keyframeBoardId:boardId,images:f.images.map((image,i)=>({
    imageId:image.id,imageUrl:image.imageUrl,label:'source',copies:1,role:i===5?'reference':'target',purpose:i===5?'背景层次':'柔化受光交界',
  }))};
  const review={id:boardId,who:'s',text:'关键帧初稿（5 张）\n'+plan.images.slice(0,5).map(i=>inlineImageToken(i.imageId)).join('\n'),selectionQuote:f.body.messages[0].selectionQuote};
  const receipt={who:'u',text:plan.images.map(i=>inlineImageToken(i.imageId)).join(' ')};
  f.body.messages=[review,receipt,{...f.body.messages[0],imageEditPlan:plan}];
  await updateStory(f.story.id,123,{body:f.body});
  const before=await getStoryById(f.story.id,123);
  const batch=await readChatImageEditBatch(f.input);
  expect(batch.items.map(i=>i.request.referenceImageUrl)).toEqual(['/1.png','/2.png','/3.png','/4.png','/5.png']);
  expect(batch.items.every(i=>i.status==='ready' && i.request.referenceContextImageUrls.join()==='/6.png')).toBe(true);
  expect(batch.items.every(i=>i.request.prompt.includes('contact shadows'))).toBe(true);
  expect(batch.remainingEstimatedCny).toBeCloseTo(7.15);
  expect(await getStoryById(f.story.id,123)).toEqual(before);
  f.body.messages[0]={...review,selectionQuote:{...review.selectionQuote,stableShotId:'other'}};
  await updateStory(f.story.id,123,{body:f.body});
  await expect(readChatImageEditBatch(f.input)).rejects.toThrow('审图记录');
});
it('blocks a stale tab confirming an older quote after the draft was superseded',async()=>{
 const f=await fixture();f.body.messages[0].id='image-edit-confirmed:old';
 f.body.messages.push({id:adjustedImageEditPlanId('old')});
 await updateStory(f.story.id,123,{body:f.body});
 await expect(readChatImageEditBatch({...f.input,planMessageId:'image-edit-confirmed:old'})).rejects.toThrow('新的修改范围');
});

it('only prepares checked region matches and requires the entire original ordered board',async()=>{
 const f=await fixture();const boardId='saved-photos:region-test';
 const ids=f.images.map(i=>i.id);
 const rect={top:.1,bottom:.3,left:.2,right:.4};
 const plan={...f.plan,keyframeBoardId:boardId,regionScanSourceId:ids[0],images:f.plan.images.map((row,i)=>({...row,role:i===1?'omit':'target',region:i===1?undefined:rect}))};
 const review={id:boardId,who:'s',text:'关键帧修订稿 '+ids.map(inlineImageToken).join(' '),selectionQuote:f.body.messages[0].selectionQuote};
 f.body.messages=[review,{...f.body.messages[0],imageEditPlan:plan}];
 await updateStory(f.story.id,123,{body:f.body});
 const batch=await readChatImageEditBatch(f.input);
 expect(batch.items.map(i=>i.imageId)).toEqual([ids[0],ids[2]]);
 expect(batch.items.every(i=>i.request.explicitInstruction.includes('x 20%–40%'))).toBe(true);
 f.body.messages[0]={...review,text:'关键帧修订稿 '+[ids[0],ids[2]].map(inlineImageToken).join(' ')};
 await updateStory(f.story.id,123,{body:f.body});
 await expect(readChatImageEditBatch(f.input)).rejects.toThrow('审图记录');
});
