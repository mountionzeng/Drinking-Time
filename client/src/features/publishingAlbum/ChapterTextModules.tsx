import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { MediaPlayer } from "@/components/ui/media-player";
import { useBookModuleActions } from "./bookModuleActions";
import { mergeBookText } from "./mergeBookText";
import { INSERT_WAREHOUSE_BOOK, type WarehouseBookInsert } from "./warehouseBookInsert";
import { BookModuleConvert, type ModuleConversion } from "./BookModuleConvert";
import { readBookAudio } from "@shared/bookAudioBlock";
import { BookMusicInsert } from "./BookMusicInsert";
import { normalizeWritingColumns } from '@shared/bookWritingStyle';
import { useBookMediaSession } from "./bookMediaSession";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import type { BookWritingStyle } from '@shared/bookWritingStyle';
import { writingStyleOf, restoreStyledBlocks } from './chapterBlockTree';
import { BookInlineImage } from "./BookImageCrop";
import { bookImageUrl, bookImageText, readBookImage } from "@shared/bookImageBlock";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { type TextPosition } from './moduleTextEditing';
import { writingBlockOffset, writingBlockPosition, splitWritingBlock, insertBlockText, blockBody, mergeWritingBlocks, restoreWritingBlocks, newWritingBlock, blockSubtreeEnd, isHeading, type WritingBlock } from './chapterBlockTree';
import { BookBlockCanvas } from './BookBlockCanvas';
import { bookBlockContext, bookSelectionContext } from './bookBlockContext';
import { textChanges } from './textChanges';
import { ChangedText, afterTextSlice, type WritingComparison } from './WritingComparison';
import type { LayoutModuleContext } from '@shared/layoutModuleContext';

