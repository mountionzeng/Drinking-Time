import { useEffect, useRef, useCallback } from 'react';
import type { SelectionState } from '../types';

/**
 * Listens to document `selectionchange` events and resolves selections
 * within `data-selection-source` containers into a `SelectionState`.
 *
 * Debounced at ~200ms to avoid firing on every cursor move.
 */
export function useSelectionCapture(
  onSelection: (state: SelectionState | null) => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;

  const resolve = useCallback(() => {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode) {
      onSelectionRef.current(null);
      return;
    }

    const selectedText = sel.toString().trim();
    if (!selectedText) {
      onSelectionRef.current(null);
      return;
    }

    // Walk up from anchorNode to find the nearest data-selection-source
    let node: Node | null = sel.anchorNode;
    let sourceEl: HTMLElement | null = null;

    while (node) {
      if (
        node instanceof HTMLElement &&
        node.hasAttribute('data-selection-source')
      ) {
        sourceEl = node;
        break;
      }
      node = node.parentNode;
    }

    if (!sourceEl) {
      onSelectionRef.current(null);
      return;
    }

    // Also verify focusNode is within the same source container
    // (reject cross-container selections)
    if (sel.focusNode && !sourceEl.contains(sel.focusNode)) {
      onSelectionRef.current(null);
      return;
    }

    const attr = sourceEl.getAttribute('data-selection-source')!;
    const colonIdx = attr.indexOf(':');
    if (colonIdx === -1) {
      onSelectionRef.current(null);
      return;
    }

    const sourceType = attr.slice(0, colonIdx) as SelectionState['sourceType'];
    const sourceId = attr.slice(colonIdx + 1);
    const fullText = (sourceEl.innerText || '').trim();

    onSelectionRef.current({ sourceType, sourceId, selectedText, fullText });
  }, []);

  useEffect(() => {
    const handler = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(resolve, 200);
    };

    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resolve]);
}
