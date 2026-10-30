import { normalizeWritingColumns } from '@shared/bookWritingStyle';
import type { BookWritingStyle } from '@shared/bookWritingStyle';
import { writingStyleOf, restoreStyledBlocks } from './chapterBlockTree';
import { BookInlineImage } from "./BookImageCrop";
import { bookImageUrl, bookImageText } from "./bookImageBlock";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { textModuleOffset, textModulePosition, type TextPosition } from './moduleTextEditing';
import { blockBody, insertBlockText, mergeWritingBlocks, restoreWritingBlocks, newWritingBlock, blockSubtreeEnd, isHeading, type WritingBlock } from './chapterBlockTree';
import { BookBlockCanvas } from './BookBlockCanvas';
import { bookBlockContext } from './bookBlockContext';
import { textChanges } from './textChanges';
import { ChangedText, afterTextSlice, type WritingComparison } from './WritingComparison';
import type { LayoutModuleContext } from '@shared/layoutModuleContext';

type Snapshot = TextPosition & { blocks: WritingBlock[] };
export function ChapterTextModules({ writingStyle, onFormattedChange, imageInsert, value, onChange, disabled, selection, formatScope, contextSource, onContextChange, comparison }: {
  writingStyle?: BookWritingStyle;
  onFormattedChange?(body:string,style:BookWritingStyle):void;
  imageInsert?: MutableRefObject<((url: string) => void) | null>;
  comparison?: WritingComparison;
  value: string; onChange(value: string): void; disabled: boolean;
  selection: MutableRefObject<TextPosition | null>; formatScope?: string;
  contextSource?: { storyId: number; scope: string; chapterId: string };
  onContextChange?(context: LayoutModuleContext | null): void;
}) {
  const changes = useMemo(() => comparison ? textChanges(comparison.body, value) : [], [comparison?.body, value]);
  const key = formatScope ? `chapter-block-formats:${formatScope}` : null;
  const [blocks, setBlocks] = useState(() => {
    if (writingStyle) return restoreStyledBlocks(value,writingStyle);
    try { return restoreWritingBlocks(value, key ? JSON.parse(localStorage.getItem(key) || 'null') : null); }
    catch { return restoreWritingBlocks(value, null); }
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const module = useMemo(() => contextSource && blockBody(blocks) === value
    ? bookBlockContext(blocks, activeId, contextSource) : null,
    [blocks, activeId, value, contextSource?.storyId, contextSource?.scope, contextSource?.chapterId]);
  useLayoutEffect(() => { onContextChange?.(module); }, [module, onContextChange]);
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
      const start = textModulePosition(value, focus.current.start), end = textModulePosition(value, focus.current.end);
      const field = fields.current[start.index];
      field?.focus(); field?.setSelectionRange(start.cursor, end.index === start.index ? end.cursor : start.cursor);
      focus.current = null;
    }
  }, [value, blocks]);
  function selected(index: number, field: HTMLTextAreaElement) {
    setActiveId(blocks[index].id);
    const offset = textModuleOffset(value, index);
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
    setActiveId(next[textModulePosition(blockBody(next), position).index]?.id ?? null);
    setBlocks(next);
    if (onFormattedChange) onFormattedChange(blockBody(next),writingStyleOf(next));
    else if (blockBody(next) !== value) onChange(blockBody(next));
  }
  useLayoutEffect(() => {
    if (!imageInsert) return;
    imageInsert.current = url => {
      if (disabled) return;
      const index = blocks.findIndex(block => block.id === activeId);
      const current = blocks[index];
      const at = index < 0 ? blocks.length : isHeading(current) && current.collapsed ? blockSubtreeEnd(blocks,index) : index + 1;
      const parent = current ? isHeading(current) && !current.collapsed ? current.id : current.parentId : null;
      const image = newWritingBlock(bookImageText(url),parent);
      const next = [...blocks.slice(0,at),image,...blocks.slice(at)];
      commit(next,textModuleOffset(blockBody(next),at),false);
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
    setActiveId(previous.blocks[textModulePosition(blockBody(previous.blocks), previous.start).index]?.id ?? null);
    if (onFormattedChange) onFormattedChange(blockBody(previous.blocks),writingStyleOf(previous.blocks));
    else onChange(blockBody(previous.blocks));
  }
  function renderField(block: WritingBlock, index: number, style: CSSProperties) {
    const imageUrl = bookImageUrl(block.text);
    if (imageUrl) return <button type="button" aria-label={`图片模块 ${index + 1}`} disabled={disabled} className="block h-full w-full text-left" onKeyDown={event => {
      if(event.key === 'Enter') { event.preventDefault(); const next = [...blocks]; next.splice(index+1,0,newWritingBlock('',block.parentId)); commit(next,textModuleOffset(blockBody(next),index+1)); }
    }} onClick={() => {
      setActiveId(block.id);
      const start = textModuleOffset(value,index); selection.current = {start,end:start};
      window.dispatchEvent(new Event('dt:writing-selection-change'));
    }}><BookInlineImage text={block.text}/></button>;
    const field = <textarea ref={element => { fields.current[index] = element; }} rows={1} aria-label={`文字模块 ${index + 1}`} value={block.text}
              disabled={disabled} maxLength={200000} placeholder="写下这一段…" style={style}
              className={comparison ? "col-start-1 row-start-1 block h-full min-h-[1.6em] w-full resize-none overflow-hidden border-0 bg-transparent px-1 py-0 text-transparent caret-foreground outline-none selection:bg-blue-200/50" : "block h-full w-full resize-none overflow-auto border-0 bg-transparent px-1 py-0 outline-none"}
              onFocus={event => selected(index, event.currentTarget)} onSelect={event => selected(index, event.currentTarget)}
              onChange={event => {
                const field = event.currentTarget;
                const result = insertBlockText(blocks, index, field.value);
                const before = field.value.slice(0, field.selectionStart).replace(/\r\n?/g, '\n').split('\n');
                const cursorIndex = before.length > 1 ? result.insertedIndex + before.length - 2 : index;
                commit(result.blocks, textModuleOffset(blockBody(result.blocks), cursorIndex) + before[before.length - 1].length, before.length > 1);
              }}
              onKeyDown={event => {
                if (disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                const field = event.currentTarget; selected(index, field);
                if ((event.metaKey || event.ctrlKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
                  event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y'); return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const result = insertBlockText(blocks, index, block.text.slice(0, field.selectionStart) + '\n' + block.text.slice(field.selectionEnd));
                  commit(result.blocks, textModuleOffset(blockBody(result.blocks), result.insertedIndex));
                } else if (event.key === 'Backspace' && !field.selectionStart && !field.selectionEnd && index > 0) {
                  event.preventDefault();
                  if (bookImageUrl(blocks[index-1].text)) return;
                  const next = mergeWritingBlocks(blocks, index - 1);
                  commit(next, textModuleOffset(value, index) - 1);
                } else if (event.key === 'Delete' && field.selectionStart === block.text.length && field.selectionEnd === block.text.length && index < blocks.length - 1) {
                  event.preventDefault();
                  if (bookImageUrl(blocks[index+1].text)) return;
                  commit(mergeWritingBlocks(blocks, index), textModuleOffset(value, index) + block.text.length);
                }
              }} />;
    if (!comparison) return field;
    const start = textModuleOffset(value, index);
    return <div key={block.id} className="grid" style={style}>
      <div aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 min-h-[1.6em] whitespace-pre-wrap break-words px-1" style={{ overflowWrap: 'anywhere' }}>
        <ChangedText changes={afterTextSlice(changes, start, start + block.text.length)} side="after" />{!block.text || block.text.endsWith('\n') ? '\u200b' : ''}
      </div>
      {field}
    </div>;
  }
  return <section aria-label="书正文" onKeyDown={event => {
    if (disabled || event.target instanceof HTMLTextAreaElement || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (['z', 'y'].includes(event.key.toLowerCase())) { event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y'); }
  }}>
    {comparison ? <div className="overflow-x-auto" aria-label="版本文字对比">
      <div className="grid min-w-[560px] grid-cols-2 gap-5">
        <article className="min-w-0 select-text border-r pr-4" aria-label="所选版本原文">
          <h3 className="text-sm font-medium">{comparison.label} · {comparison.title}</h3>
          {comparison.editorName && <p className="text-xs text-muted-foreground">{comparison.editorName}</p>}
          {comparison.note && <p className="text-xs text-muted-foreground">{comparison.note}</p>}
          <div className="mt-3 whitespace-pre-wrap break-words text-base leading-[1.6]" aria-label="旧稿文字"><ChangedText changes={changes} side="before" />{!comparison.body && '（空白）'}</div>
        </article>
        <article className="min-w-0" aria-label="当前版本编辑">
          <h3 className="mb-3 text-sm font-medium">当前稿 · 可直接编辑</h3>
          <div className="space-y-0">{blocks.map((block, index) => renderField(block, index, { fontSize: 16, lineHeight: 1.6, overflowWrap: 'anywhere' }))}</div>
        </article>
      </div>
    </div> : <BookBlockCanvas activeId={activeId} onSelect={id => {
      setActiveId(id);
      const index = blocks.findIndex(block => block.id === id);
      if (index >= 0 && id !== activeId) {
        const start = textModuleOffset(value, index);
        selection.current = { start, end: start };
      }
    }} blocks={blocks} disabled={disabled} onCommit={(next, id, restoreFocus = true) => {
      commit(next, textModuleOffset(blockBody(next), Math.max(0, next.findIndex(block => block.id === id))), restoreFocus);
    }}>{renderField}
    </BookBlockCanvas>}
    {cacheError && <p role="alert" className="text-xs text-destructive">本机无法保存模块格式，请暂时不要关闭页面。</p>}
  </section>;
}
