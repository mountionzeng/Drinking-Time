import { useCallback, useState, type MutableRefObject } from 'react';
import { trpc } from '@/lib/trpc';
import { useUiText } from '@/features/uiLanguage/UiLanguage';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BOOK_COMPOSITION_MODEL, compositionReferences } from '@shared/bookImageComposition';
import type { BookModuleImageTask } from '@shared/bookModuleImageTask';
import { formatComputeQuote } from '@shared/computeMoney';
import { useBookModuleActions } from './bookModuleActions';
import { BookImageCompositionChat, type BookImageCompositionHandle } from './BookImageCompositionChat';
import type { BookImageCompositionSession } from './bookImageCompositionSession';
import { BookImageCompositionCard, compositionStatus, compositionTargetLabel } from './BookImageCompositionCard';

export function BookImageCompositionHistory({storyId,session,handle,onContinue}: {
  storyId:number;session:BookImageCompositionSession|null;handle:MutableRefObject<BookImageCompositionHandle|null>;onContinue():void;
}) {
  const ui=useUiText(),utils=trpc.useUtils();
  const history=trpc.bookMedia.compositionHistory.useQuery({storyId},{refetchOnWindowFocus:true,
    refetchInterval:q=>q.state.data?.some(t=>t.status==='accepted'||t.status==='preparing')?6000:false});
  const refresh=trpc.bookMedia.refreshComposition.useMutation();
  const [opened,setOpened]=useState<string|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [active,setActive]=useState<{key:string;task:BookModuleImageTask|null;proposing:boolean}|null>(null);
  const onTaskChange=useCallback((task:BookModuleImageTask|null,proposing:boolean)=>{
    if(session)setActive({key:session.key,task,proposing});
  },[session?.key]);
  const records=history.data??[],detail=records.find(task=>task.id===opened);
  const current=active?.key===session?.key?active:null;
  const activeVersion=current?.task && !current.proposing ? records.find(r=>r.id===current.task!.id)?.version ?? records.length+1 : records.length+1;
  const activeShotNumbers=records.find(r=>r.id===current?.task?.id)?.shotNumbers ?? [...records].reverse().find(r=>session && r.chapterId===session.chapterId && r.composition?.sources.length===session.sources.length && r.composition.sources.every(s=>session.sources.some(source=>source.id===s.id)))?.shotNumbers;
  async function resume(record:typeof records[number]) {
    if(busy)return;
    setBusy(true);setNotice('');
    try {
      const latest=records.filter(r=>r.chapterId===record.chapterId && r.moduleId===record.moduleId).at(-1)??record;
      const editor=useBookModuleActions.getState().session;
      if(editor?.storyId!==storyId || !editor.resumeImageComposition)throw new Error('请先打开此方案对应的书稿，再继续讨论');
      await editor.resumeImageComposition(latest);
      setOpened(null);
      if(latest.id!==record.id)setNotice(ui('已接续此方案的最新版本 V{0}；旧版仍可打开查看。',[latest.version]));
      onContinue();
    }catch(e){setNotice(e instanceof Error?e.message:'暂时无法继续此方案');}
    finally{setBusy(false);}
  }
  return <section aria-label={ui('图像创作记录')}>
    {records.filter(r=>!session || current?.proposing || r.id!==current?.task?.id).map(record=><BookImageCompositionCard key={record.id}
      version={record.version} status={compositionStatus(record)} createdAt={record.createdAt}
      shotNumbers={record.shotNumbers}
      instruction={record.composition?.instructions.at(-1)??''}
      summary={record.error || (record.status==='succeeded'?ui('图片已生成，原素材和这一版结果均已保留。'):ui('任务已保存，可以打开方案查看进度。'))}
      onOpen={()=>setOpened(record.id)} onContinue={()=>void resume(record)} disabled={busy}/>) }
    {history.error && <p role="alert" className="text-xs text-destructive">{ui('暂时无法读取图像记录，请稍后重试。')}</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {session && <BookImageCompositionChat key={session.key} session={session} handle={handle} version={activeVersion} shotNumbers={activeShotNumbers} onTaskChange={onTaskChange} onContinue={onContinue}/>}
    <Dialog open={Boolean(detail)} onOpenChange={open=>{if(!open)setOpened(null);}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      {detail?.composition && <>
        <DialogHeader><DialogTitle>{compositionTargetLabel(detail.shotNumbers,ui)} · {ui('图像 V{0} · 方案与参数',[detail.version])}</DialogTitle><DialogDescription>{ui(compositionStatus(detail))} · {detail.createdAt?new Date(detail.createdAt).toLocaleString():ui('历史记录')}</DialogDescription></DialogHeader>
        <p className="text-xs text-muted-foreground">{BOOK_COMPOSITION_MODEL} · 1536 × 1024 · {ui('高质量 · 1 张')} · {ui('确认时报价：')}{formatComputeQuote(detail.composition.estimatedCny)}</p>
        <div className="flex flex-wrap gap-2">{compositionReferences(detail.composition.sources).map((url,i)=><img key={url} src={url} alt={ui('参考图 {0}',[i+1])} className="h-20 max-w-36 object-contain"/>)}</div>
        <details><summary className="cursor-pointer text-sm">{ui('所选文字与想法')}</summary><p className="whitespace-pre-wrap text-sm">{detail.composition.sources.filter(s=>!compositionReferences([s]).length).map(s=>s.text).join('\n\n')||ui('按参考图整合画面')}</p></details>
        <div className="space-y-2 whitespace-pre-wrap text-sm">{detail.composition.instructions.map((instruction,i)=><p key={i}>{instruction}</p>)}</div>
        {detail.candidates.map(candidate=><img key={candidate.imageId} src={candidate.imageUrl} alt={ui('图像 V{0} 的生成结果',[detail.version])} className="max-h-96 w-full object-contain"/>)}
        {detail.error && <p role="alert" className="text-sm text-destructive">{detail.error}</p>}
        {['accepted','preparing','unknown'].includes(detail.status) && <button type="button" disabled={refresh.isPending} className="text-sm underline" onClick={async()=>{
          try{await refresh.mutateAsync({storyId,chapterId:detail.chapterId,moduleIds:detail.composition!.sources.map(s=>s.id)});await utils.bookMedia.compositionHistory.invalidate({storyId});}
          catch(e){setNotice(e instanceof Error?e.message:'暂未取得进度');}
        }}>{ui('查看进度')}</button>}
        <button type="button" className="rounded-md border px-3 py-2 text-sm disabled:opacity-40" disabled={busy} onClick={()=>void resume(detail)}>{ui('继续讨论')}</button>
        {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      </>}
    </DialogContent></Dialog>
  </section>;
}
