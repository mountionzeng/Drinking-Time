import { sameWritingStyle } from "@shared/bookWritingStyle";
import { restoreWritingBlocks, writingStyleOf } from "./chapterBlockTree";
import { ChapterTextModules } from "./ChapterTextModules";
import type { TextPosition } from "./moduleTextEditing";
import { DesktopWritingContext } from "@/features/writingCompanion/DesktopWritingContext";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Chapter } from "./useChapters";

import type { LayoutModuleContext } from "@shared/layoutModuleContext";

import type { WritingComparison } from "./WritingComparison";
import { restoreChapterWritingDraft, draftNeedsVersionReview, type ChapterWritingDraft } from './chapterWritingDraft';

type Draft = ChapterWritingDraft;
export type ChapterWritingHandle = { prepare(): Promise<void>; insertImage(url: string): void; snapshot(): Draft; releaseCleanDraft(latest: Chapter): boolean };

/** Comparison keeps this editor mounted; view switches save before opening the other editor. */
export function ChapterWriting({ chapter, scope, handle, save, onChange, disabled, comparison, reviewedVersion }: {
  comparison?: WritingComparison;
  reviewedVersion?: number;
  chapter: Chapter; scope: string; handle: MutableRefObject<ChapterWritingHandle | null>;
  save(draft: Omit<Draft, 'baseVersion'> & { autosave?: boolean }): Promise<unknown>; onChange(draft: Draft): void; disabled: boolean;
}) {
  const module = useRef<LayoutModuleContext | null>(null);
  const contextScope = `${scope}:chapter:${chapter.id}`;
  const onContextChange = useCallback((context: LayoutModuleContext | null) => {
    module.current = context;
    window.dispatchEvent(new Event('dt:writing-selection-change'));
  }, []);
  const selection = useRef<TextPosition | null>(null);
  const key = `chapter-writing:${scope}:${chapter.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const restored=restoreChapterWritingDraft(localStorage.getItem(key), {title:chapter.title,body:chapter.blocks.body,version:chapter.version,writingStyle:chapter.blocks.writingStyle});
      // Migrate a matching legacy local format only when the server has no formatting yet.
      if (!restored.writingStyle && !chapter.blocks.writingStyle && restored.body===chapter.blocks.body) {
        const raw=JSON.parse(localStorage.getItem(`chapter-block-formats:${scope}:${chapter.id}`) ?? 'null');
        if (raw?.body===restored.body && Array.isArray(raw.blocks)) {
          const blocks=restoreWritingBlocks(restored.body,raw);
          if(blocks.some(block=>block.format!=='text'||block.emphasis==='bright'||block.backdrop||block.book)) restored.writingStyle=writingStyleOf(blocks);
        }
      }
      return restored;
    } catch { /* An unavailable browser cache does not prevent writing. */ }
    return { title: chapter.title, body: chapter.blocks.body, baseVersion: chapter.version,writingStyle:chapter.blocks.writingStyle };
  });
  const [error, setError] = useState('');
  const [backupError, setBackupError] = useState('');
  const [saving, setSaving] = useState(false);
  const acknowledged = useRef(chapter);
  if (chapter.version > acknowledged.current.version) acknowledged.current = chapter;
  const pending = useRef<Promise<void> | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const dirty = draft.title !== chapter.title || draft.body !== chapter.blocks.body || !sameWritingStyle(draft.writingStyle,chapter.blocks.writingStyle) || Boolean(draft.changeNote?.trim());
  function prepare(autosave = false): Promise<void> {
    if (pending.current) return pending.current.then(() => prepare(autosave));
    const current = draftRef.current;
    const saved = acknowledged.current;
    if (current.title === saved.title && current.body === saved.blocks.body && sameWritingStyle(current.writingStyle,saved.blocks.writingStyle) && !current.changeNote?.trim()) return Promise.resolve();
    if (draftNeedsVersionReview(current, {title:saved.title,body:saved.blocks.body,version:saved.version,writingStyle:saved.blocks.writingStyle}) && !(reviewedVersion !== undefined && reviewedVersion >= saved.version)) {
      return Promise.reject(new Error('这份本机草稿来自较早或未知版本。请打开“版本”与最新稿对照，再保存；两份内容都还保留着。'));
    }
    setSaving(true);
    const task = save({title:current.title, body:current.body, ...(autosave ? {autosave:true} : {}), ...(current.writingStyle ? {writingStyle:current.writingStyle} : {}), ...(current.changeNote !== undefined ? {changeNote:current.changeNote} : {})}).then(result => {
      const savedChapter = result as Chapter | undefined;
      if (savedChapter?.version) {
        acknowledged.current = savedChapter;
        // Typing during the request belongs to the next save, never to the acknowledged snapshot.
        const next = {...draftRef.current,baseVersion:savedChapter.version};
        if (next.changeNote === current.changeNote) delete next.changeNote;
        draftRef.current=next; setDraft(next);
      }
      setError('');
      setBackupError('');
      try {
        const cached = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (cached?.title === current.title && cached?.body === current.body && cached?.changeNote === current.changeNote && sameWritingStyle(cached?.writingStyle,current.writingStyle)) localStorage.removeItem(key);
        else if (savedChapter?.version && cached?.title === draftRef.current.title && cached?.body === draftRef.current.body && sameWritingStyle(cached?.writingStyle,draftRef.current.writingStyle)) localStorage.setItem(key,JSON.stringify(draftRef.current));
      } catch { /* Saved server copy is authoritative; other tabs' drafts remain untouched. */ }
    }).finally(() => { pending.current = null; setSaving(false); });
    pending.current = task;
    return task;
  }

  const prepareRef = useRef(prepare); prepareRef.current = prepare;
  useEffect(() => {
    if (!dirty || disabled || saving || error || draftNeedsVersionReview(draft,{title:chapter.title,body:chapter.blocks.body,version:chapter.version,writingStyle:chapter.blocks.writingStyle})) return;
    const timer=setTimeout(()=>{void prepareRef.current(true).catch(cause=>setError(cause instanceof Error ? cause.message : '自动保存失败，请重试'));},1500);
    return ()=>clearTimeout(timer);
  },[draft,dirty,disabled,saving,error,chapter.version]);
  useEffect(()=>{
    const retry=()=>{if(!disabled) void prepareRef.current(true).catch(cause=>setError(cause instanceof Error ? cause.message : 'Save failed'));};
    window.addEventListener('online',retry);
    return ()=>window.removeEventListener('online',retry);
  },[disabled]);
  useEffect(()=>{
    if(draft.writingStyle || chapter.blocks.writingStyle || draft.body!==chapter.blocks.body) return;
    try {
      const raw=JSON.parse(localStorage.getItem(`chapter-block-formats:${scope}:${chapter.id}`) ?? 'null');
      if(raw?.body!==draft.body || !Array.isArray(raw.blocks)) return;
      const blocks=restoreWritingBlocks(draft.body,raw);
      if(blocks.some(block=>block.format!=='text'||block.emphasis==='bright'||block.backdrop||block.book)) update({...draftRef.current,writingStyle:writingStyleOf(blocks)});
    } catch { /* Legacy cache remains optional; the server manuscript is never replaced here. */ }
  },[chapter.id,chapter.blocks.writingStyle,draft.body,draft.writingStyle,scope]);
  const insertImage = useRef<((url: string) => void) | null>(null);
  useEffect(() => { handle.current = { prepare, insertImage: url => insertImage.current?.(url), snapshot: () => draftRef.current, releaseCleanDraft: latest => {
    const current = draftRef.current;
    const matches = (saved: Chapter) => current.title === saved.title && current.body === saved.blocks.body && sameWritingStyle(current.writingStyle,saved.blocks.writingStyle);
    if (pending.current || (!matches(chapter) && !matches(latest)) || current.changeNote?.trim()) return false;
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
      // Another tab may have newer unsaved writing in the shared cache. Do not erase it.
      if (stored && (stored.title !== current.title || stored.body !== current.body || stored.changeNote?.trim() || !sameWritingStyle(stored.writingStyle,current.writingStyle))) return false;
      if (stored) localStorage.removeItem(key);
      return true;
    } catch { return false; }
  } }; return () => { handle.current = null; }; });
  useEffect(() => { onChange(draft); }, [draft, onChange]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  function update(next: Draft) {
    // Once the last submitted text is acknowledged, subsequent typing starts from that version.
    if (draftRef.current.title === chapter.title && draftRef.current.body === chapter.blocks.body && sameWritingStyle(draftRef.current.writingStyle,chapter.blocks.writingStyle)) next = {...next,baseVersion:chapter.version};
    draftRef.current = next; setDraft(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setError(''); setBackupError(''); }
    catch { setError(''); setBackupError('本机备份暂不可用，正在尝试保存到账号。'); }
  }
  return <section aria-label="章节写作" className="space-y-4">
    <DesktopWritingContext storyId={chapter.storyId} getSnapshot={() => {
      const body = draftRef.current.body;
      const start = selection.current?.start ?? body.length;
      const end = selection.current?.end ?? start;
      return { draft: body, module: module.current?.scope === contextScope ? module.current : undefined, cursor: start, ...(end > start ? { selection: { start, end } } : {}), scope: contextScope };
    }} />
    <span role="status" className="sr-only">{saving ? '正在自动保存' : dirty ? '等待自动保存' : '已保存'}</span>
    <input aria-label="章节标题" maxLength={200} disabled={disabled} className="w-full border-b bg-transparent py-2 text-xl outline-none" value={draft.title} onChange={e => update({ ...draft, title: e.target.value })} />
    <ChapterTextModules writingStyle={draft.writingStyle} onFormattedChange={(body,writingStyle)=>update({...draftRef.current,body,writingStyle})} imageInsert={insertImage} comparison={comparison} contextSource={{ storyId: chapter.storyId, scope: contextScope, chapterId: String(chapter.id) }} onContextChange={onContextChange} formatScope={`${scope}:${chapter.id}`} value={draft.body} selection={selection} disabled={disabled} onChange={body => update({ ...draft, body })} />
    <details><summary className="cursor-pointer text-xs text-muted-foreground">修改说明（选填）</summary><textarea aria-label="修改说明（选填）" maxLength={500} disabled={disabled} className="mt-2 w-full rounded border bg-transparent p-2 text-sm" value={draft.changeNote ?? ""} onChange={e => update({ ...draft, changeNote: e.target.value })} placeholder="由你自己填写；留空就不显示。" /></details>
    {(error || backupError) && <p role="alert" className="text-sm text-destructive">{error || backupError} <button type="button" className="underline" onClick={()=>void prepare().catch(cause=>setError(cause instanceof Error ? cause.message : '保存失败'))}>重试保存</button></p>}

  </section>;
}
