import type { CSSProperties, ReactNode } from 'react';

/** Decoration stays outside the text field and its selection mirrors. */
export function BookDialogueText({ dialogue, style, children }: {
  dialogue: boolean;
  style: CSSProperties;
  children: ReactNode;
}) {
  if (!dialogue) return children;
  return <div data-book-dialogue className="relative h-full w-full" style={{ ...style, paddingInline: 'min(0.75em, 15%)' }}>
    <span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 select-none font-semibold text-[var(--nayin-accent)]" style={{ fontSize: '0.625em', lineHeight: 1 }}>“</span>
    {children}
    <span aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 select-none font-semibold text-[var(--nayin-accent)]" style={{ fontSize: '0.625em', lineHeight: 1 }}>”</span>
  </div>;
}
