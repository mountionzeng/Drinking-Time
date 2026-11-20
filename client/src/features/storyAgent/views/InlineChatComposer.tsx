import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inlineChatImageIds, inlineImageToken } from '@shared/inlineChatImages';
import { chatPictureParts, pictureRegionLabel } from '@shared/chatPictureRegion';
import { useUiLanguage } from '@/features/uiLanguage/UiLanguage';
import { readImagePrompt, type ComposerImage } from './imageGenerationDraft';

export type InlineChatComposerHandle = { insert: (image: ComposerImage, note?: string) => boolean;
  selectRegion: (image: ComposerImage, note: string) => ((recognizedNote: string) => void) | undefined; focus: () => void };
function atom(imageId: number, image?: ComposerImage, note?: string, en = false) {
  const span = document.createElement('span');
  span.contentEditable = 'false'; span.dataset.refKey = `image:${imageId}`;
  if (image) span.title = image.label;
  span.tabIndex = 0; span.setAttribute('role', 'img'); span.setAttribute('aria-label', `图片 #${imageId}`);
  span.className = 'inline-flex items-center gap-1 mx-0.5 px-1 rounded border border-primary/20 bg-primary/5 align-middle text-[10px] select-none cursor-help';
  if (image) {
    const img = document.createElement('img'); img.src = image.imageUrl; img.alt = ''; img.draggable = false;
    img.className = 'h-6 w-7 rounded object-contain'; span.append(img);
  }
  const label = document.createElement('span');
  label.className = 'inline-block max-w-[16ch] truncate align-middle';
  label.textContent = note ? pictureRegionLabel(note, en) : `#${imageId}${image ? '' : '（待加载）'}`;
  span.append(label);
  if (note) {
    span.dataset.regionNote = note;
    span.title = `#${imageId} · ${label.textContent}`;
    span.setAttribute('aria-label', span.title);
  }
  return span;
}

/** DOM owns typing/IME/undo; external changes are applied only when the value actually differs. */
export const InlineChatComposer = forwardRef<InlineChatComposerHandle, {
  value: string; images: ComposerImage[]; placeholder: string; disabled?: boolean;
  onChange: (value: string) => void; onSubmit: () => void; onError: (message: string) => void;
}>(function InlineChatComposer({ value, images, placeholder, disabled, onChange, onSubmit, onError }, ref) {
  const { language } = useUiLanguage();
  const en = language === "en";
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
        if (image && !chip.querySelector('img')) chip.replaceChildren(...Array.from(atom(image.imageId!, image, chip.dataset.regionNote, en).childNodes));
      });
      return;
    }
    try { editor.replaceChildren(...chatPictureParts(value).map(p => p.imageId ? atom(p.imageId, images.find(i => i.imageId === p.imageId), p.note, en) : document.createTextNode(p.text))); }
    catch { editor.textContent = value; }
    lastInput.current = value; range.current = null;
    // A restored/voice draft must show its current end, not a clipped first line.
    if (document.activeElement === editor) {
      const end = document.createRange(); end.selectNodeContents(editor); end.collapse(false);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(end); remember();
    }
    editor.scrollTop = editor.scrollHeight;
  }, [value, images]);
  const insert = (image: ComposerImage, note?: string) => {
    const editor = root.current;
    if (!editor || disabled || composing.current || !image.imageId) return;
    try { inlineChatImageIds(readImagePrompt(editor) + inlineImageToken(image.imageId)); }
    catch (error) { onError((error as Error).message); return; }
    const key = `[data-ref-key="image:${image.imageId}"]`;
    const existing = Array.from(editor.querySelectorAll<HTMLElement>(key));
    const previous = existing.at(-1);
    const saved = range.current && editor.contains(range.current.commonAncestorContainer) ? range.current.cloneRange() : null;
    const insertion = saved?.cloneRange() ?? document.createRange();
    const replace = previous && (note || previous.dataset.regionNote);
    if (replace) insertion.selectNode(previous);
    else if (!saved) { insertion.selectNodeContents(editor); insertion.collapse(false); }
    else insertion.collapse(false);
    const chip = atom(image.imageId, image, note, en);
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges(); selection?.addRange(insertion);
    if (!document.execCommand('insertHTML', false, chip.outerHTML + (replace ? '' : '&nbsp;'))) return;
    if (replace && saved && editor.contains(saved.commonAncestorContainer)) {
      saved.collapse(false); selection?.removeAllRanges(); selection?.addRange(saved);
    }
    changed();
    // Native editing inserts a clone. Bind the background read to this exact occurrence.
    return Array.from(editor.querySelectorAll<HTMLElement>(key)).find(node => !existing.includes(node));
  };
  useImperativeHandle(ref, () => ({
    focus: () => root.current?.focus({ preventScroll: true }),
    insert: (image, note) => Boolean(insert(image, note)),
    selectRegion: (image, note) => {
      const chip = insert(image, note);
      if (!chip) return;
      return recognizedNote => {
        if (!root.current?.contains(chip) || chip.dataset.regionNote !== note || recognizedNote === note) return;
        const label = chip.lastElementChild;
        if (!label) return;
        label.textContent = pictureRegionLabel(recognizedNote, en);
        chip.dataset.regionNote = recognizedNote;
        chip.title = `#${image.imageId} · ${label.textContent}`;
        chip.setAttribute('aria-label', chip.title);
        // No focus or selection change, even while the user types elsewhere.
        if (!composing.current) changed();
      };
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
      onDrop={event => event.preventDefault()} onMouseOver={event => { if (!event.currentTarget.closest("[data-picture-regions]")) show(event.target); }} onMouseLeave={closeSoon}
      onFocusCapture={event => { if (!event.currentTarget.closest("[data-picture-regions]")) show(event.target); }} onBlurCapture={closeSoon}
    />
    {preview && createPortal(<div role="tooltip" aria-label={`预览图片 #${preview.image.imageId}`}
      className="fixed z-[220] w-[360px] max-w-[calc(100vw-24px)] rounded-lg border bg-popover p-2 shadow-lg"
      style={{ left: Math.max(12, Math.min(preview.rect.left, window.innerWidth - 372)), bottom: Math.max(12, window.innerHeight - preview.rect.top + 8) }}
      onMouseEnter={() => clearTimeout(closeTimer.current)} onMouseLeave={closeSoon}>
      <img src={preview.image.imageUrl} alt={`图片 #${preview.image.imageId}`} className="w-full max-h-[40vh] rounded object-contain" />
    </div>, document.body)}
  </>;
});
