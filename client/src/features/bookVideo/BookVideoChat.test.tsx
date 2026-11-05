import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { BookVideoRecord } from '@shared/bookVideoCreation';
const api=vi.hoisted(()=>({records:[] as BookVideoRecord[],generate:vi.fn(),adopt:vi.fn(),invalidate:vi.fn().mockResolvedValue(undefined),mediaInvalidate:vi.fn().mockResolvedValue(undefined),prepare:vi.fn(),clear:vi.fn()}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ bookVideo: { list: { invalidate: api.invalidate } }, storyAgent: {storyMaterialState: {invalidate: api.mediaInvalidate}} }),
    bookVideo: {
      list: { useQuery: () => ({ data: { records: api.records, images: {} } }) },
      propose: { useMutation: () => ({ isPending: false }) },
      generate: { useMutation: () => ({ mutateAsync: api.generate, isPending: false }) },
      adopt: { useMutation: () => ({ mutateAsync: api.adopt, isPending: false }) },
      edit: { useMutation: () => ({ isPending: false }) },
    },
  },
}));
vi.mock('./bookPreparation',()=>({prepareBookForVideo:api.prepare}));
vi.mock('./bookVideoSession',()=>({useBookVideoSession:{getState:()=>({setSession:api.clear})}}));
vi.mock('@/features/storyAgent/spine/storySpine',()=>({storySpineStore:{getState:()=>({activeStoryId:1,accountId:9})}}));
vi.mock('@/components/ui/dialog',()=>({Dialog:()=>null,DialogContent:()=>null,DialogHeader:()=>null,DialogTitle:()=>null}));
import { BookVideoChat } from './BookVideoChat';
const record={id:'record1',versionId:'v1',createdAt:1,revision:1,request:'5秒，全景和特写',layout:{body:'纸船'},status:'proposed',bookSource:true,brief:{purpose:'测试',audience:'全年龄',tone:'温柔',duration:'5秒',narration:'无旁白',music:'水声',reuse:'原图',changes:'两镜头',question:'是否采用建议？'}} as BookVideoRecord;
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('React',React);vi.stubGlobal('window',new EventTarget());api.records=[record];api.generate.mockResolvedValue({...record,preview:{shots:[]},status:'ready'});api.adopt.mockResolvedValue({});});
function render(onAdopt=vi.fn().mockResolvedValue(undefined)) {return renderToStaticMarkup(<BookVideoChat storyId={1} accountId={9} epoch={1} session={null} handle={{current:null}} onAdopt={onAdopt}/>);}
it('keeps the confirmation and conditions visible after discussion is closed',()=>{
  const html=render();expect(html).toContain('视频制作下一步');expect(html).toContain('确认方向，整理分镜');expect(html).toContain('5秒');expect(html).toContain('全年龄');
  expect(html).not.toContain('结束讨论');
});
it('direction confirmation prepares a preview without adopting or navigating',async()=>{
  let click!:()=>void;const create=React.createElement;
  const spy=vi.spyOn(React,'createElement').mockImplementation(((type:any,props:any,...children:any[])=>{if(type==='button' && children.includes('确认方向，整理分镜'))click=props.onClick;return create(type,props,...children);}) as typeof React.createElement);
  const onAdopt=vi.fn().mockResolvedValue(undefined);const navigate=vi.fn();window.addEventListener('dt:creation-flow-focus',navigate);
  render(onAdopt);click();await vi.waitFor(()=>expect(api.invalidate).toHaveBeenCalledOnce());
  expect(api.generate).toHaveBeenCalledWith({storyId:1,id:'record1',confirmBrief:true});expect(api.adopt).not.toHaveBeenCalled();
  expect(api.prepare).toHaveBeenCalledWith(1,9);expect(navigate).not.toHaveBeenCalled();expect(onAdopt).not.toHaveBeenCalled();spy.mockRestore();
});
it('labels confirmed V1 and leaves an entry back into the timeline',()=>{
  api.records=[{...record,status:'adopted',videoVersion:1,preview:{shots:[]} as any}];
  const html=render();expect(html).toContain('视频 V1 · 已确认');expect(html).toContain('进入视频表格');
});

it('opens the timeline without waiting on a slow media refresh',async()=>{
  api.records=[{...record,status:'adopted',videoVersion:1,preview:{shots:[]} as any}];
  api.mediaInvalidate.mockImplementationOnce(()=>new Promise(()=>{}));
  let click!:()=>void;const create=React.createElement;
  const spy=vi.spyOn(React,'createElement').mockImplementation(((type:any,props:any,...children:any[])=>{if(type==='button' && children.includes('进入视频表格'))click=props.onClick;return create(type,props,...children);}) as typeof React.createElement);
  const onAdopt=vi.fn().mockResolvedValue(undefined);
  render(onAdopt);click();await vi.waitFor(()=>expect(onAdopt).toHaveBeenCalledOnce());
  expect(api.mediaInvalidate).toHaveBeenCalledWith({storyId:1});spy.mockRestore();
});

it('opens an adopted video without waiting for history to refresh',async()=>{
  api.records=[{...record,status:'adopted',videoVersion:3,preview:{shots:[]} as any}];
  api.invalidate.mockImplementationOnce(()=>new Promise(()=>{}));
  let click!:()=>void;const create=React.createElement;
  const spy=vi.spyOn(React,'createElement').mockImplementation(((type:any,props:any,...children:any[])=>{if(type==='button' && children.includes('进入视频表格'))click=props.onClick;return create(type,props,...children);}) as typeof React.createElement);
  const onAdopt=vi.fn().mockResolvedValue(undefined);
  try {
    render(onAdopt);click();await vi.waitFor(()=>expect(onAdopt).toHaveBeenCalledOnce());
    expect(api.generate).not.toHaveBeenCalled();expect(api.adopt).not.toHaveBeenCalled();
  } finally {spy.mockRestore();}
});
