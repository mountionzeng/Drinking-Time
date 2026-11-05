import { create } from 'zustand';
import type { CompositionSource } from '@shared/bookImageComposition';
export type BookImageCompositionSession = {
  key: string; scope: string; accountId: number | null; epoch: number;
  storyId: number; chapterId: number; sources: CompositionSource[]; instruction: string;
  createdAt?: number;
  resumeOnly?: boolean;
  prepare(): Promise<void>;
  insert(imageUrl: string, previousUrl?: string): Promise<void>;
};
export const useBookImageCompositionSession = create<{
  session: BookImageCompositionSession | null;
  setSession(session: BookImageCompositionSession | null): void;
}>(set => ({ session: null, setSession: session => set({ session }) }));

/** Only transient outlines fly; never clone text/images or intercept pointer input. */
export function gatherBookMaterials(ids: readonly string[]) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const target = document.querySelector('[data-book-composition-target]')?.getBoundingClientRect();
  if (!target) return;
  const elements = [...document.querySelectorAll<HTMLElement>('[data-book-module-id]')]
    .filter(el => ids.includes(el.dataset.bookModuleId ?? '')).slice(0, 8);
  elements.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    const outline = document.createElement('div');
    Object.assign(outline.style, { position: 'fixed', pointerEvents: 'none', zIndex: '100',
      left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${Math.min(rect.height, 180)}px`,
      border: '1px solid var(--nayin-accent)', borderRadius: '4px', transformOrigin: 'center' });
    outline.setAttribute('aria-hidden', 'true');
    document.body.append(outline);
    if (!outline.animate) { outline.remove(); return; }
    const animation = outline.animate([
      { opacity: 0.4, transform: 'translate(0,0) scale(1)' },
      { opacity: 0, transform: `translate(${target.left + target.width / 2 - rect.left - rect.width / 2}px,${target.top + target.height / 2 - rect.top - Math.min(rect.height,180) / 2}px) scale(0.04)` },
    ], { duration: 480, delay: i * 35, easing: 'cubic-bezier(.2,.7,.3,1)' });
    animation.onfinish = animation.oncancel = () => outline.remove();
  });
}
