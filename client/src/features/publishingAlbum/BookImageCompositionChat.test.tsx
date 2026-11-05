import React from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({states:[] as any[],refs:[] as any[],effects:[] as any[],queue:[] as (()=>void)[],s:0,r:0,e:0,query:{data:null as any,isLoading:false,isFetching:false,error:null,refetch:vi.fn()},generate:vi.fn(),refresh:vi.fn(),invalidate:vi.fn(),session:null as any}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),
  useState(initial:any){const i=h.s++;if(!(i in h.states))h.states[i]=typeof initial==='function'?initial():initial;return[h.states[i],(v:any)=>h.states[i]=typeof v==='function'?v(h.states[i]):v];},
  useRef(initial:any){const i=h.r++;return h.refs[i]??(h.refs[i]={current:initial});},
  useEffect(fn:()=>any,deps?:any[]){const i=h.e++,old=h.effects[i];if(!deps||!old||deps.some((v,n)=>!Object.is(v,old.deps[n])))h.queue.push(()=>{old?.cleanup?.();h.effects[i]={deps,cleanup:fn()};});}
}));
vi.mock('framer-motion',()=>({motion:{section:'section'},useReducedMotion:()=>true}));
vi.mock('@/features/uiLanguage/UiLanguage',()=>({useUiText:()=> (s:string,args:any[]=[])=>s.replace(/\{(\d+)\}/g,(_,n)=>String(args[n]))}));
vi.mock('./bookImageCompositionSession',()=>({useBookImageCompositionSession:{getState:()=>({session:h.session,setSession:(s:any)=>{h.session=s;}})}}));
vi.mock('@/lib/trpc',()=>({trpc:{useUtils:()=>({storyAgent:{storyImages:{invalidate:h.invalidate},storyMaterialState:{invalidate:h.invalidate},storyGet:{invalidate:h.invalidate}},bookMedia:{compositionHistory:{invalidate:h.invalidate}}}),bookMedia:{composition:{useQuery:()=>h.query},generateComposition:{useMutation:()=>({mutateAsync:h.generate})},refreshComposition:{useMutation:()=>({mutateAsync:h.refresh,isPending:false})}}}}));
import { BookImageCompositionChat } from './BookImageCompositionChat';
const handle={current:null as any};
function nodes(node:any):any[]{return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
function draw(){h.s=h.r=h.e=0;h.queue=[];const tree=BookImageCompositionChat({session:h.session,handle});h.queue.forEach(f=>f());return nodes(tree);}
const task=(status='accepted')=>({id:'task1',requestId:'r',chapterId:3,moduleId:'composition',sourceHash:'h',provider:'gpt-image',status,candidates:status==='succeeded'?[{imageId:1,imageUrl:'/api/images/new.png'}]:[],composition:{sources:h.session.sources,instructions:['原要求'],estimatedCny:1,previousTaskId:null,billingOperationId:null}});
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('React',React);vi.stubGlobal('window',{setInterval,clearInterval});h.states=[];h.refs=[];h.effects=[];h.query={...h.query,data:null,isLoading:false,isFetching:false,error:null};h.session={key:'a',scope:'s',storyId:1,chapterId:3,accountId:2,epoch:1,sources:[{id:'image',text:'![图片](/api/images/a.png)'},{id:'text',text:'茶壶拉出聊天框'}],instruction:'保留手绘质感',prepare:vi.fn().mockResolvedValue(undefined),insert:vi.fn().mockResolvedValue(undefined)};h.generate.mockImplementation(async()=>task());h.invalidate.mockResolvedValue(undefined);});
afterEach(()=>{h.effects.forEach(e=>e?.cleanup?.());vi.useRealTimers();vi.unstubAllGlobals();});
it('only submits on the single confirmation, bringing the selected sources and latest chat feedback',async()=>{
  draw();expect(h.generate).not.toHaveBeenCalled();expect(handle.current.submit('不要阴影')).toBe(true);
  const button=draw().find(n=>n.type==='button'&&String(n.props.children).startsWith('确认生成'));
  button.props.onClick();button.props.onClick();await vi.advanceTimersByTimeAsync(0);
  expect(h.generate).toHaveBeenCalledOnce();expect(h.generate.mock.calls[0][0]).toMatchObject({sources:h.session.sources,instruction:'保留手绘质感\n不要阴影',accepted:true,previousTaskId:null});
});
it('restores accepted work and polls instead of generating again',async()=>{
  h.query.data=task();draw();draw();expect(handle.current.submit('改红')).toBe(false);h.refresh.mockResolvedValue(task());
  await vi.advanceTimersByTimeAsync(6000);expect(h.refresh).toHaveBeenCalledOnce();expect(h.generate).not.toHaveBeenCalled();
});
it('does not submit when the editor session changes during preparation',async()=>{
  let release!:()=>void;h.session.prepare.mockReturnValue(new Promise<void>(r=>release=r));
  const button=draw().find(n=>n.type==='button'&&String(n.props.children).startsWith('确认生成'));
  button.props.onClick();h.session={...h.session,key:'other'};release();await vi.advanceTimersByTimeAsync(0);expect(h.generate).not.toHaveBeenCalled();
});
it('inserts the completed image once and treats satisfaction as completion',async()=>{
  h.query.data=task('succeeded');draw();draw();await vi.advanceTimersByTimeAsync(0);draw();
  expect(h.session.insert).toHaveBeenCalledOnce();expect(h.session.insert).toHaveBeenCalledWith('/api/images/new.png',undefined);
  expect(h.invalidate.mock.calls.every(([scope])=>scope?.storyId===1 || scope?.id===1)).toBe(true);
  expect(handle.current.submit('满意')).toBe(true);expect(h.session).toBeNull();expect(h.generate).not.toHaveBeenCalled();
});
it('resuming a finished plan never reinserts its old image and uses it as the replacement anchor next round',async()=>{
 h.session.resumeOnly=true;h.query.data=task('succeeded');draw();draw();await vi.advanceTimersByTimeAsync(0);
 expect(h.session.insert).not.toHaveBeenCalled();
 expect(handle.current.submit('再浅一点')).toBe(true);
 h.generate.mockResolvedValue({...task('succeeded'),id:'task2',candidates:[{imageId:2,imageUrl:'/api/images/newer.png'}]});
 draw().find(n=>n.type==='button'&&String(n.props.children).startsWith('确认生成')).props.onClick();await vi.advanceTimersByTimeAsync(0);draw();await vi.advanceTimersByTimeAsync(0);
 expect(h.session.insert).toHaveBeenCalledWith('/api/images/newer.png','/api/images/new.png');
});
