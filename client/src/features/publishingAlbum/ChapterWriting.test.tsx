import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChapterWriting, type ChapterWritingHandle } from './ChapterWriting';
import type { Chapter } from './useChapters';
const effects=vi.hoisted(()=>({list:[] as Array<()=>void|(()=>void)>}));
vi.mock('react',async()=>({...await vi.importActual('react'),useEffect:(effect:()=>void)=>effects.list.push(effect)}));
vi.mock('@/features/writingCompanion/DesktopWritingContext',()=>({DesktopWritingContext:()=>null}));
vi.mock('./ChapterTextModules',()=>({ChapterTextModules:({value,onChange}:any)=><textarea aria-label="正文" value={value} onChange={e=>onChange(e.currentTarget.value)}/>}));
const chapter={id:2,storyId:1,version:4,title:'标题',blocks:{body:'已保存正文'}} as Chapter;
let cache:Map<string,string>,cleanups:Array<()=>void>;
const key='chapter-writing:account9:story1:2';
beforeEach(()=>{
  vi.useFakeTimers();vi.stubGlobal('React',React);effects.list=[];cleanups=[];cache=new Map();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>cache.get(k)??null,setItem:(k:string,v:string)=>cache.set(k,v),removeItem:(k:string)=>cache.delete(k)});
  vi.stubGlobal('window',new EventTarget());
});
afterEach(()=>{cleanups.forEach(fn=>fn());vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
function mount(save:any,reviewedVersion?:number){
  const handle={current:null as ChapterWritingHandle|null};
  let change!:(e:any)=>void;
  const create=React.createElement;
  vi.spyOn(React,'createElement').mockImplementation(((type:any,props:any,...children:any[])=>{
    if(type==='textarea' && props['aria-label']==='正文') change=props.onChange;
    return create(type,props,...children);
  }) as typeof React.createElement);
  const html=renderToStaticMarkup(<ChapterWriting chapter={chapter} scope="account9:story1" handle={handle} save={save} onChange={vi.fn()} disabled={false} reviewedVersion={reviewedVersion}/>);
  cleanups=effects.list.map(effect=>effect()).filter((fn):fn is ()=>void=>typeof fn==='function');
  return {html,handle,change:(value:string)=>change({currentTarget:{value}})};
}
it.each([undefined,3])('never automatically saves a stale draft based on %s',async baseVersion=>{
  cache.set(key,JSON.stringify({title:'标题',body:'旧草稿',baseVersion}));
  const save=vi.fn(); const {handle}=mount(save);
  await vi.advanceTimersByTimeAsync(2000);
  await expect(handle.current!.prepare()).rejects.toThrow('较早或未知版本');
  expect(save).not.toHaveBeenCalled();expect(cache.get(key)).toContain('旧草稿');
});
it('automatically saves a current-base draft without a manual save panel',async()=>{
  cache.set(key,JSON.stringify({title:'标题',body:'新稿',baseVersion:4}));
  const save=vi.fn().mockResolvedValue({...chapter,version:5,blocks:{body:'新稿'}});
  const {html}=mount(save);
  expect(html).not.toContain('保存章节');expect(html).not.toContain('仅保存在此浏览器');
  await vi.advanceTimersByTimeAsync(1500);
  expect(save).toHaveBeenCalledWith({title:'标题',body:'新稿',autosave:true});
  expect(cache.has(key)).toBe(false);
});
it('preserves typing that arrives during a save and advances its true base',async()=>{
  let finish!:(value:unknown)=>void;
  const save=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
  const {handle,change}=mount(save);
  change('第一次修改');const pending=handle.current!.prepare();
  change('保存期间继续写');
  finish({...chapter,version:5,blocks:{body:'第一次修改'}});await pending;
  expect(handle.current!.snapshot()).toMatchObject({body:'保存期间继续写',baseVersion:5});
  expect(JSON.parse(cache.get(key)!)).toMatchObject({body:'保存期间继续写',baseVersion:5});
});
it('keeps the draft on failure and does not erase another tab cache on success',async()=>{
  const save=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({...chapter,version:5,blocks:{body:'本页修改'}});
  const {handle,change}=mount(save);change('本页修改');
  await expect(handle.current!.prepare()).rejects.toThrow('offline');expect(cache.get(key)).toContain('本页修改');
  cache.set(key,JSON.stringify({title:'另一页',body:'另一页尚未保存'}));
  await handle.current!.prepare();expect(cache.get(key)).toContain('另一页尚未保存');
});
it('saves reviewed old text only through the explicit prepare action',async()=>{
  cache.set(key,JSON.stringify({title:'标题',body:'对比后保留的文字',baseVersion:3}));
  const save=vi.fn().mockResolvedValue({...chapter,version:5,blocks:{body:'对比后保留的文字'}});
  const {handle}=mount(save,4);await vi.advanceTimersByTimeAsync(2000);expect(save).not.toHaveBeenCalled();
  await handle.current!.prepare();expect(save).toHaveBeenCalledWith({title:'标题',body:'对比后保留的文字'});
});

it('automatically saves formatting even when the text is unchanged',async()=>{
  const writingStyle=[{id:'heading',format:'heading1',parentId:null,collapsed:true}];
  cache.set(key,JSON.stringify({title:chapter.title,body:chapter.blocks.body,baseVersion:4,writingStyle}));
  const save=vi.fn().mockResolvedValue({...chapter,version:5,blocks:{...chapter.blocks,writingStyle}});
  mount(save);await vi.advanceTimersByTimeAsync(1500);
  expect(save).toHaveBeenCalledWith({title:chapter.title,body:chapter.blocks.body,writingStyle,autosave:true});
  expect(cache.has(key)).toBe(false);
});
it('retries the retained draft when the connection returns',async()=>{
  const save=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({...chapter,version:5,blocks:{body:'离线写作'}});
  const {handle,change}=mount(save);change('离线写作');
  await expect(handle.current!.prepare()).rejects.toThrow('offline');
  expect(cache.get(key)).toContain('离线写作');
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenCalledTimes(2);expect(cache.has(key)).toBe(false);
});
