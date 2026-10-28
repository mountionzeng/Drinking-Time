import { ChapterTextModules } from "./ChapterTextModules";
import type { TextPosition } from "./moduleTextEditing";
import { DesktopWritingContext } from "@/features/writingCompanion/DesktopWritingContext";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { Chapter } from "./useChapters";

type Draft = { title: string; body: string; changeNote?: string };
export type ChapterWritingHandle = { prepare(): Promise<void>; snapshot(): Draft };

/** Comparison keeps this editor mounted; view switches save before opening the other editor. */
export function ChapterWriting({ chapter, scope, handle, save, onChange, disabled }: {
  chapter: Chapter; scope: string; handle: MutableRefObject<ChapterWritingHandle | null>;
  save(draft: Draft): Promise<void>; onChange(draft: Draft): void; disabled: boolean;
}) {
  const selection = useRef<TextPosition | null>(null);
  const key = `chapter-writing:${scope}:${chapter.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (stored && typeof stored.title === 'string' && typeof stored.body === 'string') return stored;
    } catch { /* An unavailable browser cache does not prevent writing. */ }
    return { title: chapter.title, body: chapter.blocks.body };
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const dirty = draft.title !== chapter.title || draft.body !== chapter.blocks.body || Boolean(draft.changeNote?.trim());
  function prepare(): Promise<void> {
    if (pending.current) return pending.current;
    const current = draftRef.current;
    if (current.title === chapter.title && current.body === chapter.blocks.body && !current.changeNote?.trim()) return Promise.resolve();
    setSaving(true);
    const task = save(current).then(() => {
      try { localStorage.removeItem(key); } catch { /* Saved server copy is authoritative. */ }
    }).finally(() => { pending.current = null; setSaving(false); });
    pending.current = task;
    return task;
  }

  useEffect(() => { handle.current = { prepare, snapshot: () => draftRef.current }; return () => { handle.current = null; }; });
  useEffect(() => { onChange(draft); }, [draft, onChange]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  function update(next: Draft) {
    draftRef.current = next; setDraft(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setError(''); }
    catch { setError('本机草稿无法保存，请点击保存章节。'); }
  }
  return <section aria-label="章节写作" className="space-y-4">
    <DesktopWritingContext storyId={chapter.storyId} getSnapshot={() => {
      const start = selection.current?.start ?? draft.body.length;
      const end = selection.current?.end ?? start;
      return { draft: draft.body, cursor: start, ...(end > start ? { selection: { start, end } } : {}), scope: `${scope}:chapter:${chapter.id}:${chapter.version}` };
    }} />
    <label className="block text-sm">标题<input aria-label="章节标题" maxLength={200} disabled={disabled || saving} className="mt-2 w-full border-b bg-transparent py-2 text-xl outline-none" value={draft.title} onChange={e => update({ ...draft, title: e.target.value })} /></label>
    <ChapterTextModules formatScope={`${scope}:${chapter.id}`} value={draft.body} selection={selection} disabled={disabled || saving} onChange={body => update({ ...draft, body })} />
    <details><summary className="cursor-pointer text-xs text-muted-foreground">修改说明（选填）</summary><textarea aria-label="修改说明（选填）" maxLength={500} disabled={disabled || saving} className="mt-2 w-full rounded border bg-transparent p-2 text-sm" value={draft.changeNote ?? ""} onChange={e => update({ ...draft, changeNote: e.target.value })} placeholder="由你自己填写；留空就不显示。" /></details>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex items-center gap-3"><button disabled={disabled || saving || !dirty} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" onClick={() => void prepare().catch(cause => setError(cause instanceof Error ? cause.message : '保存失败'))}>保存章节</button><span role="status" className="text-xs text-muted-foreground">{dirty ? '未保存 · 草稿保留在本机' : '已保存'}</span></div>
  </section>;
}
