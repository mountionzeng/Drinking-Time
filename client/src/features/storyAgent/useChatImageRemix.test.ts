import { beforeEach, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({slots:[] as any[],cursor:0,effects:[] as Array<()=>void>,generate:vi.fn(),invalidate:vi.fn(),recover:vi.fn()}));
vi.mock('react',()=>({
  useState:(initial:any)=>{const i=m.cursor++;if(!(i in m.slots))m.slots[i]=initial;return [m.slots[i],(value:any)=>{m.slots[i]=typeof value==='function'?value(m.slots[i]):value;}];},
  useRef:(initial:any)=>{const i=m.cursor++;return m.slots[i]??(m.slots[i]={current:initial});},
  useCallback:(fn:any)=>fn,
  useEffect:(fn:()=>void,deps:any[])=>{const i=m.cursor++;if(JSON.stringify(m.slots[i])!==JSON.stringify(deps)){m.slots[i]=deps;m.effects.push(fn);}},
}));
vi.mock('@/lib/trpc',()=>({trpc:{storyAgent:{generateForMobile:{useMutation:()=>({mutateAsync:m.generate})}},useUtils:()=>({storyAgent:{storyMaterialState:{invalidate:m.invalidate},chatImageRevisions:{invalidate:m.invalidate}},client:{storyAgent:{recoverChatImageRemix:{mutate:m.recover}}}})}}));
vi.mock('./chatImageRefsStore',()=>({useChatImageRefs:()=>[],chatImageRefsStore:{getState:()=>({clear:vi.fn()})}}));
vi.mock('sonner',()=>({toast:{error:vi.fn()}}));
import { useChatImageRemix } from './useChatImageRemix';
function render(storyId=7){m.cursor=0;const api=useChatImageRemix(storyId);m.effects.splice(0).forEach(fn=>fn());return api;}
const refs=[{imageId:2110,imageUrl:'/2110.png',label:'图A'},{imageId:2109,imageUrl:'/2109.png',label:'图B'}];
beforeEach(()=>{m.slots=[];m.cursor=0;m.effects=[];vi.clearAllMocks();});
it('only prepares a quote; explicit confirmation sends exact ordered references once',async()=>{
  let finish!:(value:any)=>void;m.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  render().arm('修改图1的云，保留图2的树',refs);let api=render();expect(api.status).toBe('confirming');expect(m.generate).not.toHaveBeenCalled();
  const first=api.confirm();await api.confirm();expect(m.generate).toHaveBeenCalledTimes(1);
  expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({storyId:7,referenceImageUrl:'/2110.png',referenceContextImageUrls:['/2109.png'],explicitInstruction:'修改图1的云，保留图2的树',costConfirmation:expect.objectContaining({accepted:true})}));
  finish({status:'ok',imageId:2222,imageUrl:'/result.png'});await first;expect(render().status).toBe('done');
});
it('cancel and story switches never reuse the previous quote authorization',async()=>{
  render().arm('修改云',refs);let old=render();old.cancel();await render().confirm();expect(m.generate).not.toHaveBeenCalled();
  render().arm('修改树',refs);old=render();render(8);await old.confirm();expect(m.generate).not.toHaveBeenCalled();expect(render(8).draft).toBeNull();
});
it('a late result from another story cannot overwrite the current conversation',async()=>{
  let finish!:(value:any)=>void;m.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  render().arm('修改云',refs);const pending=render().confirm();render(8);
  finish({status:'ok',imageId:2222,imageUrl:'/result.png'});await pending;
  expect(render(8).result).toBeNull();expect(m.invalidate).not.toHaveBeenCalled();
});

it('binds the saved candidate to the captured conversation shot without adopting', async()=>{
  m.generate.mockResolvedValue({status:'ok',imageId:2117,imageUrl:'/2117'});
  render().arm('云更白',refs,{stableShotId:'s3',shotNo:3});await render().confirm();
  expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({conversationShotId:'s3'}));
  expect(render().result).toMatchObject({target:{stableShotId:'s3'},sourceImageIds:[2110,2109]});
});
it('recovers an existing result without invoking generation',async()=>{
  m.recover.mockResolvedValue({imageId:2117,imageUrl:'/2117',stableShotId:'s3',shotNo:3,sourceImageIds:[2110]});
  await render().restore('quote');expect(render().result?.imageId).toBe(2117);expect(m.generate).not.toHaveBeenCalled();
});
it('a late recovery cannot replace a newly prepared quote or a different story',async()=>{
  let finish!:(value:any)=>void;m.recover.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=render().restore('old');render().arm('更嫩',refs);finish({imageId:2117});await pending;
  expect(render().status).toBe('confirming');expect(render().result).toBeNull();
  const second=render().restore('old');render(8);finish({imageId:2117});await second;expect(render(8).result).toBeNull();
});
it('recovery ambiguity is shown and never retried as a generation',async()=>{
  m.recover.mockRejectedValue(new Error('多个已保存候选'));await render().restore('quote');
  expect(render().status).toBe('error');expect(render().error).toContain('多个已保存候选');expect(m.generate).not.toHaveBeenCalled();
});

it('follows a persisted single quote after a transient read failure, never repeats the paid call', async () => {
  vi.useFakeTimers();
  m.generate.mockResolvedValue({status:'error',providerTaskId:'receipt',recoveryPending:true});
  m.recover.mockResolvedValueOnce({pending:true,recoverable:true,startedAt:Date.now(),error:'temporary drop'})
    .mockResolvedValueOnce({imageId:2222,imageUrl:'/result.png',stableShotId:'s3',shotNo:3,sourceImageIds:[2110],instruction:'云更白'});
  render().arm('云更白',refs,{stableShotId:'s3',shotNo:3});
  const promise=render().confirm('saved-quote');
  await vi.advanceTimersByTimeAsync(2000);await promise;
  expect(m.generate).toHaveBeenCalledTimes(1);
  expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({chatImageRemixQuoteId:'saved-quote'}));
  expect(m.recover).toHaveBeenCalledTimes(2);expect(render().result?.imageId).toBe(2222);
  vi.useRealTimers();
});
it('stops bounded watching with an explicit same-task recovery action', async () => {
  vi.useFakeTimers();
  m.recover.mockResolvedValue({pending:true,recoverable:true,error:'waiting'});
  const promise=render().restore('persisted-quote');
  await vi.advanceTimersByTimeAsync(24000);await promise;
  expect(render().status).toBe('pending');expect(render().recoveryQuoteId).toBe('persisted-quote');
  expect(m.generate).not.toHaveBeenCalled();expect(m.recover).toHaveBeenCalledTimes(12);
  vi.useRealTimers();
});

it('stops a rejected quote conflict without querying or purchasing again',async()=>{
  m.generate.mockRejectedValue(new Error('原要求或原图不可用，请重新核对'));
  render().arm('只改云',refs);await render().confirm('conflicting-quote');
  expect(render().status).toBe('error');expect(m.recover).not.toHaveBeenCalled();
  expect(m.generate).toHaveBeenCalledTimes(1);
});
