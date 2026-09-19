import React,{useEffect,useRef,useState,type ReactNode} from "react";
import {BookOpen,Cloud,Image as ImageIcon,Plus,RefreshCw,Save,ShieldCheck,Trash2} from "lucide-react";
import {useLocation} from "wouter";
import {TRPCClientError} from "@trpc/client";

import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {trpc} from "@/lib/trpc";
import StoryShareCard from './StoryShareCard';
import {clearStoryDraftRecovery,isWriteReconciled,readStoryDraftRecovery,writeStoryDraftRecovery} from "./storyEditorSafety";
import {appendOwnDraftBlock,buildWriteEdits,createEditorDraft,draftHasChanges,rebaseEditorDraft,removeOwnDraftBlock,updateDraftBlock,
  type StoryDocument,type StoryEditorDraft} from "./storyDocument";

type AccessItem={id:number;title:string;status:"active"|"revoked"};
type DraftRecoveryState={accessId:number;base:StoryDocument;draft:StoryEditorDraft;dirty:boolean};
type ViewProps={accesses:AccessItem[];selectedAccessId?:number;document?:StoryDocument;draft?:StoryEditorDraft;loading:boolean;error?:string;notice?:string;
  dirty:boolean;saving:boolean;conflict?:StoryDocument;onSelect:(id:number)=>void;onChange:(blockId:string,text:string)=>void;onAppend:(chapterId:string)=>void;
  onRemove:(localId:string)=>void;onSave:()=>void;onRebase:()=>void;shareCard?:ReactNode;renderPhoto?:(chapterId:string,photoId:string,blockId:string)=>ReactNode};

export function StoryPhotoView({url,loading,failed,onError}:{url?:string;loading:boolean;failed:boolean;onError?:()=>void}){
  if(url&&!failed)return <figure className="overflow-hidden rounded-lg border border-border bg-muted/20"><img src={url} alt="故事照片" loading="lazy" referrerPolicy="no-referrer"
    onError={onError} className="max-h-[680px] w-full object-contain"/><figcaption className="px-4 py-2 text-xs text-muted-foreground">来自微信故事 · 临时受控读取</figcaption></figure>;
  return <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-4 text-sm text-muted-foreground"><ImageIcon className="size-5 text-primary"/>
    <div><p className="text-foreground">{loading?"正在安全读取照片":failed?"照片暂时无法显示":"照片保留在这一段"}</p><p className="mt-0.5 text-xs">{loading?"每次读取都会重新核对当前故事和权限。":
      failed?"文字仍可继续编辑；刷新后会重新核对权限。":"当前只读通道不传永久图片地址，保存文字不会移动或删除它。"}</p></div></div>;
}

