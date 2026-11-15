import { useLayoutEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useDialogComposition } from '@/components/ui/dialog';
import { promptParts, readImagePrompt, type ComposerImage } from './imageGenerationDraft';

export type InlineImagePromptHandle = { insert: (image: ComposerImage) => void; read: () => string; focus: () => void };
function imageChip(image: ComposerImage): HTMLElement {
  const chip = document.createElement('span');
  chip.dataset.refKey = image.key;
  chip.contentEditable = 'false';
  chip.tabIndex = 0;
  chip.setAttribute('role', 'img');
  chip.setAttribute('aria-label', image.label);
  chip.className = 'inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-1.5 py-1 mx-1 align-middle text-xs text-foreground select-none cursor-help focus:outline-2 focus:outline-primary';
  const img = document.createElement('img');
  img.src = image.imageUrl;
  img.alt = '';
  img.draggable = false;
  img.className = 'h-8 w-10 rounded object-cover';
  const label = document.createElement('span');
  label.textContent = image.label;
  chip.append(img, label);
  return chip;
}
export const InlineImagePrompt = forwardRef<InlineImagePromptHandle, {
  initialValue: string; images: ComposerImage[]; label: string;
  onChange: (text: string) => void;
  onPreview: (image: ComposerImage | null, anchor?: DOMRect) => void;
}>(function InlineImagePrompt({ initialValue, images, label, onChange, onPreview }, ref) {
  const editor = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const composing = useRef(false);
  const insertion = useRef(0);
  const composition = useDialogComposition();
  const remember = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.current?.contains(selection.getRangeAt(0).commonAncestorContainer))
      savedRange.current = selection.getRangeAt(0).cloneRange();
  };
  // Uncontrolled DOM keeps selection, native undo and IME intact as the parent re-renders.
  useLayoutEffect(() => {
    const root = editor.current!;
    root.replaceChildren(...promptParts(initialValue).map(part => {
      const image = images.find(image => image.key === part.key);
      return image ? imageChip(image) : document.createTextNode(part.text);
    }));
    document.addEventListener("selectionchange", remember);
    return () => { document.removeEventListener("selectionchange", remember); composition.setComposing(false); };
    // This component is mounted once per quote, never reset while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const changed = () => { remember(); onChange(readImagePrompt(editor.current!)); };
  useImperativeHandle(ref, () => ({
    read: () => readImagePrompt(editor.current!),
    focus: () => editor.current?.focus(),
    insert: image => {
      if (composing.current) return;
      const root = editor.current!;
      const selection = window.getSelection();
      const range = savedRange.current && root.contains(savedRange.current.commonAncestorContainer)
        ? savedRange.current : document.createRange();
      if (!savedRange.current || !root.contains(range.commonAncestorContainer)) { range.selectNodeContents(root); range.collapse(false); }
      root.focus();
      selection?.removeAllRanges(); selection?.addRange(range);
      // Browser editing commands preserve native undo. HTML is built exclusively through DOM APIs.
      const chip = imageChip(image);
      const marker = String(++insertion.current);
      chip.dataset.insertion = marker;
      document.execCommand('insertHTML', false, chip.outerHTML + '&nbsp;');
      const inserted = root.querySelector(`[data-insertion="${marker}"]`);
      if (inserted) {
        inserted.removeAttribute('data-insertion');
        const caret = document.createRange();
        const space = inserted.nextSibling;
        if (space?.nodeType === 3 && space.textContent?.startsWith('\u00a0')) caret.setStart(space, 1);
        else caret.setStartAfter(inserted);
        caret.collapse(true);
        selection?.removeAllRanges(); selection?.addRange(caret);
      }
      changed();
    },
  }));
  const preview = (target: EventTarget | null) => {
    const chip = target instanceof Element ? target.closest<HTMLElement>('[data-ref-key]') : null;
    const image = chip && images.find(image => image.key === chip.dataset.refKey);
    onPreview(image || null, chip?.getBoundingClientRect());
  };
  return <div ref={editor} role="textbox" aria-label={label} aria-multiline="true" contentEditable suppressContentEditableWarning
    className="min-h-56 max-h-[38vh] overflow-y-auto rounded-lg border bg-background p-4 text-sm leading-8 whitespace-pre-wrap break-words outline-none focus:ring-2 focus:ring-primary/30"
    onKeyDown={event => {
      const chip = event.target instanceof Element ? event.target.closest('[data-ref-key]') : null;
      if (!chip || composing.current || !['Backspace', 'Delete'].includes(event.key)) return;
      event.preventDefault();
      const range = document.createRange(); range.selectNode(chip);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      document.execCommand('delete'); changed(); onPreview(null);
    }}
    onInput={changed} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
    onCompositionStart={() => { composing.current = true; composition.setComposing(true); }}
    onCompositionEnd={() => { composing.current = false; composition.setComposing(false); composition.markCompositionEnd(); changed(); }}
    onPaste={event => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); changed(); }}
    onDrop={event => event.preventDefault()}
    onMouseOver={event => preview(event.target)} onMouseLeave={() => onPreview(null)}
    onFocusCapture={event => preview(event.target)} onBlurCapture={() => onPreview(null)}
  />;
});
