import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MutableRefObject } from 'react';
import { textModuleOffset, textModulePosition, type TextPosition } from './moduleTextEditing';
import { blockAncestors, blockBody, insertBlockText, isHeading, mergeWritingBlocks, moveWritingBlock, restoreWritingBlocks, setBlockFormat, type BlockDrop, type BlockFormat, type WritingBlock } from './chapterBlockTree';

type Snapshot = TextPosition & { blocks: WritingBlock[] };
export function ChapterTextModules({ value, onChange, disabled, selection, formatScope }: {
  value: string; onChange(value: string): void; disabled: boolean;
  selection: MutableRefObject<TextPosition | null>; formatScope?: string;
}) {
  const key = formatScope ? `chapter-block-formats:${formatScope}` : null;
  const [blocks, setBlocks] = useState(() => {
    try { return restoreWritingBlocks(value, key ? JSON.parse(localStorage.getItem(key) || 'null') : null); }
    catch { return restoreWritingBlocks(value, null); }
  });
  const [drop, setDrop] = useState<{ id: string; placement: BlockDrop } | null>(null);
  const dragged = useRef<string | null>(null);
  const fields = useRef<Array<HTMLTextAreaElement | null>>([]);
  const focus = useRef<TextPosition | null>(null);
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const [cacheError, setCacheError] = useState(false);
  // A different saved version must never inherit unrelated hierarchy by line number.
  const renderedBody = blockBody(blocks);
  useEffect(() => {
    if (renderedBody !== value) {
      setBlocks(restoreWritingBlocks(value, null));
      history.current = { past: [], future: [] };
    }
  }, [value, renderedBody]);
  useEffect(() => {
    if (renderedBody !== value) return;
    try { if (key) localStorage.setItem(key, JSON.stringify({ body: value, blocks })); setCacheError(false); }
    catch { setCacheError(true); }
  }, [key, value, blocks, renderedBody]);
  useLayoutEffect(() => {
    for (const field of fields.current) {
      if (!field || !field.getClientRects().length) continue;
      field.style.height = '0px'; field.style.height = `${Math.max(40, field.scrollHeight)}px`;
    }
    if (focus.current) {
      const start = textModulePosition(value, focus.current.start), end = textModulePosition(value, focus.current.end);
      const field = fields.current[start.index];
      field?.focus(); field?.setSelectionRange(start.cursor, end.index === start.index ? end.cursor : start.cursor);
      focus.current = null;
    }
  }, [value, blocks]);
  function selected(index: number, field: HTMLTextAreaElement) {
    const offset = textModuleOffset(value, index);
    selection.current = { start: offset + field.selectionStart, end: offset + field.selectionEnd };
    window.dispatchEvent(new Event('dt:writing-selection-change'));
  }
  function snapshot(): Snapshot { return { blocks, ...(selection.current ?? { start: value.length, end: value.length }) }; }
  function commit(next: WritingBlock[], position: number, restoreFocus = true) {
    if (disabled || next === blocks || blockBody(next).length > 200000) return;
    history.current.past.push(snapshot()); history.current.past = history.current.past.slice(-50); history.current.future = [];
    selection.current = { start: position, end: position };
    if (restoreFocus) focus.current = selection.current;
    setBlocks(next);
    if (blockBody(next) !== value) onChange(blockBody(next));
  }
  function travel(redo: boolean) {
    const source = redo ? history.current.future : history.current.past;
    const target = redo ? history.current.past : history.current.future;
    const previous = source.pop(); if (!previous) return;
    target.push(snapshot()); setBlocks(previous.blocks);
    selection.current = { start: previous.start, end: previous.end }; focus.current = selection.current;
    onChange(blockBody(previous.blocks));
  }
  function move(source: string, target: string, placement: BlockDrop) {
    const next = moveWritingBlock(blocks, source, target, placement);
    const index = next.findIndex(block => block.id === source);
    commit(next, textModuleOffset(blockBody(next), index));
  }
  function changeFormat(index: number, format: string) {
    if (['text', 'heading1', 'heading2', 'heading3'].includes(format))
      commit(setBlockFormat(blocks, index, format as BlockFormat), textModuleOffset(value, index));
  }
  function dragOver(event: DragEvent<HTMLLIElement>, block: WritingBlock) {
    if (disabled || !dragged.current || dragged.current === block.id || blockAncestors(blocks, block.id).includes(dragged.current)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    const placement = isHeading(block) && ratio > 0.25 && ratio < 0.75 ? 'inside' : ratio < 0.5 ? 'before' : 'after';
    setDrop({ id: block.id, placement });
  }
  return <section aria-label="章节正文" className="space-y-2">
    <ol aria-label="章节文字模块" className="space-y-1">
      {blocks.map((block, index) => {
        const ancestors = blockAncestors(blocks, block.id);
        const hidden = ancestors.some(id => blocks.find(other => other.id === id)?.collapsed);
        const level = isHeading(block) ? Number(block.format.slice(-1)) : 0;
        const target = drop?.id === block.id ? drop.placement : null;
        return <li key={block.id} hidden={hidden} style={{ marginLeft: `${Math.min(ancestors.length, 4) * 16}px` }}
          onDragOver={event => dragOver(event, block)}
          onDrop={event => {
            event.preventDefault();
            if (!disabled && dragged.current && drop?.id === block.id) move(dragged.current, block.id, drop.placement);
            dragged.current = null; setDrop(null);
          }}
          className={`group relative flex items-start gap-1 rounded px-1 focus-within:pt-7 hover:bg-[var(--nayin-surface)]/40 focus-within:bg-[var(--nayin-surface)]/40 ${target === 'inside' ? 'ring-2 ring-[var(--nayin-accent)]' : target === 'before' ? 'border-t-2 border-[var(--nayin-accent)]' : target === 'after' ? 'border-b-2 border-[var(--nayin-accent)]' : ''}`}>
          <div className="relative mt-2 flex w-4 shrink-0 items-center text-muted-foreground">
            <button type="button" draggable={!disabled} disabled={disabled} aria-label={`拖动模块 ${index + 1}`} title="拖动排序；拖到标题中间可移入"
              className="w-4 cursor-grab touch-none rounded text-base opacity-40 focus-visible:outline focus-visible:outline-2 group-hover:opacity-100 active:cursor-grabbing"
              onDragStart={event => { dragged.current = block.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', block.id); }}
              onDragEnd={() => { dragged.current = null; setDrop(null); }}>⠿</button>
            <select aria-label={`模块 ${index + 1} 格式`} disabled={disabled} value={block.format} onChange={event => changeFormat(index, event.target.value)}
              className="invisible absolute bottom-full left-0 z-20 mb-1 w-[5rem] rounded border border-[var(--panel-border)] bg-[var(--nayin-surface)] px-1 py-1 text-xs shadow-sm group-focus-within:visible focus:outline focus:outline-1">
              <optgroup label="格式"><option value="text">正文</option><option value="heading1">标题 1</option><option value="heading2">标题 2</option><option value="heading3">标题 3</option></optgroup>
            </select>
          </div>
          {level ? <button type="button" disabled={disabled} aria-label={`${block.collapsed ? '展开' : '收起'}标题 ${index + 1}`} aria-expanded={!block.collapsed}
            className="mt-2 w-5 shrink-0 rounded text-muted-foreground focus-visible:outline focus-visible:outline-2"
            onClick={() => commit(blocks.map(other => other.id === block.id ? { ...other, collapsed: !other.collapsed } : other), textModuleOffset(value, index), false)}>{block.collapsed ? '▸' : '▾'}</button> : null}
          <label className="min-w-0 flex-1">
            <textarea ref={element => { fields.current[index] = element; }} rows={1} aria-label={`文字模块 ${index + 1}`} value={block.text}
              disabled={disabled} maxLength={200000} placeholder="写下这一段…"
              className={`block min-h-10 w-full resize-none overflow-hidden border-0 bg-transparent py-1 leading-8 outline-none ${level === 1 ? 'text-2xl font-semibold' : level === 2 ? 'text-xl font-semibold' : level === 3 ? 'text-lg font-semibold' : 'text-base'}`}
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
                  const next = mergeWritingBlocks(blocks, index - 1);
                  commit(next, textModuleOffset(value, index) - 1);
                } else if (event.key === 'Delete' && field.selectionStart === block.text.length && field.selectionEnd === block.text.length && index < blocks.length - 1) {
                  event.preventDefault();
                  commit(mergeWritingBlocks(blocks, index), textModuleOffset(value, index) + block.text.length);
                }
              }} />
          </label>
          {target === 'inside' && <span className="absolute -top-4 right-1 text-xs text-[var(--nayin-accent)]">移入标题</span>}
        </li>;
      })}
    </ol>
    {cacheError && <p role="alert" className="text-xs text-destructive">本机无法保存模块格式，请暂时不要关闭页面。</p>}
  </section>;
}
