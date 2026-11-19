import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Keep the editor mounted while short status and longer text use different space. */
export function ChatComposerDock({ enabled, avatar, summary, activityText, children }: {
  enabled: boolean; avatar: ReactNode; summary: ReactNode; activityText: string; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [beside, setBeside] = useState(false);
  useLayoutEffect(() => {
    if (!enabled || !root.current || !measure.current) return;
    const node = root.current;
    const editor = node.querySelector('[data-testid="inline-chat-composer"]');
    const update = () => {
      const available = node.clientWidth - 70;
      setBeside(available >= 180 && !activityText.includes('\n') &&
        measure.current!.getBoundingClientRect().width <= available &&
        (editor?.getBoundingClientRect().height ?? 0) <= 64);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node); observer.observe(measure.current);
    if (editor) observer.observe(editor);
    return () => observer.disconnect();
  }, [enabled, activityText]);
  return <div ref={root} className={enabled ? 'chat-composer-dock' : 'flex shrink-0 items-end gap-1.5'}
    data-testid="chat-composer-dock" data-layout={enabled ? beside ? 'beside' : 'expanded' : undefined}>
    {enabled && <>
      <div className="chat-dock-avatar chat-compact-avatar">{avatar}</div>
      <div className="chat-dock-summary">{summary}</div>
      <span ref={measure} aria-hidden="true" className="chat-dock-measure text-[11px] leading-4">{activityText}</span>
    </>}
    {children}
  </div>;
}