type Snapshot = TextPosition & { blocks: WritingBlock[] };
export function ChapterTextModules({ importedChapterIds, prepareMedia, writingStyle, onFormattedChange, imageInsert, value, onChange, disabled, selection, formatScope, contextSource, onContextChange, comparison }: {
  importedChapterIds?: readonly string[];
  prepareMedia?(): Promise<void>;
  writingStyle?: BookWritingStyle;
  onFormattedChange?(body:string,style:BookWritingStyle):void;
  imageInsert?: MutableRefObject<((url: string) => void) | null>;
  comparison?: WritingComparison;
  value: string; onChange(value: string): void; disabled: boolean;
  selection: MutableRefObject<TextPosition | null>; formatScope?: string;
  contextSource?: { storyId: number; scope: string; chapterId: string };
  onContextChange?(context: LayoutModuleContext | null): void;
}) {
  const _ui = useDesktopUiText();
  const changes = useMemo(() => comparison ? textChanges(comparison.body, value) : [], [comparison?.body, value]);
  // An imported heading can be visually open even if its previously saved
  // collapsed flag is true. Splitting that visible heading must still insert
  // text under the heading, never as a sibling chapter.
  const editableBlocks = (id: string) => importedChapterIds?.includes(id)
    ? blocks.map(item => item.id === id && item.collapsed ? { ...item, collapsed: false } : item)
    : blocks;
  const key = formatScope ? `chapter-block-formats:${formatScope}` : null;
  const [blocks, setBlocks] = useState(() => {
    if (writingStyle) return restoreStyledBlocks(value,writingStyle);
    try { return restoreWritingBlocks(value, key ? JSON.parse(localStorage.getItem(key) || 'null') : null); }
    catch { return restoreWritingBlocks(value, null); }
  });
  // Legacy plain-text chapters have no stable module IDs on the server yet.
  // Persist the same IDs rendered here before media preparation can quote them.
  useLayoutEffect(() => {
    if (!writingStyle && onFormattedChange && blockBody(blocks) === value)
      onFormattedChange(value, writingStyleOf(blocks));
  }, [writingStyle, value, blocks, onFormattedChange]);
  const [conversion,setConversion]=useState<ModuleConversion|null>(null);
  useEffect(()=>setConversion(null),[formatScope]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
  const [mediaSelection, setMediaSelection] = useState(0);
  const module = useMemo(() => contextSource && blockBody(blocks) === value
    ? (selectedModuleIds.length > 1 ? bookSelectionContext(blocks, selectedModuleIds, contextSource) : bookBlockContext(blocks, activeId, contextSource)) : null,
    [blocks, activeId, selectedModuleIds, value, contextSource?.storyId, contextSource?.scope, contextSource?.chapterId]);
  useLayoutEffect(() => { onContextChange?.(module); }, [module, onContextChange]);
  const mediaLatest = useRef({ blocks, disabled, prepareMedia });
  mediaLatest.current = { blocks, disabled, prepareMedia };
  const commitLatest = useRef(commit); commitLatest.current = commit;
  const warehouseAnchor=useRef(activeId);warehouseAnchor.current=activeId;
  useLayoutEffect(() => {
    if (!contextSource || disabled || comparison || blockBody(blocks) !== value) return;
    const session = {
      scope: contextSource.scope, storyId: contextSource.storyId,
      modules: blocks.filter(block => !readBookImage(block.text) && !readBookAudio(block.text))
        .map(block => ({ id: block.id, text: block.text })),
      convert(id: string, kind: "image" | "music") {
        assertCurrent();
        const block = blocks.find(item => item.id === id);
        if (!block || readBookImage(block.text) || readBookAudio(block.text) || !mediaLatest.current.prepareMedia)
          throw new Error("当前模块无法转换，请重新选择文字模块。");
        setConversion({ id, text: block.text, kind });
      },
      merge(ids: string[]) {
        assertCurrent();
        if (ids.some(id => !session.modules.some(item => item.id === id)))
          throw new Error("模块已变化，请重新选择。");
        const next = mergeBookText(blocks, ids);
        const first = blocks.find(block => ids.includes(block.id));
        if (!first || next === blocks) throw new Error("请选择至少两个文字模块。");
        commitLatest.current(next, writingBlockOffset(next, next.findIndex(block => block.id === first.id)), false);
        setSelectedModuleIds([]); setActiveId(first.id);
      },
    };
    function assertCurrent() {
      if (useBookModuleActions.getState().session !== session || mediaLatest.current.disabled || mediaLatest.current.blocks !== blocks)
        throw new Error("文章已变化，请重新选择模块。");
    }
    useBookModuleActions.getState().setSession(session);
    return () => { if (useBookModuleActions.getState().session === session) useBookModuleActions.getState().setSession(null); };
  }, [contextSource?.scope, contextSource?.storyId, blocks, disabled, comparison, value]);

  useEffect(()=>{
    const insert=(event:Event)=>{
      const detail=(event as CustomEvent<WarehouseBookInsert>).detail,latest=mediaLatest.current;
      if(!contextSource || detail.storyId!==contextSource.storyId || detail.accepted || latest.disabled || comparison) return;
      const index=latest.blocks.findIndex(b=>b.id===warehouseAnchor.current),current=latest.blocks[index];
      const at=index<0?latest.blocks.length:isHeading(current)?blockSubtreeEnd(latest.blocks,index):index+1;
      const added=detail.text.split('\n').filter(t=>t.trim()).map(t=>newWritingBlock(t,current?.parentId??null));
      if(!added.length)return;
      const next=[...latest.blocks.slice(0,at),...added,...latest.blocks.slice(at)];
      if(blockBody(next).length>200000)return;
      commitLatest.current(next,writingBlockOffset(next,at),false);setActiveId(added[0].id);detail.accepted=true;
    };
    window.addEventListener(INSERT_WAREHOUSE_BOOK,insert);return ()=>window.removeEventListener(INSERT_WAREHOUSE_BOOK,insert);
  },[contextSource?.storyId,formatScope,comparison]);

  useLayoutEffect(() => {
    const block = blocks.find(item => item.id === activeId);
    const media = block && readBookImage(block.text);
    if (selectedModuleIds.length > 1 || !contextSource || !block || !media || !prepareMedia) {
      const current = useBookMediaSession.getState().session;
      if (current?.key.startsWith(`${formatScope}:`)) useBookMediaSession.getState().setSession(null);
      return;
    }
    const spine = storySpineStore.getState();
    const key = `${formatScope}:${block.id}`;
    useBookMediaSession.getState().setSession({
      key, accountId: spine.accountId, epoch: spine.storyScopeEpoch,
      storyId: contextSource.storyId, chapterId: Number(contextSource.chapterId), moduleId: block.id, imageUrl: media.url,
      prepare: () => mediaLatest.current.prepareMedia!(),
      replace: async (sourceUrl, result) => {
        const latest = mediaLatest.current;
        const currentSpine = storySpineStore.getState();
        if (latest.disabled || currentSpine.accountId !== spine.accountId || currentSpine.storyScopeEpoch !== spine.storyScopeEpoch) return false;
        const index = latest.blocks.findIndex(item => item.id === block.id);
        const original = index >= 0 && readBookImage(latest.blocks[index].text);
        if (!original || original.url !== sourceUrl) return false;
        const next = latest.blocks.map((item, i) => i === index ? { ...item,
          text: bookImageText(result.imageUrl ?? original.url, original.crop, original.scale, original.frame, result.videoUrl),
        } : item);
        commitLatest.current(next, writingBlockOffset(next, index), false);
        await mediaLatest.current.prepareMedia!();
        return true;
      },
    });
    return () => { if (useBookMediaSession.getState().session?.key === key) useBookMediaSession.getState().setSession(null); };
  }, [activeId, selectedModuleIds, mediaSelection, blocks, contextSource?.scope, formatScope]);
  const fields = useRef<Array<HTMLTextAreaElement | null>>([]);
  const focus = useRef<TextPosition | null>(null);
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const [cacheError, setCacheError] = useState(false);
  // A different saved version must never inherit unrelated hierarchy by line number.
  const renderedBody = blockBody(blocks);
  useEffect(() => {
    if (renderedBody !== value) {
      setBlocks(writingStyle ? restoreStyledBlocks(value,writingStyle) : restoreWritingBlocks(value, null));
      history.current = { past: [], future: [] };
    }
  }, [value, renderedBody]);
  useEffect(() => {
    if (renderedBody !== value) return;
    try { if (key) localStorage.setItem(key, JSON.stringify({ body: value, blocks })); setCacheError(false); }
    catch { setCacheError(true); }
  }, [key, value, blocks, renderedBody]);
  useLayoutEffect(() => {
    if (focus.current) {
      const start = writingBlockPosition(blocks, focus.current.start), end = writingBlockPosition(blocks, focus.current.end);
      const field = fields.current[start.index];
      field?.focus(); field?.setSelectionRange(start.cursor, end.index === start.index ? end.cursor : start.cursor);
      focus.current = null;
    }
  }, [value, blocks]);
  function selected(index: number, field: HTMLTextAreaElement) {
    setSelectedModuleIds([]);
    setActiveId(blocks[index].id);
    const offset = writingBlockOffset(blocks, index);
    selection.current = { start: offset + field.selectionStart, end: offset + field.selectionEnd };
    window.dispatchEvent(new Event('dt:writing-selection-change'));
  }
  function snapshot(): Snapshot { return { blocks, ...(selection.current ?? { start: value.length, end: value.length }) }; }
  function commit(next: WritingBlock[], position: number, restoreFocus = true) {
    if (disabled || next === blocks || blockBody(next).length > 200000) return;
    next = normalizeWritingColumns(next);
    history.current.past.push(snapshot()); history.current.past = history.current.past.slice(-50); history.current.future = [];
    selection.current = { start: position, end: position };
    if (restoreFocus) focus.current = selection.current;
    setActiveId(next[writingBlockPosition(next, position).index]?.id ?? null);
    setBlocks(next);
    if (onFormattedChange) onFormattedChange(blockBody(next),writingStyleOf(next));
    else if (blockBody(next) !== value) onChange(blockBody(next));
  }
  useLayoutEffect(() => {
    if (!imageInsert) return;
    imageInsert.current = url => {
      if (disabled) return;
      const index = blocks.findIndex(block => block.id === activeId);
      const selected = blocks[index];
      const current = selected && importedChapterIds?.includes(selected.id) ? { ...selected, collapsed: false } : selected;
      const at = index < 0 ? blocks.length : isHeading(current) && current.collapsed ? blockSubtreeEnd(blocks,index) : index + 1;
      const parent = current ? isHeading(current) && !current.collapsed ? current.id : current.parentId : null;
      const image = newWritingBlock(bookImageText(url),parent);
      const next = [...blocks.slice(0,at),image,...blocks.slice(at)];
      commit(next,writingBlockOffset(next,at),false);
      setActiveId(image.id);
    };
    return () => {imageInsert.current = null;};
  });
  function travel(redo: boolean) {
    const source = redo ? history.current.future : history.current.past;
    const target = redo ? history.current.past : history.current.future;
    const previous = source.pop(); if (!previous) return;
    target.push(snapshot()); setBlocks(previous.blocks);
    selection.current = { start: previous.start, end: previous.end }; focus.current = selection.current;
    setActiveId(previous.blocks[writingBlockPosition(previous.blocks, previous.start).index]?.id ?? null);
    if (onFormattedChange) onFormattedChange(blockBody(previous.blocks),writingStyleOf(previous.blocks));
    else onChange(blockBody(previous.blocks));
  }
  function renderField(block: WritingBlock, index: number, style: CSSProperties) {
    const audio = readBookAudio(block.text);
    if (audio) return <div key={block.id} aria-label={_ui("{0}模块 {1}", [audio.kind==='narration'?_ui("有声书"):_ui("音乐"), index + 1])} onClick={() => setActiveId(block.id)} className="h-full w-full overflow-hidden">
      <p className="truncate text-sm">♫ {audio.title}</p><MediaPlayer kind="audio" aria-label={audio.title} controls preload="none" src={audio.url} className="h-10 w-full" />
    </div>;
    const imageUrl = bookImageUrl(block.text);
    if (imageUrl) return <div key={block.id} role="button" tabIndex={disabled ? -1 : 0} aria-label={_ui("图片模块 {0}", [index + 1])} aria-disabled={disabled} className="block h-full w-full text-left" onKeyDown={event => {
      if(disabled || event.target !== event.currentTarget) return;
      if(event.key === 'Enter') { event.preventDefault(); const next = [...blocks]; next.splice(index+1,0,newWritingBlock('',block.parentId)); commit(next,writingBlockOffset(next,index+1)); }
    }} onClick={() => {
      if (disabled) return;
      setMediaSelection(value => value + 1);
      setActiveId(block.id);
      const start = writingBlockOffset(blocks,index); selection.current = {start,end:start};
      window.dispatchEvent(new Event('dt:writing-selection-change'));
    }}><BookInlineImage text={block.text}/></div>;
    const field = <textarea ref={element => { fields.current[index] = element; }} rows={1} aria-label={_ui("文字模块 {0}", [index + 1])} value={block.text}
              disabled={disabled} maxLength={200000} placeholder={_ui("写下这一段…")} style={style}
              className={comparison ? "col-start-1 row-start-1 block h-full min-h-[1.6em] w-full resize-none overflow-hidden border-0 bg-transparent px-1 py-0 text-transparent caret-foreground outline-none selection:bg-blue-200/50" : "block h-full w-full resize-none overflow-auto border-0 bg-transparent px-1 py-0 outline-none"}
              onFocus={event => selected(index, event.currentTarget)} onSelect={event => selected(index, event.currentTarget)}
              onChange={event => {
                const field = event.currentTarget;
                // Preserve the existing paste-to-modules behavior for ordinary single-line blocks.
                if(!block.text.includes('\n') && field.value.includes('\n')) {
                  const result=insertBlockText(editableBlocks(block.id),index,field.value);
                  const before=field.value.slice(0,field.selectionStart).replace(/\r\n?/g,'\n').split('\n');
                  const cursorIndex=before.length>1?result.insertedIndex+before.length-2:index;
                  commit(result.blocks,writingBlockOffset(result.blocks,cursorIndex)+before[before.length-1].length,true);
                  return;
                }
                // Existing internal line breaks belong to this module; only Enter splits it.
                const next=blocks.map((item,i)=>i===index?{...item,text:field.value}:item);
                commit(next,writingBlockOffset(next,index)+field.selectionStart,false);
              }}
              onKeyDown={event => {
                if (disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                const field = event.currentTarget; selected(index, field);
                if ((event.metaKey || event.ctrlKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
                  event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y'); return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const result = splitWritingBlock(editableBlocks(block.id),index,field.selectionStart,field.selectionEnd);
                  commit(result.blocks, writingBlockOffset(result.blocks, result.insertedIndex));
                } else if (event.key === 'Backspace' && !field.selectionStart && !field.selectionEnd && index > 0) {
                  event.preventDefault();
                  if (bookImageUrl(blocks[index-1].text) || readBookAudio(blocks[index-1].text)) return;
                  const next = mergeWritingBlocks(blocks, index - 1);
                  commit(next, writingBlockOffset(blocks, index) - 1);
                } else if (event.key === 'Delete' && field.selectionStart === block.text.length && field.selectionEnd === block.text.length && index < blocks.length - 1) {
                  event.preventDefault();
                  if (bookImageUrl(blocks[index+1].text) || readBookAudio(blocks[index+1].text)) return;
                  commit(mergeWritingBlocks(blocks, index), writingBlockOffset(blocks, index) + block.text.length);
                }
              }} />;
    if (!comparison) return field;
    const start = writingBlockOffset(blocks, index);
    return <div key={block.id} className="grid" style={style}>
      <div aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 min-h-[1.6em] whitespace-pre-wrap break-words px-1" style={{ overflowWrap: 'anywhere' }}>
        <ChangedText changes={afterTextSlice(changes, start, start + block.text.length)} side="after" />{!block.text || block.text.endsWith('\n') ? '\u200b' : ''}
      </div>
      {field}
    </div>;
  }
  return <section aria-label={_ui("书正文")} onKeyDown={event => {
    if (disabled || event.target instanceof HTMLTextAreaElement || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y'); }
  }}>
    {comparison ? <div className="overflow-x-auto" aria-label={_ui("版本文字对比")}>
      <div className="grid min-w-[560px] grid-cols-2 gap-5">
        <article className="min-w-0 select-text border-r pr-4" aria-label={_ui("所选版本原文")}>
          <h3 className="text-sm font-medium">{comparison.label} · {comparison.title}</h3>
          {comparison.editorName && <p className="text-xs text-muted-foreground">{comparison.editorName}</p>}
          {comparison.note && <p className="text-xs text-muted-foreground">{comparison.note}</p>}
          <div className="mt-3 whitespace-pre-wrap break-words text-base leading-[1.6]" aria-label={_ui("旧稿文字")}><ChangedText changes={changes} side="before" />{!comparison.body && _ui("（空白）")}</div>
        </article>
        <article className="min-w-0" aria-label={_ui("当前版本编辑")}>
          <h3 className="mb-3 text-sm font-medium">{_ui("当前稿 · 可直接编辑")}</h3>
          <div className="space-y-0">{blocks.map((block, index) => renderField(block, index, { fontSize: 16, lineHeight: 1.6, overflowWrap: 'anywhere' }))}</div>
        </article>
      </div>
    </div> : <BookBlockCanvas importedChapterIds={importedChapterIds} onConvert={contextSource && prepareMedia ? (id,kind)=>{
      const block=blocks.find(b=>b.id===id);if(block)setConversion({id,text:block.text,kind});
    }:undefined} onSelectionChange={setSelectedModuleIds} activeId={activeId} onSelect={id => {
      if (id && bookImageUrl(blocks.find(block => block.id === id)?.text ?? "")) setMediaSelection(value => value + 1);
      setActiveId(id);
      const index = blocks.findIndex(block => block.id === id);
      if (index >= 0 && id !== activeId) {
        const start = writingBlockOffset(blocks, index);
        selection.current = { start, end: start };
      }
    }} blocks={blocks} disabled={disabled} onCommit={(next, id, restoreFocus = true) => {
      commit(next, writingBlockOffset(next, Math.max(0, next.findIndex(block => block.id === id))), restoreFocus);
    }}>{renderField}
    </BookBlockCanvas>}
    {conversion && contextSource && prepareMedia && <BookModuleConvert key={`${formatScope}:${conversion.id}:${conversion.kind}`} source={conversion} storyId={contextSource.storyId} chapterId={Number(contextSource.chapterId)} onClose={()=>setConversion(null)} prepare={async()=>{
      const latest=mediaLatest.current;
      if(latest.disabled || latest.blocks.find(b=>b.id===conversion.id)?.text!==conversion.text)throw new Error('原模块已变化，请重新选择');
      await latest.prepareMedia!();
    }} onInsert={text=>{
      const latest=mediaLatest.current, index=latest.blocks.findIndex(b=>b.id===conversion.id);
      if(latest.disabled || index<0 || latest.blocks[index].text!==conversion.text)throw new Error('原模块已变化，结果仍保留，请重新选择插入位置');
      const image = readBookImage(text);
      if (image && latest.blocks.some(block => readBookImage(block.text)?.url === image.url)) { setConversion(null); return; }
      const current=latest.blocks[index], at=isHeading(current)?blockSubtreeEnd(latest.blocks,index):index+1;
      const added=newWritingBlock(text,current.parentId),next=[...latest.blocks.slice(0,at),added,...latest.blocks.slice(at)];
      if(blockBody(next).length>200000)throw new Error('文章过长，无法插入');
      commitLatest.current(next,writingBlockOffset(next,at),false);setActiveId(added.id);setConversion(null);
    }}/>}
    {contextSource && !comparison && <BookMusicInsert key={formatScope} storyId={contextSource.storyId} disabled={disabled} prepare={prepareMedia} onInsert={text => {
      const index=blocks.findIndex(block=>block.id===activeId), selected=blocks[index];
      const current=selected && importedChapterIds?.includes(selected.id) ? {...selected,collapsed:false} : selected;
      const at=index<0?blocks.length:isHeading(current)&&current.collapsed?blockSubtreeEnd(blocks,index):index+1;
      const parent=current?isHeading(current)&&!current.collapsed?current.id:current.parentId:null;
      const audio=newWritingBlock(text,parent), next=[...blocks.slice(0,at),audio,...blocks.slice(at)];
      commit(next,writingBlockOffset(next,at),false);setActiveId(audio.id);
    }}/>}
    {cacheError && <p role="alert" className="text-xs text-destructive">{_ui("本机无法保存模块格式，请暂时不要关闭页面。")}</p>}
  </section>;
}
