import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useUiText } from '@/features/uiLanguage/UiLanguage';
import { compositionReferences, compositionQuote } from '@shared/bookImageComposition';
import type { BookModuleImageTask } from '@shared/bookModuleImageTask';
import { formatComputeQuote } from '@shared/computeMoney';
import { useBookImageCompositionSession, type BookImageCompositionSession } from './bookImageCompositionSession';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BOOK_COMPOSITION_MODEL } from '@shared/bookImageComposition';
import { BookImageCompositionCard, compositionStatus } from './BookImageCompositionCard';

export type BookImageCompositionHandle = { submit(text: string): boolean };
export function BookImageCompositionChat({ session, handle, version=1, onContinue, onTaskChange }: {
  session: BookImageCompositionSession; handle: MutableRefObject<BookImageCompositionHandle | null>;
  version?:number; onContinue?():void; onTaskChange?(task:BookModuleImageTask|null,proposing:boolean):void;
}) {
  const ui = useUiText(), reduced = useReducedMotion();
  const target = { storyId: session.storyId, chapterId: session.chapterId, moduleIds: session.sources.map(s => s.id) };
  const query = trpc.bookMedia.composition.useQuery(target, { retry: false, refetchOnWindowFocus: false });
  const generate = trpc.bookMedia.generateComposition.useMutation();
  const refresh = trpc.bookMedia.refreshComposition.useMutation();
  const utils = trpc.useUtils();
  const [task, setTask] = useState<BookModuleImageTask | null>(null);
  const [instruction, setInstruction] = useState(session.instruction);
  const [proposing, setProposing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [placement, setPlacement] = useState('');
  const [opened,setOpened]=useState(false);
  const resumed=useRef(false);
  const lock = useRef(false), live = useRef(true), inserted = useRef(new Set<string>());
  const previousUrl = useRef<string | undefined>(undefined);
  const current = () => live.current && useBookImageCompositionSession.getState().session === session;
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    if (query.data) {
      if(session.resumeOnly && !resumed.current) {
        resumed.current=true;
        if(query.data.status==='succeeded') {inserted.current.add(query.data.id);previousUrl.current=query.data.candidates[0]?.imageUrl;}
      }
      setTask(query.data); setProposing(Boolean(session.instruction) && ['succeeded', 'failed'].includes(query.data.status));
    }
  }, [query.data]);
  useEffect(()=>{onTaskChange?.(task,proposing);},[task,proposing,onTaskChange]);
  useEffect(()=>{if(task)void utils.bookMedia.compositionHistory.invalidate({storyId:session.storyId});},[task?.id,task?.status]);
  const waiting = Boolean(task && !['succeeded', 'failed'].includes(task.status));
  const references = compositionReferences(session.sources);
  const instructions = [...(task?.composition?.instructions ?? []), instruction.trim()].filter(Boolean);
  const quote = compositionQuote(session.sources, instructions, task?.status === 'succeeded');
  const imageUrl = task?.candidates[0]?.imageUrl;

  useEffect(() => {
    if (!task || task.status !== 'succeeded' || !imageUrl || inserted.current.has(task.id)) return;
    inserted.current.add(task.id);
    if (JSON.stringify(task.composition?.sources) !== JSON.stringify(session.sources)) {
      setPlacement('原素材已变化；这一版保留在仓库，可以继续说明新要求');
      return;
    }
    void (async () => {
      try {
        if (!current()) return;
        await session.insert(imageUrl, previousUrl.current);
        if (current()) { setPlacement('已放入文章，仓库也已保存'); previousUrl.current = imageUrl; }
      } catch (e) {
        if (current()) setPlacement(`${e instanceof Error ? e.message : '原位置已变化'}；新图已保留在仓库`);
      }
      void utils.storyAgent.storyImages.invalidate({ storyId: session.storyId });
      void utils.storyAgent.storyMaterialState.invalidate({ storyId: session.storyId });
      void utils.storyAgent.storyGet.invalidate({ id: session.storyId });
    })();
  }, [task?.id, task?.status, imageUrl]);

  useEffect(() => {
    if (task?.status !== 'accepted') return;
    let cancelled = false, running = false;
    const started = Date.now();
    const poll = async () => {
      if (cancelled || running) return;
      if (Date.now() - started > 10 * 60_000) {
        window.clearInterval(timer);
        if (current()) setError('等待较久，任务仍已保留；可点“查看进度”继续查询原任务');
        return;
      }
      running = true;
      try {
        const result = await refresh.mutateAsync(target);
        if (!cancelled && current()) { setTask(result); setError(''); }
      } catch { if (!cancelled && current()) setError('暂未取得进度，任务已保存，正在继续查询'); }
      finally { running = false; }
    };
    const timer = window.setInterval(() => void poll(), 6000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [task?.id, task?.status]);

  useEffect(() => {
    const controller = { submit(text: string) {
      if (lock.current || waiting || query.isLoading) { setError('当前图片还在处理中，完成后可以继续修改'); return false; }
      if (!text.trim()) return false;
      if (task?.status === 'succeeded' && /^(满意|可以了|就用这张|这张可以|就这样|很好)[！!。.\s]*$/.test(text.trim())) {
        useBookImageCompositionSession.getState().setSession(null); return true;
      }
      const next = proposing && instruction.trim() ? `${instruction}\n${text.trim()}` : text.trim();
      if (next.length > 4000) { setError('本轮修改说明较长，请精简到 4000 字以内'); return false; }
      setInstruction(next);
      setProposing(true); setError(''); return true;
    } };
    handle.current = controller;
    return () => { if (handle.current === controller) handle.current = null; };
  });
  async function run() {
    if (lock.current || waiting || !proposing || query.isFetching || query.isLoading || query.error) return;
    lock.current = true; setBusy(true); setError('');
    let sent = false;
    try {
      await session.prepare();
      if (!current()) return;
      sent = true;
      const result = await generate.mutateAsync({ ...target, sources: session.sources, instruction, previousTaskId: task?.id ?? null, estimatedCny: quote, accepted: true });
      if (current()) { setTask(result); setProposing(false); setInstruction(''); }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : '暂未取得结果');
        if (sent) { setProposing(false); void query.refetch(); }
      }
    } finally { lock.current = false; if (current()) setBusy(false); }
  }
  const summary=references.length ? ui('整合 {0} 张图与 {1} 段文字；保留原图的线条、配色和质感。',[references.length,session.sources.filter(s=>!compositionReferences([s]).length).length]) : ui('根据已带入的文字与想法，创作一张新图片。');
  return <motion.section initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} aria-label={ui('图像方案')}>
    <BookImageCompositionCard version={version} status={compositionStatus(task,proposing)} createdAt={proposing?session.createdAt:task?.createdAt} instruction={instruction || task?.composition?.instructions.at(-1) || ''}
      summary={error || task?.error || placement || summary} onOpen={()=>setOpened(true)} disabled={busy || waiting}
      onContinue={()=>{setOpened(false);onContinue?.();}}/>
    <Dialog open={opened} onOpenChange={setOpened}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl space-y-2">
      <DialogHeader><DialogTitle>{ui('图像 V{0} · 方案与参数',[version])}</DialogTitle><DialogDescription>{summary}</DialogDescription></DialogHeader>
    <div className="flex items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">{BOOK_COMPOSITION_MODEL} · 1536 × 1024 · {ui('高质量 · 1 张')}</p>
      <button type="button" aria-label={ui('收起图像方案')} className="shrink-0 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2" onClick={() => useBookImageCompositionSession.getState().setSession(null)}>{ui('暂时收起')}</button>
    </div>
    {references.length > 0 && <div className="flex flex-wrap gap-1.5">{references.map((src, i) => <img key={src} src={src} alt={ui('参考图 {0}', [i + 1])} className="h-20 max-w-36 rounded-sm object-contain" />)}</div>}
    <p className="text-xs text-muted-foreground">{references.length ? ui('整合 {0} 张图与 {1} 段文字；保留原图的线条、配色和质感。', [references.length, session.sources.filter(s => !compositionReferences([s]).length).length]) : ui('根据已带入的文字与想法，创作一张新图片。')}</p>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{ui('已带入的想法')}</summary><div className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap">{session.sources.filter(s => !compositionReferences([s]).length).map(s => s.text).join('\n\n') || ui('按参考图整合画面')}{task?.composition?.instructions.map((s,i) => <p key={i} className="mt-1">{s}</p>)}</div></details>
    {instruction && <p className="whitespace-pre-wrap text-xs">{instruction}</p>}
    {(busy || waiting || query.isLoading) && <p role="status" className="flex items-center gap-1.5 text-xs"><Loader2 size={12} className={reduced ? '' : 'animate-spin'}/>{ui(busy ? '正在提交这份方案…' : task?.status === 'unknown' || task?.status === 'preparing' ? '任务已记录，正在核对提交结果；不会重复生成' : query.isLoading ? '正在读取方案…' : '正在生成，完成后会放入文章')}</p>}
    {imageUrl && <img src={imageUrl} alt={ui('合并生成的图片')} className="max-h-64 w-full rounded object-contain" />}
    {placement && <p className="text-xs text-muted-foreground">{ui(placement)}</p>}
    {(error || query.error || task?.status === 'failed') && <p role="alert" className="text-xs text-destructive">{error || query.error?.message || task?.error || ui('生成未完成')}</p>}
    {proposing && !waiting && <button type="button" disabled={busy || query.isFetching || query.isLoading || Boolean(query.error)} onClick={() => void run()}
      className="rounded-md border border-[var(--nayin-accent)] px-2.5 py-1.5 text-xs text-[var(--nayin-accent)] hover:bg-muted disabled:opacity-40">{ui('确认生成 · {0}', [formatComputeQuote(quote)])}</button>}
    {!waiting && !busy && <p className="text-[11px] text-muted-foreground">{ui(proposing ? '按本轮报价结算。在下方对话框可以继续调整方案。' : '在下方说说还想怎么改；下一轮会继续使用这些素材。')}</p>}
    {waiting && !busy && <button type="button" className="text-xs text-muted-foreground underline" disabled={refresh.isPending} onClick={async () => { try { const result = await refresh.mutateAsync(target); if (current()) setTask(result); } catch(e) { if(current()) setError(e instanceof Error ? e.message : '暂未取得进度'); } }}>{ui('查看进度')}</button>}
    </DialogContent></Dialog>
  </motion.section>;
}
