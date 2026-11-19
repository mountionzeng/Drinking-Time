import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inlineChatImageIds, inlineChatParts, inlineImageToken } from '@shared/inlineChatImages';
import { readImagePrompt, type ComposerImage } from './imageGenerationDraft';

export type InlineChatComposerHandle = { insert: (image: ComposerImage) => void; focus: () => void };
function atom(imageId: number, image?: ComposerImage) {
  const span = document.createElement('span');
  span.contentEditable = 'false'; span.dataset.refKey = `image:${imageId}`;
  span.tabIndex = 0; span.setAttribute('role', 'img'); span.setAttribute('aria-label', `图片 #${imageId}`);
  span.className = 'inline-flex items-center gap-1 mx-0.5 px-1 rounded border border-primary/20 bg-primary/5 align-middle text-[10px] select-none cursor-help';
  if (image) {
    const img = document.createElement('img'); img.src = image.imageUrl; img.alt = ''; img.draggable = false;
    img.className = 'h-6 w-7 rounded object-contain'; span.append(img);
  }
  span.append(document.createTextNode(`#${imageId}${image ? '' : '（待加载）'}`));
  return span;
}

/** DOM owns typing/IME/undo; external changes are applied only when the value actually differs. */
export const InlineChatComposer = forwardRef<InlineChatComposerHandle, {
  value: string; images: ComposerImage[]; placeholder: string; disabled?: boolean;
  onChange: (value: string) => void; onSubmit: () => void; onError: (message: string) => void;
}>(function InlineChatComposer({ value, images, placeholder, disabled, onChange, onSubmit, onError }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const composing = useRef(false);
  const lastInput = useRef<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [preview, setPreview] = useState<{ image: ComposerImage; rect: DOMRect } | null>(null);
  const remember = () => {
    const selected = window.getSelection();
    if (selected?.rangeCount && root.current?.contains(selected.getRangeAt(0).commonAncestorContainer))
      range.current = selected.getRangeAt(0).cloneRange();
  };
  const changed = () => {
    setPreview(null); remember(); const text = readImagePrompt(root.current!);
    lastInput.current = text; onChange(text);
  };
  useLayoutEffect(() => {
    document.addEventListener('selectionchange', remember);
    return () => { document.removeEventListener('selectionchange', remember); clearTimeout(closeTimer.current); };
  }, []);
  useLayoutEffect(() => {
    const editor = root.current!;
    if (composing.current || lastInput.current === value) {
      // Material may arrive after the draft. Refresh only the atoms, never the text/caret.
      editor.querySelectorAll<HTMLElement>('[data-ref-key]').forEach(chip => {
        const image = images.find(i => i.key === chip.dataset.refKey);
        if (image && !chip.querySelector('img')) chip.replaceChildren(...Array.from(atom(image.imageId!, image).childNodes));
      });
      return;
    }
    try { editor.replaceChildren(...inlineChatParts(value).map(p => p.imageId ? atom(p.imageId, images.find(i => i.imageId === p.imageId)) : document.createTextNode(p.text))); }
    catch { editor.textContent = value; }
    lastInput.current = value; range.current = null;
    // A restored/voice draft must show its current end, not a clipped first line.
    if (document.activeElement === editor) {
      const end = document.createRange(); end.selectNodeContents(editor); end.collapse(false);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(end); remember();
    }
    editor.scrollTop = editor.scrollHeight;
  }, [value, images]);
  useImperativeHandle(ref, () => ({
    focus: () => root.current?.focus({ preventScroll: true }),
    insert: image => {
      if (disabled || composing.current || !image.imageId) return;
      const editor = root.current!;
      try { inlineChatImageIds(readImagePrompt(editor) + inlineImageToken(image.imageId)); }
      catch (error) { onError((error as Error).message); return; }
      const insertion = range.current && editor.contains(range.current.commonAncestorContainer) ? range.current : document.createRange();
      if (!range.current || !editor.contains(insertion.commonAncestorContainer)) { insertion.selectNodeContents(editor); insertion.collapse(false); }
      editor.focus({ preventScroll: true });
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(insertion);
      // Uses the same native editing command as the existing generation prompt; keeps undo and IME.
      document.execCommand('insertHTML', false, atom(image.imageId, image).outerHTML + '&nbsp;');
      changed(); setPreview(null);
    },
  }));
  const closeSoon = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setPreview(null), 120); };
  const show = (target: EventTarget | null) => {
    const chip = target instanceof Element ? target.closest<HTMLElement>('[data-ref-key]') : null;
    const image = images.find(i => i.key === chip?.dataset.refKey);
    if (chip && image) { clearTimeout(closeTimer.current); setPreview({ image, rect: chip.getBoundingClientRect() }); }
    else closeSoon();
  };
  return <>
    <div ref={root} role="textbox" aria-label="消息输入框" aria-multiline="true" aria-disabled={disabled}
      contentEditable={!disabled} suppressContentEditableWarning data-placeholder={placeholder} data-testid="inline-chat-composer"
      className="inline-chat-composer block w-full min-h-10 max-h-40 overflow-y-auto rounded-lg border px-3 py-2 text-xs leading-6 whitespace-pre-wrap break-words outline-none focus:ring-2 focus:ring-primary/30 empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground"
      onInput={changed} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; changed(); }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        const chip = event.target instanceof Element ? event.target.closest('[data-ref-key]') : null;
        if (chip && ['Backspace', 'Delete'].includes(event.key)) {
          event.preventDefault(); const r = document.createRange(); r.selectNode(chip);
          const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); document.execCommand('delete'); changed(); setPreview(null);
        } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSubmit(); }
      }}
      onPaste={event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); changed(); }}
      onDrop={event => event.preventDefault()} onMouseOver={event => show(event.target)} onMouseLeave={closeSoon}
      onFocusCapture={event => show(event.target)} onBlurCapture={closeSoon}
    />
    {preview && createPortal(<div role="tooltip" aria-label={`预览图片 #${preview.image.imageId}`}
      className="fixed z-[220] w-[360px] max-w-[calc(100vw-24px)] rounded-lg border bg-popover p-2 shadow-lg"
      style={{ left: Math.max(12, Math.min(preview.rect.left, window.innerWidth - 372)), bottom: Math.max(12, window.innerHeight - preview.rect.top + 8) }}
      onMouseEnter={() => clearTimeout(closeTimer.current)} onMouseLeave={closeSoon}>
      <img src={preview.image.imageUrl} alt={`图片 #${preview.image.imageId}`} className="w-full max-h-[40vh] rounded object-contain" />
    </div>, document.body)}
  </>;
});
