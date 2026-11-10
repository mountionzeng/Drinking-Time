import React from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({states:[] as any[],i:0,records:[] as any[],resume:vi.fn(),refresh:vi.fn(),invalidate:vi.fn(),editorStory:1}));
vi.mock('react',async()=>({...await vi.importActual<typeof import('react')>('react'),useCallback:(fn:any)=>fn,
 useState:(initial:any)=>{const i=h.i++;if(!(i in h.states))h.states[i]=initial;return[h.states[i],(v:any)=>h.states[i]=v];}}));
vi.mock('@/features/uiLanguage/UiLanguage',()=>({useUiText:()=> (s:string,args:any[]=[])=>s.replace(/\{(\d+)\}/g,(_,n)=>String(args[n]))}));
vi.mock('@/lib/trpc',()=>({trpc:{useUtils:()=>({bookMedia:{compositionHistory:{invalidate:h.invalidate}}}),bookMedia:{compositionHistory:{useQuery:()=>({data:h.records})},refreshComposition:{useMutation:()=>({mutateAsync:h.refresh,isPending:false})}}}}));
vi.mock('./bookModuleActions',()=>({useBookModuleActions:{getState:()=>({session:{storyId:h.editorStory,resumeImageComposition:h.resume}})}}));
import {BookImageCompositionHistory} from './BookImageCompositionHistory';
import {BookImageCompositionCard} from './BookImageCompositionCard';
function nodes(n:any):any[]{return !n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];}
const focus=vi.fn();
function draw(){h.i=0;return nodes(BookImageCompositionHistory({storyId:1,session:null,handle:{current:null},onContinue:focus}));}
async function settle(){for(let i=0;i<8;i++)await Promise.resolve();}
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('React',React);h.states=[];h.editorStory=1;h.resume.mockResolvedValue(undefined);
 h.records=[1,2].map(version=>({id:`task${version}`,version,chapterId:3,moduleId:'group',status:'succeeded',createdAt:1700000000000+version,candidates:[{imageId:version,imageUrl:`/result${version}.png`}],composition:{sources:[{id:'a',text:'手绘茶壶'}],instructions:version===1?['原要求']:['原要求','减弱阴影'],estimatedCny:1}}));});
it('keeps completed version cards visible without an active session, and opens the exact archived parameters read-only',()=>{
 let tree=draw();const cards=tree.filter(n=>n.type===BookImageCompositionCard);
 expect(cards.map(n=>n.props.version)).toEqual([1,2]);cards[0].props.onOpen();tree=draw();
 expect(tree.some(n=>n.type==='img'&&n.props.src==='/result1.png')).toBe(true);
 expect(tree.some(n=>n.type==='img'&&n.props.src==='/result2.png')).toBe(false);
 expect(h.resume).not.toHaveBeenCalled();expect(h.refresh).not.toHaveBeenCalled();
});
it('continues the latest revision in the same chain and explicitly explains it when opening an older card',async()=>{
 draw().find(n=>n.type===BookImageCompositionCard).props.onContinue();await settle();
 expect(h.resume).toHaveBeenCalledWith(h.records[1]);expect(focus).toHaveBeenCalledOnce();
 expect(draw().some(n=>n.props?.role==='status'&&String(n.props.children).includes('最新版本 V2'))).toBe(true);
});
it('does not continue using another story editor or changed original materials',async()=>{
 h.editorStory=2;draw().find(n=>n.type===BookImageCompositionCard).props.onContinue();await settle();expect(h.resume).not.toHaveBeenCalled();
 h.editorStory=1;h.resume.mockRejectedValueOnce(new Error('原素材已变化'));
 draw().find(n=>n.type===BookImageCompositionCard).props.onContinue();await settle();
 expect(draw().some(n=>n.props?.role==='status'&&n.props.children==='原素材已变化')).toBe(true);expect(focus).not.toHaveBeenCalled();
});
it('passes the linked shot numbers to each history card and shows them in the detail heading',()=>{
 h.records[0].shotNumbers=[1];h.records[1].shotNumbers=[1];
 const cards=draw().filter(n=>n.type===BookImageCompositionCard);
 expect(cards.map(n=>n.props.shotNumbers)).toEqual([[1],[1]]);
 const card=BookImageCompositionCard(cards[1].props);
 expect(card.props['aria-label']).toBe('第 01 镜 · 图像 V2 · 已生成');
 cards[1].props.onOpen();
 expect(draw().some(n=>Array.isArray(n.props?.children)&&n.props.children[0]==='第 01 镜')).toBe(true);
});
it('marks unlinked book image history explicitly instead of guessing a shot',()=>{
 const card=BookImageCompositionCard(draw().find(n=>n.type===BookImageCompositionCard).props);
 expect(card.props['aria-label']).toContain('书稿图像 · 未关联镜头');
});
