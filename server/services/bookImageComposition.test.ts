import { beforeEach, expect, it, vi } from 'vitest';
import type { BookModuleImageTask } from '../../shared/bookModuleImageTask';
const fixture = vi.hoisted(()=>({ tasks:[] as BookModuleImageTask[], images:[] as any[], owner:true, body:'![图片](/api/images/a.png)\n原图风格', tail:Promise.resolve() as Promise<unknown>, edit:vi.fn(), generate:vi.fn(), resume:vi.fn(), reserve:vi.fn(), settle:vi.fn() }));
vi.mock('../repositories/stories',()=>({getStoryById:async()=>fixture.owner?{body:{bookModuleImageTasks:structuredClone(fixture.tasks)}}:null}));
vi.mock('../repositories/chapters',()=>({getChapter:async()=>({storyId:1,blocks:{body:fixture.body,writingStyle:[{id:'i'},{id:'t'}]}})}));
vi.mock('../repositories/bookModuleImageTasks',()=>({
  moduleImageTasks:(body:any)=>structuredClone(body.bookModuleImageTasks),
  mutateModuleImageTasks:async (_owner:any, update:any)=>{
    const work = fixture.tail.then(async()=>{
      const tasks=structuredClone(fixture.tasks);
      const result=await update(tasks,async(images:any[])=>images.map(image=>{fixture.images.push(image);return{imageId:fixture.images.length,imageUrl:image.imageUrl};}));
      fixture.tasks=tasks; return structuredClone(result);
    });
    fixture.tail=work.catch(()=>{});return work;
  }
}));
vi.mock('./imageAssets',()=>({getStoryImageAssets:async()=>[{imageUrl:'/api/images/a.png',availability:'available'}]}));
vi.mock('./imageGen',()=>({editImage:fixture.edit,generateImage:fixture.generate,resume302GptImageTask:fixture.resume}));
vi.mock('./mediaComputeBilling',()=>({mediaBillingEnabled:()=>true}));
vi.mock('./publishingCoverBilling',()=>({reservePublishingCoverRender:fixture.reserve,publishingCoverOperationId:()=> 'billing-test',finishPublishingCoverBilling:fixture.settle}));
import { generateBookImageComposition, refreshBookImageComposition, listBookImageCompositions } from './bookImageComposition';
import { compositionQuote } from '../../shared/bookImageComposition';
const sources=[{id:'i',text:'![图片](/api/images/a.png)'},{id:'t',text:'原图风格'}];
const target={userId:2,storyId:1,chapterId:3,moduleIds:['i','t']};
const input=()=>({...target,sources,instruction:'整合两块',previousTaskId:null,estimatedCny:compositionQuote(sources,['整合两块'],false)});
beforeEach(()=>{
  vi.clearAllMocks(); fixture.tasks=[]; fixture.images=[]; fixture.owner=true;fixture.body='![图片](/api/images/a.png)\n原图风格';fixture.tail=Promise.resolve();
  fixture.reserve.mockResolvedValue({billed:true,replayed:false});fixture.settle.mockResolvedValue({});
  fixture.edit.mockImplementation(async(_url,_prompt,options)=>{await options.onProviderTaskAccepted('receipt'); return {status:'error',providerTaskId:'receipt',message:'排队中'};});
  fixture.resume.mockResolvedValue({status:'ok',imageUrl:'/new.png',imageKey:'new'});
});
it('claims once across concurrent confirmations and reopens the same accepted task',async()=>{
  const [a,b]=await Promise.all([generateBookImageComposition(input()),generateBookImageComposition(input())]);
  expect(a.id).toBe(b.id);expect(fixture.edit).toHaveBeenCalledOnce();expect(fixture.reserve).toHaveBeenCalledOnce();
  await generateBookImageComposition(input());expect(fixture.edit).toHaveBeenCalledOnce();
  expect(fixture.edit.mock.calls[0][2]).toMatchObject({gptImageModel:'gpt-image-2.5-sunburst',gptSubmitOnly:true,preferStructuralEdit:true});
});
it('lists every composition version in stable order, with timestamps and owner checks, without submitting work',async()=>{
 await generateBookImageComposition(input());const first=(await refreshBookImageComposition(target))!;
 await generateBookImageComposition({...input(),previousTaskId:first.id,instruction:'减弱阴影',estimatedCny:compositionQuote(sources,['整合两块','减弱阴影'],true)});
 fixture.tasks.push({id:'ordinary-module',chapterId:3,moduleId:'text',requestId:'ordinary',sourceHash:'h',provider:'gpt-image',candidates:[],status:'succeeded'});
 const records=await listBookImageCompositions(target);
 expect(records.map(r=>r.version)).toEqual([1,2]);expect(records[0].createdAt).toEqual(expect.any(Number));
 expect(records[0].composition?.instructions).toEqual(['整合两块']);expect(records[1].composition?.instructions).toEqual(['整合两块','减弱阴影']);
 expect(fixture.edit).toHaveBeenCalledTimes(2);
 fixture.owner=false;await expect(listBookImageCompositions(target)).rejects.toThrow('无权访问');
});
it('recovers by GET only and inserts a single warehouse asset',async()=>{
  await generateBookImageComposition(input());
  const [a,b]=await Promise.all([refreshBookImageComposition(target),refreshBookImageComposition(target)]);
  expect(a?.status).toBe('succeeded');expect(b?.id).toBe(a?.id);expect(fixture.images).toHaveLength(1);
  expect(fixture.edit).toHaveBeenCalledOnce();expect(fixture.resume).toHaveBeenCalledOnce();
  expect(fixture.settle).toHaveBeenCalledWith('billing-test','succeeded');
});
it('retains an unknown submission and refuses a new paid request',async()=>{
  fixture.edit.mockRejectedValueOnce(new Error('connection lost'));
  const task=await generateBookImageComposition(input());expect(task.status).toBe('unknown');
  await generateBookImageComposition({...input(),previousTaskId:task.id});
  expect(fixture.edit).toHaveBeenCalledOnce();expect(fixture.settle).toHaveBeenCalledWith('billing-test','uncertain');
});
it('uses original references plus the completed image for the next revision',async()=>{
  await generateBookImageComposition(input());const prior=(await refreshBookImageComposition(target))!;
  await generateBookImageComposition({...input(),previousTaskId:prior.id,instruction:'去掉阴影',estimatedCny:compositionQuote(sources,['整合两块','去掉阴影'],true)});
  const [url,prompt,options]=fixture.edit.mock.calls[1];expect(url).toBe('/new.png');expect(options.referenceContextImageUrls).toEqual(['/api/images/a.png']);expect(prompt).toContain('整合两块');expect(prompt).toContain('去掉阴影');
});
it('does not reserve or call the provider for stale source, wrong owner, or wrong quote',async()=>{
  fixture.body='![图片](/api/images/a.png)\n已修改';await expect(generateBookImageComposition(input())).rejects.toThrow('已变化');
  fixture.owner=false;await expect(generateBookImageComposition(input())).rejects.toThrow('无权访问');fixture.owner=true;
  fixture.body='![图片](/api/images/a.png)\n原图风格';await expect(generateBookImageComposition({...input(),estimatedCny:0.01})).rejects.toThrow('费用');
  expect(fixture.reserve).not.toHaveBeenCalled();expect(fixture.edit).not.toHaveBeenCalled();
});
it('stores candidates even after the original source changes during processing',async()=>{
  await generateBookImageComposition(input());fixture.body='changed';
  expect((await refreshBookImageComposition(target))?.status).toBe('succeeded');expect(fixture.images).toHaveLength(1);
});
it('releases the reservation only on a provider-confirmed task failure',async()=>{
  await generateBookImageComposition(input());fixture.resume.mockResolvedValueOnce({status:'error',providerTaskId:'receipt',providerConfirmedFailure:true,message:'模型拒绝'});
  expect((await refreshBookImageComposition(target))?.status).toBe('failed');expect(fixture.settle).toHaveBeenCalledWith('billing-test','definite_failure');
});
it('rejects a too-long brief before reservation rather than truncating the user requirements',async()=>{
  const long='文'.repeat(12000);fixture.body=`![图片](/api/images/a.png)\n${long}`;
  const selected=[sources[0],{id:'t',text:long}];
  await expect(generateBookImageComposition({...input(),sources:selected,estimatedCny:compositionQuote(selected,['整合两块'],false)})).rejects.toThrow('不会截断');
  expect(fixture.reserve).not.toHaveBeenCalled();
});
