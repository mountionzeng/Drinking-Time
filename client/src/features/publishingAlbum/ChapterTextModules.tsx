import { useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { replaceTextModule, textModuleLines, textModuleOffset, textModulePosition, type TextPosition } from './moduleTextEditing';

type Snapshot = TextPosition & { body: string };
export function ChapterTextModules({ value, onChange, disabled, selection }: {
  value: string; onChange(value: string): void; disabled: boolean;
  selection: MutableRefObject<TextPosition | null>;
}) {
  const fields = useRef<Array<HTMLTextAreaElement | null>>([]);
  const focus = useRef<TextPosition | null>(null);
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const lines = textModuleLines(value);
  useLayoutEffect(() => {
    for (const field of fields.current) {
      if (!field) continue;
      field.style.height = '0px';
      field.style.height = `${Math.max(40, field.scrollHeight)}px`;
    }
    if (focus.current) {
      const start = textModulePosition(value, focus.current.start);
      const end = textModulePosition(value, focus.current.end);
      const field = fields.current[start.index];
      field?.focus();
      field?.setSelectionRange(start.cursor, end.index === start.index ? end.cursor : start.cursor);
      focus.current = null;
    }
  }, [value]);
  function selected(index: number, field: HTMLTextAreaElement) {
    const offset = textModuleOffset(value, index);
    selection.current = { start: offset + field.selectionStart, end: offset + field.selectionEnd };
    window.dispatchEvent(new Event('dt:writing-selection-change'));
  }
  function commit(body: string, position: number, restoreFocus: boolean) {
    if (disabled || body.length > 200000 || body === value) return;
    history.current.past.push({ body: value, ...(selection.current ?? { start: value.length, end: value.length }) });
    history.current.past = history.current.past.slice(-50);
    history.current.future = [];
    selection.current = { start: position, end: position };
    if (restoreFocus) focus.current = selection.current;
    onChange(body);
  }
  function travel(redo: boolean) {
    const source = redo ? history.current.future : history.current.past;
    const target = redo ? history.current.past : history.current.future;
    const previous = source.pop();
    if (!previous) return;
    target.push({ body: value, ...(selection.current ?? { start: value.length, end: value.length }) });
    selection.current = { start: previous.start, end: previous.end };
    focus.current = selection.current;
    onChange(previous.body);
  }
  return <section aria-label="章节正文" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>正文</span><span className="text-xs text-muted-foreground">回车新建模块</span></div>
    <ol aria-label="章节文字模块" className="space-y-3">
      {lines.map((line, index) => <li key={index} className="rounded-lg border border-[var(--panel-border)] bg-[var(--nayin-surface)]/25 px-3 py-2 focus-within:border-[var(--nayin-accent)]/50">
        <label className="block"><span className="text-[11px] text-muted-foreground">文字模块 {index + 1}</span>
          <textarea ref={element => { fields.current[index] = element; }} rows={1} aria-label={`文字模块 ${index + 1}`} value={line}
            disabled={disabled} maxLength={200000} placeholder="写下这一段…"
            className="block min-h-10 w-full resize-none overflow-hidden border-0 bg-transparent py-1 text-base leading-8 outline-none"
            onFocus={event => selected(index, event.currentTarget)} onSelect={event => selected(index, event.currentTarget)}
            onChange={event => {
              const field = event.currentTarget;
              const next = replaceTextModule(value, index, field.value, field.selectionStart);
              commit(next.body, next.position, field.value.includes('\n') || field.value.includes('\r'));
            }}
            onKeyDown={event => {
              if (disabled || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              const field = event.currentTarget;
              selected(index, field);
              if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
                event.preventDefault(); travel(event.shiftKey || event.key.toLowerCase() === 'y'); return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const next = replaceTextModule(value, index, line.slice(0, field.selectionStart) + '\n' + line.slice(field.selectionEnd), field.selectionStart + 1);
                commit(next.body, next.position, true);
              } else if (event.key === 'Backspace' && !field.selectionStart && !field.selectionEnd && index > 0) {
                event.preventDefault();
                const boundary = textModuleOffset(value, index) - 1;
                commit(value.slice(0, boundary) + value.slice(boundary + 1), boundary, true);
              } else if (event.key === 'Delete' && field.selectionStart === line.length && field.selectionEnd === line.length && index < lines.length - 1) {
                event.preventDefault();
                const boundary = textModuleOffset(value, index) + line.length;
                commit(value.slice(0, boundary) + value.slice(boundary + 1), boundary, true);
              }
            }} />
        </label>
      </li>)}
    </ol>
  </section>;
}
