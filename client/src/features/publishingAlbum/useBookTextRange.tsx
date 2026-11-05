import { useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import { writingBlockOffset, type WritingBlock } from './chapterBlockTree';
import { bookTextRangeParts, clampBookTextFocus, replaceBookTextRange, type BookTextPoint, type BookTextRange } from './bookTextRange';
import type { TextPosition } from './moduleTextEditing';

/** The mirror has exactly the textarea's wrapping, including its internal scroll offset. */
export function BookTextRangeOverlay({ text, range, style }: { text: string; range?: { start: number; end: number }; style: CSSProperties }) {
  const layout: CSSProperties = { ...style, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
  return <>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div data-book-text-measure className="px-1 py-0" style={{...layout, visibility:'hidden'}}>{text + '\u200b'}</div>
    </div>
    {range && <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div data-book-text-highlight className="px-1 py-0" style={layout}>
        {text.slice(0, range.start)}<mark style={{ background: '#b4d7ff', color: 'inherit' }}>{text.slice(range.start, range.end) || '\u200b'}</mark>{text.slice(range.end)}
      </div>
    </div>}
  </>;
}

export function syncBookTextScroll(field: HTMLTextAreaElement) {
  field.parentElement?.querySelectorAll<HTMLElement>('[data-book-text-measure],[data-book-text-highlight]').forEach(mirror => {
    mirror.style.transform = `translate(${-field.scrollLeft}px, ${-field.scrollTop}px)`;
  });
}

function characterRect(field: HTMLTextAreaElement, offset: number) {
  const node = field.parentElement?.querySelector('[data-book-text-measure]')?.firstChild;
  if (!node) return field.getBoundingClientRect();
  const range = document.createRange();
  range.setStart(node, Math.min(offset, field.value.length));
  range.setEnd(node, Math.min(offset + 1, field.value.length + 1));
  return range.getBoundingClientRect();
}

/** Binary search the rendered glyphs, so zoom, wrapped CJK and variable fonts agree. */
function pointAt(field: HTMLTextAreaElement, x: number, y: number): BookTextPoint {
  let low = 0, high = field.value.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const box = characterRect(field, middle);
    if (y >= box.bottom || y >= box.top && x > (box.left + box.right) / 2) low = middle + 1;
    else high = middle;
  }
  // A UTF-16 surrogate pair is a single visible character.
  if (low > 0 && /[\uDC00-\uDFFF]/.test(field.value[low] ?? '') && /[\uD800-\uDBFF]/.test(field.value[low - 1])) low++;
  return { id: field.dataset.bookTextId!, offset: low };
}

function nearestField(fields: HTMLTextAreaElement[], x: number, y: number) {
  return fields.reduce<HTMLTextAreaElement | null>((best, field) => {
    const distance = (item: HTMLTextAreaElement) => {
      const box = item.getBoundingClientRect();
      return Math.max(box.top - y, 0, y - box.bottom) * 10000 + Math.max(box.left - x, 0, x - box.right);
    };
    return !best || distance(field) < distance(best) ? field : best;
  }, null);
}

type Options = {
  blocks: WritingBlock[];
  disabled: boolean;
  scope?: string;
  selection: { current: TextPosition | null };
  commit(blocks: WritingBlock[], position: number, restoreFocus?: boolean): void;
};

export function useBookTextRange(options: Options) {
  const root = useRef<HTMLElement>(null);
  const latest = useRef(options); latest.current = options;
  const current = useRef<BookTextRange | null>(null);
  const [range, setRange] = useState<BookTextRange | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selectionRequest, setSelectionRequest] = useState<string[] | undefined>();
  const drag = useRef<{ pointer: number; anchor: BookTextPoint; source: WritingBlock[]; x: number; y: number; frame: number; scroller: HTMLElement | null } | null>(null);
  const parts = useMemo(() => range ? bookTextRangeParts(options.blocks, range) : [], [options.blocks, range]);
  const byId = useMemo(() => new Map(parts.map(part => [part.id, part])), [parts]);

  function fields() { return Array.from(root.current?.querySelectorAll<HTMLTextAreaElement>('textarea[data-book-text-id]') ?? []); }
  function clear(dropModules = true) {
    current.current = null; setRange(null);
    setSelectionRequest(dropModules ? [] : undefined);
  }
  function stop() {
    if (drag.current) setDragging(false);
    if (drag.current) cancelAnimationFrame(drag.current.frame);
    drag.current = null;
  }
  function update(next: BookTextRange) {
    const { blocks, selection } = latest.current;
    const visible = new Set(fields().map(field => field.dataset.bookTextId!));
    next = { ...next, focus: clampBookTextFocus(blocks, visible, next.anchor, next.focus) };
    const selected = bookTextRangeParts(blocks, next);
    if (!selected.length) return;
    current.current = next; setRange(next);
    setSelectionRequest(selected.length > 1 ? selected.map(part => part.id) : []);
    const first = selected[0], last = selected.at(-1)!;
    selection.current = {
      start: writingBlockOffset(blocks, blocks.findIndex(block => block.id === first.id)) + first.start,
      end: writingBlockOffset(blocks, blocks.findIndex(block => block.id === last.id)) + last.end,
    };
    window.dispatchEvent(new Event('dt:writing-selection-change'));
  }
  function focusPoint(point: BookTextPoint) {
    const field = fields().find(item => item.dataset.bookTextId === point.id);
    field?.focus({ preventScroll: true }); field?.setSelectionRange(point.offset, point.offset);
  }
  function settleNativeSelection() {
    if (!current.current) return;
    const first = bookTextRangeParts(latest.current.blocks, current.current)[0];
    if (!first) return;
    focusPoint({id:first.id,offset:first.start});
    fields().find(field => field.dataset.bookTextId === first.id)?.setSelectionRange(first.start,first.end);
  }
  function updateFromKeyboard(next: BookTextRange) {
    update(next);
    // Keep native paste/IME anchored in the surviving first module, including reverse selections.
    queueMicrotask(settleNativeSelection);
  }
  function replace(text: string) {
    if (!current.current || latest.current.disabled) return false;
    const result = replaceBookTextRange(latest.current.blocks, current.current, text);
    if (!result || result.blocks.reduce((n, block) => n + block.text.length + 1, -1) > 200000) return false;
    clear(); stop(); latest.current.commit(result.blocks, result.position, true);
    return true;
  }
  useLayoutEffect(() => {
    stop(); if (current.current) clear(false);
  }, [options.blocks, options.scope, options.disabled]);

  useLayoutEffect(() => {
    if (!root.current) return;
    function extend() {
      const gesture = drag.current;
      if (!gesture || latest.current.disabled || gesture.source !== latest.current.blocks) return;
      const target = nearestField(fields(), gesture.x, gesture.y);
      if (!target) return;
      if (target.dataset.bookTextId !== gesture.anchor.id || current.current) {
        update({ anchor: gesture.anchor, focus: pointAt(target, gesture.x, gesture.y) });
      }
    }
    function scroll() {
      const gesture = drag.current;
      if (!gesture) return;
      if (gesture.scroller) {
        const box = gesture.scroller.getBoundingClientRect();
        const top = Math.max(0, box.top), bottom = Math.min(window.innerHeight, box.bottom);
        const dy = gesture.y < top + 28 ? -Math.min(18, (top + 28 - gesture.y) / 2)
          : gesture.y > bottom - 28 ? Math.min(18, (gesture.y - bottom + 28) / 2) : 0;
        if (dy) { gesture.scroller.scrollTop += dy; extend(); }
      }
      gesture.frame = requestAnimationFrame(scroll);
    }
    const move = (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointer) return;
      if (!(event.buttons & 1)) { stop(); return; }
      drag.current.x = event.clientX; drag.current.y = event.clientY;
      extend();
      if (current.current) event.preventDefault();
      if (!drag.current.frame) drag.current.frame = requestAnimationFrame(scroll);
    };
    const end = (event: PointerEvent) => {
      if (!drag.current || event.pointerId !== drag.current.pointer) return;
      if (event.type === 'pointercancel') clear();
      else settleNativeSelection();
      stop();
    };
    const blur = () => { stop(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', blur);
    return () => {
      stop(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end); window.removeEventListener('blur', blur);
    };
  }, []);

  function onPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    if (options.disabled || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-book-selecting="true"]')) return;
    const field = target.closest<HTMLTextAreaElement>('textarea[data-book-text-id]');
    if (!field) {
      if (!target.closest('button,[role="button"],[role="menu"]')) { stop(); clear(); }
      return;
    }
    // Leave native long press / touch scrolling untouched.
    if (event.pointerType === 'touch') { clear(); return; }
    // Render formula source before measuring glyphs for a cross-module drag.
    flushSync(() => setDragging(true));
    const anchor = event.shiftKey && current.current ? current.current.anchor : pointAt(field,event.clientX,event.clientY);
    if (event.shiftKey) {
      const prior = current.current?.anchor ?? { id:field.dataset.bookTextId!, offset:field.selectionDirection === 'backward' ? field.selectionEnd : field.selectionStart };
      event.preventDefault(); event.stopPropagation(); updateFromKeyboard({anchor:prior,focus:pointAt(field,event.clientX,event.clientY)});
      setDragging(false);
      return;
    }
    clear();
    let scroller = field.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    drag.current = { pointer:event.pointerId,anchor,source:options.blocks,x:event.clientX,y:event.clientY,frame:0,scroller };
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (options.disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return false;
    const field = event.currentTarget;
    if (event.key === 'Escape' && current.current) { clear(); stop(); return false; }
    if ((event.metaKey || event.ctrlKey) && ['z','y'].includes(event.key.toLowerCase())) { clear(); return false; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && current.current) {
      const all = fields();
      if (all.length) {
        event.preventDefault();
        updateFromKeyboard({anchor:{id:all[0].dataset.bookTextId!,offset:0},focus:{id:all.at(-1)!.dataset.bookTextId!,offset:all.at(-1)!.value.length}});
      }
      return true;
    }
    if (current.current && ['Home','End'].includes(event.key)) {
      const point = current.current.focus;
      const target = fields().find(item => item.dataset.bookTextId === point.id);
      if (target) {
        event.preventDefault();
        const next = {...point,offset:event.key === 'Home' ? 0 : target.value.length};
        if (event.shiftKey) updateFromKeyboard({anchor:current.current.anchor,focus:next});
        else { clear(); focusPoint(next); }
      }
      return true;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
      if (current.current && !event.shiftKey) {
        const selected = bookTextRangeParts(options.blocks,current.current);
        const start = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
        const part = start ? selected[0] : selected.at(-1);
        event.preventDefault(); clear(); if (part) focusPoint({id:part.id,offset:start?part.start:part.end}); return true;
      }
      if (event.shiftKey) {
        const all = fields();
        const anchor = current.current?.anchor ?? {id:field.dataset.bookTextId!,offset:field.selectionDirection === 'backward' ? field.selectionEnd : field.selectionStart};
        const point = current.current?.focus ?? {id:field.dataset.bookTextId!,offset:field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd};
        const index = all.findIndex(item => item.dataset.bookTextId === point.id), active = all[index];
        if (!active) return false;
        const direction = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
        let next: BookTextPoint | undefined;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const offset = point.offset + direction;
          if (offset < 0 || offset > active.value.length) {
            const adjacent = all[index + direction];
            if (adjacent) next = {id:adjacent.dataset.bookTextId!,offset:direction > 0 ? 0 : adjacent.value.length};
          } else if (current.current) {
            const step = direction > 0 ? [...active.value.slice(point.offset)][0]?.length ?? 1 : [...active.value.slice(0,point.offset)].at(-1)?.length ?? 1;
            next = {...point,offset:point.offset + direction * step};
          }
        } else {
          const caret = characterRect(active,point.offset);
          const first = characterRect(active,0), last = characterRect(active,active.value.length);
          const y = (caret.top + caret.bottom) / 2 + direction * parseFloat(getComputedStyle(active).lineHeight);
          if (y < first.top || y >= last.bottom) {
            const adjacent = all[index + direction];
            if (adjacent) {
              const edge = characterRect(adjacent,direction > 0 ? 0 : adjacent.value.length);
              next = pointAt(adjacent,caret.left,(edge.top+edge.bottom)/2);
            }
          } else if (current.current) next = pointAt(active,caret.left,y);
        }
        if (next) { event.preventDefault(); updateFromKeyboard({anchor,focus:next}); return true; }
        if (current.current) { event.preventDefault(); return true; }
      }
    }
    if (!current.current) return false;
    if (['Backspace','Delete','Enter'].includes(event.key) || !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
      event.preventDefault(); replace(event.key === 'Enter' ? '\n' : event.key === 'Backspace' || event.key === 'Delete' ? '' : event.key); return true;
    }
    // Copy/paste shortcuts need the range to survive the native select event.
    return true;
  }
  function onCopy(event: ClipboardEvent<HTMLElement>, cut = false) {
    if (!current.current) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain',bookTextRangeParts(options.blocks,current.current).map(part=>part.text.slice(part.start,part.end)).join('\n'));
    if (cut) replace('');
  }
  return {
    root, byId, selectionRequest, dragging, active: () => Boolean(current.current), getRange: () => current.current, clear,
    onPointerDownCapture, onKeyDown, onCopy, onCut: (event: ClipboardEvent<HTMLElement>) => onCopy(event,true),
    onPaste: (event: ClipboardEvent<HTMLElement>) => { if (current.current) { event.preventDefault(); replace(event.clipboardData.getData('text/plain')); } },
    replace,
  };
}
