import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({translate:vi.fn(),describe:vi.fn(),image:vi.fn(),recover:vi.fn(),refetch:vi.fn(),task:null as any,taskLoading:false,taskError:null as unknown,music:vi.fn(),price:vi.fn(),invalidate:vi.fn(),states:[] as any[],index:0,refs:[] as any[],ref:0,queryOptions:null as any}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useEffect:(fn:any)=>fn(),useRef:(v:any)=>m.refs[m.ref++]??(m.refs[m.ref-1]={current:v}),useState:(v:any)=>{const i=m.index++;if(!(i in m.states))m.states[i]=v;return [m.states[i],(n:any)=>m.states[i]=n];}}));
vi.mock('@/lib/trpc',()=>({trpc:{bookMedia:{translate:{useMutation:()=>({mutateAsync:m.translate})},quoteNarration:{useMutation:()=>({mutateAsync:m.price})},describe:{useMutation:()=>({mutateAsync:m.describe})}},storyAgent:{generateForMobile:{useMutation:()=>({mutateAsync:m.image})},bookModuleImageTask:{useQuery:(_i:any,o:any)=>(m.queryOptions=o,{data:m.task,isLoading:m.taskLoading,isFetching:false,error:m.taskError,refetch:m.refetch})},recoverBookModuleImage:{useMutation:()=>({mutateAsync:m.recover})}},timelineMedia:{generateNarrationCandidate:{useMutation:()=>({mutateAsync:m.music})},quoteSceneAudio:{useMutation:()=>({mutateAsync:m.price})},generateSceneAudio:{useMutation:()=>({mutateAsync:m.music})}},useUtils:()=>({memoryWarehouse:{forStory:{invalidate:m.invalidate}},storyAgent:{storyMaterialState:{invalidate:m.invalidate}},timelineMedia:{audioAssetLibrary:{invalidate:m.invalidate}}})}}));
import {BookModuleConvert} from './BookModuleConvert';
function nodes(n:any):any[]{return !n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];}
beforeEach(()=>{vi.clearAllMocks();m.states=[];m.refs=[];m.index=0;m.ref=0;m.task=null;m.taskLoading=false;m.taskError=null;vi.stubGlobal('React',React);m.invalidate.mockResolvedValue(undefined);m.refetch.mockResolvedValue(undefined);});
async function settle(){for(let i=0;i<15;i++)await Promise.resolve();}
it('reopens an accepted task with recovery instead of a second purchase and inserts its result',async()=>{
 const props={source:{id:'x',text:'纸船',kind:'image' as const},storyId:1,chapterId:2,prepare:vi.fn(),onInsert:vi.fn(),onClose:vi.fn()};
 m.task={id:'task',status:'accepted',providerTaskId:'paid',inserted:false,sourceChanged:false};
 const tree=nodes(BookModuleConvert(props));
 expect(tree.some(n=>n.type==='button'&&String(n.props.children).startsWith('生成图片（'))).toBe(false);
 m.recover.mockResolvedValue({status:'ok',imageUrl:'/api/images/recovered.png',candidates:[{imageUrl:'/api/images/recovered.png',imageId:1}]});
 tree.find(n=>n.type==='button'&&n.props.children==='恢复上次生成').props.onClick();await settle();
 expect(m.recover).toHaveBeenCalledWith({storyId:1,chapterId:2,moduleId:'x'});
 expect(props.onInsert).toHaveBeenCalledTimes(1);expect(props.onInsert).toHaveBeenCalledWith('![图片](/api/images/recovered.png)');
 expect(m.image).not.toHaveBeenCalled();expect(props.prepare).not.toHaveBeenCalled();
});
it.each(['loading','failed'])('blocks new purchases when the durable task lookup is %s',state=>{
 m.taskLoading=state==='loading';m.taskError=state==='failed'?new Error('offline'):null;
 const tree=nodes(BookModuleConvert({source:{id:'x',text:'纸船',kind:'image'},storyId:1,chapterId:2,prepare:vi.fn(),onInsert:vi.fn(),onClose:vi.fn()}));
 expect(tree.some(n=>n.type==='button'&&String(n.props.children).startsWith('生成图片（'))).toBe(false);
 expect(m.image).not.toHaveBeenCalled();
});
it('keeps recovered candidates in the warehouse when the source module changed',async()=>{
 m.task={status:'accepted',inserted:false,sourceChanged:true};
 m.recover.mockResolvedValue({status:'ok',imageUrl:'/api/images/recovered.png',candidates:[{imageUrl:'/api/images/recovered.png',imageId:1}]});
 const insert=vi.fn();
 nodes(BookModuleConvert({source:{id:'x',text:'改过的正文',kind:'image'},storyId:1,chapterId:2,prepare:vi.fn(),onInsert:insert,onClose:vi.fn()})).find(n=>n.type==='button').props.onClick();await settle();
 expect(insert).not.toHaveBeenCalled();expect(m.image).not.toHaveBeenCalled();
});
it('automatically inserts generated text without a second confirmation',async()=>{
 m.describe.mockResolvedValue({text:'图中的雨天'});const insert=vi.fn();
 const tree=BookModuleConvert({source:{id:'x',text:'图片',kind:'text'},storyId:1,chapterId:2,prepare:async()=>{},onInsert:insert,onClose:vi.fn()});
 nodes(tree).find(n=>n.type==='button'&&n.props.children==='生成文字').props.onClick();await settle();
 expect(insert).toHaveBeenCalledWith('图中的雨天');expect(m.invalidate).toHaveBeenCalledWith({storyId:1});
});
it('inserts the first generated image while retaining all candidates in the existing warehouse',async()=>{
 m.image.mockResolvedValue({status:'ok',candidates:[{imageUrl:'/api/images/a.png'},{imageUrl:'/api/images/b.png'}]});const insert=vi.fn();
 const tree=BookModuleConvert({source:{id:'x',text:'雨天',kind:'image'},storyId:1,chapterId:2,prepare:async()=>{},onInsert:insert,onClose:vi.fn()});
 nodes(tree).find(n=>n.type==='button').props.onClick();await settle();
 expect(insert).toHaveBeenCalledTimes(1);expect(insert).toHaveBeenCalledWith('![图片](/api/images/a.png)');
 expect(m.image.mock.calls[0][0].autoSelect).toBe(false);expect(m.invalidate).toHaveBeenCalled();
});
it('automatically inserts ready music and refreshes its library',async()=>{
 m.states=[false,'','', '',[],false,{quoteToken:'quote',estimatedCny:.3}];m.music.mockResolvedValue({status:'ready',assetId:7});const insert=vi.fn();
 const tree=BookModuleConvert({source:{id:'x',text:'雨天',kind:'music'},storyId:1,chapterId:2,prepare:async()=>{},onInsert:insert,onClose:vi.fn()});
 nodes(tree).filter(n=>n.type==='button')[1].props.onClick();await settle();
 expect(insert).toHaveBeenCalledWith(expect.stringContaining('/api/story-audio-asset/1/7'));expect(m.invalidate).toHaveBeenCalledWith({storyId:1});
});
it('inserts a completed audiobook with its classification and refreshes the audio library',async()=>{
 m.states=[false,'','', '',[],false,{quoteToken:'quote',estimatedCny:.02,subtitleCueId:'book-one'}];m.music.mockResolvedValue({status:'candidate-ready',candidate:{assetId:9}});const insert=vi.fn();
 const tree=BookModuleConvert({source:{id:'x',text:'照原文朗读',kind:'narration'},storyId:1,chapterId:2,prepare:async()=>{},onInsert:insert,onClose:vi.fn()});
 nodes(tree).filter(n=>n.type==='button')[1].props.onClick();await settle();
 expect(insert).toHaveBeenCalledWith(expect.stringMatching(/^!\[有声书:/));
 expect(m.music).toHaveBeenCalledWith(expect.objectContaining({subtitleCueId:'book-one',quoteToken:'quote'}));
});

it.each(['submission-unknown', 'pending'])('warns and prevents another submission in the dialog when narration is %s',async status=>{
 m.states=[false,'','', '',[],false,{quoteToken:'quote',estimatedCny:.12,subtitleCueId:'book-one'}];
 m.music.mockResolvedValue({status,message:'302 语音生成失败（HTTP 500）'});
 const props={source:{id:'x',text:'照原文朗读',kind:'narration' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 nodes(BookModuleConvert(props)).filter(n=>n.type==='button')[1].props.onClick();await settle();
 m.index=m.ref=0;const tree=nodes(BookModuleConvert(props));
 expect(tree.find(n=>n.props?.role==='alert').props.children.join('')).toContain('结果尚未确认');
 expect(tree.find(n=>n.type==='button'&&String(n.props.children).includes('确认按原文朗读')).props.disabled).toBe(true);
 expect(m.music).toHaveBeenCalledTimes(1);expect(props.onInsert).not.toHaveBeenCalled();
});

it('treats a lost narration response as an unconfirmed submission',async()=>{
 m.states=[false,'','', '',[],false,{quoteToken:'quote',estimatedCny:.12,subtitleCueId:'book-one'}];
 m.music.mockRejectedValue(new Error('connection lost'));
 const props={source:{id:'x',text:'照原文朗读',kind:'narration' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 nodes(BookModuleConvert(props)).filter(n=>n.type==='button')[1].props.onClick();await settle();
 m.index=m.ref=0;const tree=nodes(BookModuleConvert(props));
 expect(tree.find(n=>n.props?.role==='alert').props.children.join('')).toContain('结果尚未确认');
 expect(tree.find(n=>n.type==='button'&&String(n.props.children).includes('确认按原文朗读')).props.disabled).toBe(true);
 expect(m.music).toHaveBeenCalledTimes(1);expect(props.onInsert).not.toHaveBeenCalled();
});

it('shows rate limiting and restores the button only for a definite HTTP 429 rejection',async()=>{
 const props={source:{id:'x',text:'雨天',kind:'image' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 m.image.mockResolvedValue({status:'error',error:'302 Midjourney submit HTTP 429'});
 nodes(BookModuleConvert(props)).find(n=>n.type==='button').props.onClick();await settle();
 m.index=m.ref=0;const tree=BookModuleConvert(props);
 expect(nodes(tree).find(n=>n.props?.role==='alert').props.children).toContain('图片生成服务当前限流，本次未取得任务号，未扣出图算力。请稍后再试，原文字已保留。');
 expect(nodes(tree).some(n=>n.type==='button')).toBe(true);
 expect(m.image).toHaveBeenCalledTimes(1);expect(props.onInsert).not.toHaveBeenCalled();
});
it('does not offer resubmission when a provider task or uncertain submission exists',async()=>{
 const props={source:{id:'x',text:'雨天',kind:'image' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 m.image.mockResolvedValue({status:'error',error:'302 Midjourney submit HTTP 429',providerTaskId:'accepted'});
 nodes(BookModuleConvert(props)).find(n=>n.type==='button').props.onClick();await settle();
 m.index=m.ref=0;expect(nodes(BookModuleConvert(props)).some(n=>n.type==='button')).toBe(false);
 expect(m.image).toHaveBeenCalledTimes(1);
});

it('reports provider overload accurately and leaves the manuscript untouched',async()=>{
 const props={source:{id:'x',text:'雨天',kind:'image' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 m.image.mockResolvedValue({status:'error',error:'图片模型当前拥挤（上游过载），本次未生成，也未扣出图算力。请约 1 分钟后再试，或改用 GPT-image。',errorCode:'overloaded'});
 nodes(BookModuleConvert(props)).find(n=>n.type==='button').props.onClick();await settle();
 m.index=m.ref=0;const tree=BookModuleConvert(props);
 expect(nodes(tree).find(n=>n.props?.role==='alert').props.children).toContain('图片模型当前拥挤（上游过载），本次未生成，也未扣出图算力。请约 1 分钟后再试，或改用 GPT-image。原文字已保留。');
 expect(nodes(tree).some(n=>n.type==='button')).toBe(true);expect(m.image).toHaveBeenCalledTimes(1);expect(props.onInsert).not.toHaveBeenCalled();
});

it('offers an explicit GPT-image switch after a Midjourney overload without switching automatically',async()=>{
 const props={source:{id:'x',text:'雨天',kind:'image' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 m.image.mockResolvedValue({status:'error',error:'图片模型当前拥挤（上游过载），本次未生成，也未扣出图算力。',errorCode:'overloaded'});
 nodes(BookModuleConvert(props)).find(n=>n.type==='button').props.onClick();await settle();
 m.index=m.ref=0;let tree=nodes(BookModuleConvert(props));
 const gpt=tree.find(n=>n.type==='button'&&n.props.children==='改用 GPT-image');
 expect(gpt).toBeTruthy();expect(m.image).toHaveBeenCalledTimes(1);
 expect(tree.find(n=>n.type==='select').props.value).toBe('midjourney');
 gpt.props.onClick();m.index=m.ref=0;tree=nodes(BookModuleConvert(props));
 expect(tree.find(n=>n.type==='select').props.value).toBe('gpt-image');
 expect(tree.some(n=>n.type==='button'&&n.props.children==='改用 GPT-image')).toBe(false);
 expect(m.image).toHaveBeenCalledTimes(1);
});

it('inserts the English translation below the unchanged source, preserving newlines',async()=>{
 m.translate.mockResolvedValue({text:'First line\nSecond line'});
 const props={source:{id:'text-1',text:'第一行\n第二行',kind:'translate-en' as const},storyId:1,chapterId:2,prepare:vi.fn().mockResolvedValue(undefined),onInsert:vi.fn(),onClose:vi.fn()};
 const tree=BookModuleConvert(props);
 nodes(tree).find(n=>n.type==='button').props.onClick();await settle();
 expect(props.prepare).toHaveBeenCalledOnce();
 expect(m.translate).toHaveBeenCalledWith({storyId:1,chapterId:2,moduleId:'text-1',targetLanguage:'en',expectedText:'第一行\n第二行'});
 expect(props.onInsert).toHaveBeenCalledWith('First line\nSecond line');
 expect(props.source.text).toBe('第一行\n第二行');
});

it('uses GPT only after an explicit choice with its own single-image estimate', async()=>{
 const props={source:{id:'x',text:'蓝色纸船'.repeat(600),kind:'image' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 const initial=nodes(BookModuleConvert(props));
 expect(initial.find(n=>n.type==='select').props.value).toBe('midjourney');
 initial.find(n=>n.type==='select').props.onChange({target:{value:'gpt-image'}});
 expect(m.image).not.toHaveBeenCalled();
 m.index=m.ref=0;const selected=nodes(BookModuleConvert(props));
 expect(selected.find(n=>n.type==='button').props.children).toContain('GPT · 1张 · 预估');
 m.image.mockResolvedValue({status:'ok',imageUrl:'/api/images/gpt.png'});
 selected.find(n=>n.type==='button').props.onClick();await settle();
 expect(m.image).toHaveBeenCalledWith(expect.objectContaining({imageProvider:'gpt-image',gptImageModel:'gpt-image-2',mode:'final',autoSelect:false,prompt:expect.stringContaining('蓝色纸船'),costConfirmation:{accepted:true,estimatedCny:1.43}}));
 expect(m.image.mock.calls[0][0].prompt).toContain(props.source.text);
 expect(m.image.mock.calls[0][0].explicitInstruction.length).toBeLessThan(2000);
 expect(props.onInsert).toHaveBeenCalledWith('![图片](/api/images/gpt.png)');
});
it('locks the alternative model when the original submission outcome is unknown',async()=>{
 const props={source:{id:'x',text:'纸船',kind:'image' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 m.image.mockResolvedValue({status:'error',error:'连接中断',submissionUncertain:true});
 nodes(BookModuleConvert(props)).find(n=>n.type==='button').props.onClick();await settle();
 m.index=m.ref=0;expect(nodes(BookModuleConvert(props)).find(n=>n.type==='select').props.disabled).toBe(true);
 expect(m.image).toHaveBeenCalledOnce();
});

vi.mock("@/features/uiLanguage/UiLanguage", async (importOriginal) => {
 const actual = await importOriginal<typeof import("@/features/uiLanguage/UiLanguage")>();
 return {...actual, useUiText: () => (source: string, values?: readonly (string | number | null | undefined)[]) => actual.translateUi("zh", source, values)};
});

const imgProps=()=>({source:{id:'x',text:'纸船',kind:'image' as const},storyId:1,chapterId:2,prepare:vi.fn(),onInsert:vi.fn(),onClose:vi.fn()});
it('polls a running task every few seconds and stops after ~10 minutes or when finished',()=>{
 m.task={id:'t',status:'accepted',providerTaskId:'p',inserted:false,sourceChanged:false,candidates:[]};
 BookModuleConvert(imgProps());
 const every=m.queryOptions.refetchInterval;
 vi.useFakeTimers();vi.setSystemTime(0);
 expect(every({state:{data:{status:'accepted'}}})).toBe(6000);
 vi.setSystemTime(11*60_000);
 expect(every({state:{data:{status:'accepted'}}})).toBe(false);
 expect(every({state:{data:{status:'succeeded'}}})).toBe(false);
 vi.useRealTimers();
});
it('shows and inserts the image once when a polled task finishes, without a new purchase',()=>{
 const props=imgProps();
 m.task={id:'t',status:'accepted',providerTaskId:'p',inserted:false,sourceChanged:false,candidates:[]};
 BookModuleConvert(props);
 m.index=0;m.ref=0;
 m.task={...m.task,status:'succeeded',candidates:[{imageUrl:'/api/images/done.png',imageId:3}]};
 BookModuleConvert(props);
 expect(props.onInsert).toHaveBeenCalledTimes(1);expect(props.onInsert).toHaveBeenCalledWith('![图片](/api/images/done.png)');
 expect(m.image).not.toHaveBeenCalled();
});
it('turns a 504/HTML gateway reply into a readable message and keeps following the task',async()=>{
 m.image.mockRejectedValue(new Error(`Unexpected token '<', "<html>504 Gateway Time-out" is not valid JSON`));
 const tree=BookModuleConvert({...imgProps(),prepare:async()=>{}});
 nodes(tree).find(n=>n.type==='button').props.onClick();await settle();
 expect(m.states.some(v=>typeof v==='string'&&v.includes('网关等待超时'))).toBe(true);
 expect(m.refetch).toHaveBeenCalled();
});