export function StoryEditorView(props:ViewProps){
  const selected=props.accesses.find(item=>item.id===props.selectedAccessId);
  return <div className="min-h-dvh bg-background text-foreground">
    <header className="border-b border-border/70 bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
        <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><BookOpen className="size-5"/></div>
          <div><p className="font-chat-brand text-xl leading-none">拾光</p><p className="mt-1 text-xs text-muted-foreground">同一本故事 · 电脑续写</p></div></div>
        {props.document&&<div className="flex items-center gap-3"><span className={`text-xs ${props.dirty?"text-primary":"text-muted-foreground"}`}>{props.dirty?"有未保存修改":"已与权威故事同步"}</span>
          {props.shareCard}<Button onClick={props.onSave} disabled={!props.dirty||props.saving} size="sm"><Save/>{props.saving?"保存中…":"保存"}</Button></div>}
      </div>
    </header>
    <main className="mx-auto grid max-w-[1440px] gap-0 px-5 py-7 lg:grid-cols-[250px_190px_minmax(0,1fr)] lg:px-8">
      <aside className="border-b border-border/70 pb-6 lg:min-h-[calc(100dvh-8rem)] lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6" aria-label="微信故事">
        <div className="mb-4 flex items-center justify-between"><h1 className="text-sm font-semibold tracking-wide">微信里的故事</h1><Cloud className="size-4 text-muted-foreground"/></div>
        {props.accesses.length===0&&!props.loading?<div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm leading-6 text-muted-foreground">还没有已连接的故事。请在微信小程序选择一本故事，再生成电脑登录码。</div>:
          <nav className="space-y-1.5">{props.accesses.map(item=><button key={item.id} type="button" onClick={()=>props.onSelect(item.id)} aria-current={item.id===props.selectedAccessId?"page":undefined}
            className={`w-full rounded-lg px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${item.id===props.selectedAccessId?"bg-primary/10 font-medium text-foreground":"text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{item.title}</button>)}</nav>}
      </aside>
      {props.document&&props.draft?<><aside className="border-b border-border/70 py-6 lg:border-b-0 lg:border-r lg:px-6 lg:py-0" aria-label="章节">
        <p className="mb-3 text-[11px] tracking-[0.2em] text-muted-foreground">章节</p><nav className="space-y-3">{props.draft.chapters.map((chapter,index)=><a key={chapter.id} href={`#${chapter.id}`}
          className="block text-sm leading-5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="mr-2 font-mono text-[10px] text-primary">{String(index+1).padStart(2,"0")}</span>{chapter.title||"未命名章节"}</a>)}</nav>
      </aside>
      <article className="min-w-0 py-7 lg:px-10 lg:py-0 xl:px-16">
        <div className="mx-auto max-w-3xl animate-in fade-in duration-300">
          <div className="mb-10"><div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>第 {props.document.version} 版</span><span>·</span>
            <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5"/>来源信息受保护</span></div><h2 className="font-chat-brand text-4xl leading-tight sm:text-5xl">{props.document.title}</h2></div>
          {(props.notice||props.error)&&<div role="status" className={`mb-7 rounded-lg border px-4 py-3 text-sm leading-6 ${props.error?"border-destructive/30 bg-destructive/5 text-destructive":"border-primary/25 bg-primary/5 text-foreground"}`}>{props.error||props.notice}</div>}
          {props.conflict&&<div className="mb-8 rounded-lg border border-primary/30 bg-primary/5 p-4"><p className="text-sm font-medium">手机或另一页面已经保存到第 {props.conflict.version} 版</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">你的文字仍保留在当前页面。先把它放到最新结构上，再核对一次后保存。</p><Button className="mt-3" size="sm" variant="outline" onClick={props.onRebase}><RefreshCw/>基于最新版继续</Button></div>}
          <div className="space-y-14">{props.draft.chapters.map((chapter,index)=><section key={chapter.id} id={chapter.id} className="scroll-mt-24">
            <div className="mb-5 flex items-baseline gap-3"><span className="font-mono text-xs text-primary">{String(index+1).padStart(2,"0")}</span><h3 className="text-xl font-semibold">{chapter.title||"未命名章节"}</h3></div>
            <div className="space-y-4">{chapter.content.map((block,blockIndex)=>typeof block.text==="string"?<div key={block.localId||block.blockId} className="group relative">
              <Textarea disabled={props.saving} aria-label={`${chapter.title||"章节"}第 ${blockIndex+1} 段`} value={block.text} onChange={event=>props.onChange(block.localId||block.blockId,event.target.value)}
                className="min-h-28 resize-y border-transparent bg-transparent px-0 py-2 text-[17px] leading-8 shadow-none hover:border-border/60 focus-visible:border-border focus-visible:bg-card/50 focus-visible:px-4"/>
              {block.isOwnAddition&&block.localId&&<button disabled={props.saving} type="button" onClick={()=>props.onRemove(block.localId!)} aria-label="删除这段补充"
                className="absolute right-1 top-1 rounded-md p-2 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring group-hover:opacity-100"><Trash2 className="size-4"/></button>}
            </div>:<React.Fragment key={block.blockId}>{props.renderPhoto?.(chapter.id,block.photoId!,block.blockId)??<StoryPhotoView loading={false} failed={false}/>}</React.Fragment>)}</div>
            <Button disabled={props.saving} type="button" variant="ghost" size="sm" className="mt-4 text-muted-foreground" onClick={()=>props.onAppend(chapter.id)}><Plus/>补充一段自己的经历</Button>
          </section>)}</div>
        </div>
      </article></>:<section className="py-12 lg:col-span-2 lg:px-12"><div className="mx-auto max-w-lg text-center"><BookOpen className="mx-auto size-10 text-primary/70"/>
        <h2 className="mt-5 text-xl font-semibold">{selected?"正在打开故事":"选择一本故事继续"}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{props.loading?"正在从拾光权威库读取当前版本…":props.error||"这里编辑的是微信里的同一本故事，不会另存成第二份。"}</p></div></section>}
    </main>
  </div>;
}

const requestId=()=>`desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
function persistDraftRecovery(state:DraftRecoveryState|undefined):void{if(!state)return;try{if(state.dirty)writeStoryDraftRecovery(sessionStorage,state.accessId,state.base,state.draft);
  else clearStoryDraftRecovery(sessionStorage,state.accessId);}catch{}}
function StoryPhoto({accessId,revisionId,chapterId,photoId}:{accessId:number;revisionId:string;chapterId:string;photoId:string}){
  const host=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{const node=host.current;if(!node)return;if(typeof IntersectionObserver==="undefined"){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"800px"});
    observer.observe(node);return()=>observer.disconnect();},[]);
  const media=trpc.shiguangStoryAccess.media.useQuery({accessId,revisionId,chapterId,photoId},{enabled:visible,retry:false,staleTime:240000,gcTime:300000});
  return <div ref={host}><StoryPhotoView url={media.data?.url} loading={visible&&media.isLoading} failed={failed||media.isError} onError={()=>setFailed(true)}/></div>;
}
export default function StoryEditorPage({accessId}:{accessId?:number}){
  const [,navigate]=useLocation(),list=trpc.shiguangStoryAccess.list.useQuery(),read=trpc.shiguangStoryAccess.read.useQuery({accessId:accessId||1},{enabled:Boolean(accessId),retry:false});
  const write=trpc.shiguangStoryAccess.write.useMutation();
  const [base,setBase]=useState<StoryDocument|undefined>(undefined),[draft,setDraft]=useState<StoryEditorDraft|undefined>(undefined);
  const [loadedAccessId,setLoadedAccessId]=useState<number|undefined>(undefined);
  const [notice,setNotice]=useState<string|undefined>(undefined),[error,setError]=useState<string|undefined>(undefined);
  const [conflict,setConflict]=useState<StoryDocument|undefined>(undefined),[saving,setSaving]=useState(false),pendingRequest=useRef<string|undefined>(undefined),savingRef=useRef(false);
  const draftRecovery=useRef<DraftRecoveryState|undefined>(undefined),draftRecoveryTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const accessEpoch=useRef({id:accessId,generation:0});
  if(accessEpoch.current.id!==accessId)accessEpoch.current={id:accessId,generation:accessEpoch.current.generation+1};
  useEffect(()=>()=>{accessEpoch.current.generation++;},[]);
  const currentBase=loadedAccessId===accessId?base:undefined,currentDraft=loadedAccessId===accessId?draft:undefined;
  const dirty=Boolean(currentBase&&currentDraft&&draftHasChanges(currentBase,currentDraft));
  useEffect(()=>{setLoadedAccessId(undefined);setBase(undefined);setDraft(undefined);setConflict(undefined);setNotice(undefined);setError(undefined);pendingRequest.current=undefined;},[accessId]);
  useEffect(()=>{const value=read.data as StoryDocument|undefined;if(!value)return;if(!base||base.storyId!==value.storyId||(!dirty&&base.revisionId!==value.revisionId)){
    let recovery:ReturnType<typeof readStoryDraftRecovery>=null;if(accessId)try{recovery=readStoryDraftRecovery(sessionStorage,accessId);}catch{}
    if(recovery&&recovery.base.storyId===value.storyId&&draftHasChanges(recovery.base,recovery.draft)){
      setLoadedAccessId(accessId);setBase(recovery.base);setDraft(recovery.draft);setConflict(recovery.base.revisionId===value.revisionId?undefined:value);
      setNotice("已恢复这台电脑上尚未保存的文字。");setError(undefined);pendingRequest.current=undefined;return;
    }
    setLoadedAccessId(accessId);setBase(value);setDraft(createEditorDraft(value));setConflict(undefined);setError(undefined);pendingRequest.current=undefined;}},[accessId,base,dirty,read.data]);
  useEffect(()=>{const next=accessId&&loadedAccessId===accessId&&currentBase&&currentDraft?{accessId,base:currentBase,draft:currentDraft,dirty}:undefined;
    if(draftRecovery.current&&draftRecovery.current.accessId!==next?.accessId)persistDraftRecovery(draftRecovery.current);draftRecovery.current=next;
    if(draftRecoveryTimer.current)clearTimeout(draftRecoveryTimer.current);draftRecoveryTimer.current=undefined;
    if(next){if(!dirty)persistDraftRecovery(next);else draftRecoveryTimer.current=setTimeout(()=>{if(draftRecovery.current===next)persistDraftRecovery(next);},300);}
    return()=>{if(draftRecoveryTimer.current)clearTimeout(draftRecoveryTimer.current);draftRecoveryTimer.current=undefined;};
  },[accessId,currentBase,currentDraft,dirty,loadedAccessId]);
  useEffect(()=>()=>{if(draftRecoveryTimer.current)clearTimeout(draftRecoveryTimer.current);persistDraftRecovery(draftRecovery.current);},[]);
  useEffect(()=>{if(!dirty)return;const handler=(event:BeforeUnloadEvent)=>{persistDraftRecovery(draftRecovery.current);event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",handler);return()=>window.removeEventListener("beforeunload",handler);},[dirty]);
  const accesses=(list.data||[]) as AccessItem[],readError=read.error?"暂时无法读取这本故事，请稍后重试。":undefined;
  const choose=(id:number)=>{if(savingRef.current)return;if(dirty&&!window.confirm("这本故事还有未保存修改，仍要切换吗？"))return;navigate(`/stories/${id}`);};
  const save=async()=>{if(savingRef.current||!accessId||!currentBase||!currentDraft)return;const generation=accessEpoch.current.generation;
    const current=()=>generation===accessEpoch.current.generation;
    const edits=buildWriteEdits(currentBase,currentDraft);if(!edits.length)return;setError(undefined);setNotice(undefined);
    const id=pendingRequest.current||requestId();pendingRequest.current=id;savingRef.current=true;setSaving(true);try{const result=await write.mutateAsync({accessId,revisionId:currentBase.revisionId,expectedVersion:currentBase.version,requestId:id,edits});
      if(!current())return;const latest=await read.refetch();if(!current())return;const value=latest.isSuccess?latest.data as StoryDocument|undefined:undefined;
      if(isWriteReconciled(result,value)){const nextDraft=createEditorDraft(value);pendingRequest.current=undefined;setBase(value);setDraft(nextDraft);setConflict(undefined);
        draftRecovery.current={accessId,base:value,draft:nextDraft,dirty:false};persistDraftRecovery(draftRecovery.current);setNotice("已保存到微信里的同一本故事。");}
      else setError("修改已写入，但暂时无法确认最新版本。文字仍保留在页面和本机草稿中，请稍后再次保存确认。");
    }catch(caught){if(!current())return;if(caught instanceof TRPCClientError&&caught.data?.code==="CONFLICT"){const latest=await read.refetch();if(!current())return;
      const value=latest.isSuccess?latest.data as StoryDocument|undefined:undefined;if(value&&(value.version>currentBase.version||value.revisionId!==currentBase.revisionId)){
        setConflict(value);setError("故事已有更新，你的修改仍保留在当前页面。");}else setError("故事已有更新，但暂时无法读取最新版。文字仍保留在页面和本机草稿中，请稍后重试。");}
      else setError("这次保存没有完成，修改仍保留在当前页面，可以稍后重试。");}finally{if(current()){savingRef.current=false;setSaving(false);}}};
  const rebase=()=>{if(!conflict||!currentBase||!currentDraft)return;const rebased=rebaseEditorDraft(currentBase,conflict,currentDraft);if(!rebased){
      setError("同一段文字已被别人修改，或原章节已经删除。你的草稿仍完整保留，请先复制核对后再处理。");return;}
    setDraft(rebased);setBase(conflict);setConflict(undefined);pendingRequest.current=undefined;setError(undefined);setNotice("已放到最新版本上，请核对后再次保存。");};
  return <StoryEditorView accesses={accesses} selectedAccessId={accessId} document={currentBase} draft={currentDraft} loading={list.isLoading||Boolean(accessId&&read.isLoading)} error={error||readError}
    shareCard={accessId&&currentBase?<StoryShareCard key={`${accessId}:${currentBase.revisionId}:${dirty}`} accessId={accessId} disabled={dirty||saving}/>:undefined}
    notice={notice} dirty={dirty} saving={saving} conflict={conflict} onSelect={choose} onChange={(id,text)=>{pendingRequest.current=undefined;if(currentDraft)setDraft(updateDraftBlock(currentDraft,id,text));}}
    onAppend={chapterId=>{pendingRequest.current=undefined;if(currentDraft)setDraft(appendOwnDraftBlock(currentDraft,chapterId,requestId()));}} onRemove={id=>{pendingRequest.current=undefined;if(currentDraft)setDraft(removeOwnDraftBlock(currentDraft,id));}} onSave={save} onRebase={rebase}
    renderPhoto={accessId&&currentBase?(chapterId,photoId,blockId)=><StoryPhoto key={`${currentBase.revisionId}:${blockId}`} accessId={accessId} revisionId={currentBase.revisionId}
      chapterId={chapterId} photoId={photoId}/>:undefined}/>;
}
