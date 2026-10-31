import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({describe:vi.fn(),image:vi.fn(),music:vi.fn(),price:vi.fn(),invalidate:vi.fn(),states:[] as any[],index:0,refs:[] as any[],ref:0}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useEffect:(fn:any)=>fn(),useRef:(v:any)=>m.refs[m.ref++]??(m.refs[m.ref-1]={current:v}),useState:(v:any)=>{const i=m.index++;if(!(i in m.states))m.states[i]=v;return [m.states[i],(n:any)=>m.states[i]=n];}}));
vi.mock('@/lib/trpc',()=>({trpc:{bookMedia:{quoteNarration:{useMutation:()=>({mutateAsync:m.price})},describe:{useMutation:()=>({mutateAsync:m.describe})}},storyAgent:{generateForMobile:{useMutation:()=>({mutateAsync:m.image})}},timelineMedia:{generateNarrationCandidate:{useMutation:()=>({mutateAsync:m.music})},quoteSceneAudio:{useMutation:()=>({mutateAsync:m.price})},generateSceneAudio:{useMutation:()=>({mutateAsync:m.music})}},useUtils:()=>({memoryWarehouse:{forStory:{invalidate:m.invalidate}},storyAgent:{storyMaterialState:{invalidate:m.invalidate}},timelineMedia:{audioAssetLibrary:{invalidate:m.invalidate}}})}}));
import {BookModuleConvert} from './BookModuleConvert';
function nodes(n:any):any[]{return !n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];}
beforeEach(()=>{vi.clearAllMocks();m.states=[];m.refs=[];m.index=0;m.ref=0;vi.stubGlobal('React',React);m.invalidate.mockResolvedValue(undefined);});
async function settle(){for(let i=0;i<15;i++)await Promise.resolve();}
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

it('shows rate limiting and restores the button only for a definite HTTP 429 rejection',async()=>{
 const props={source:{id:'x',text:'雨天',kind:'image' as const},storyId:1,chapterId:2,prepare:async()=>{},onInsert:vi.fn(),onClose:vi.fn()};
 m.image.mockResolvedValue({status:'error',error:'302 Midjourney submit HTTP 429'});
 nodes(BookModuleConvert(props)).find(n=>n.type==='button').props.onClick();await settle();
 m.index=m.ref=0;const tree=BookModuleConvert(props);
 expect(nodes(tree).find(n=>n.props?.role==='alert').props.children).toContain('图片生成服务当前限流，本次未取得任务号。请稍后再试，原文字已保留。');
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
