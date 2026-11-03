import { useEffect, useState } from 'react';
import { Check, CornerDownLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { BookRewriteProposal } from '@shared/bookRewrite';
import { useUiText } from '@/features/uiLanguage/UiLanguage';
import { useBookModuleActions } from './bookModuleActions';

export function BookRewriteButton({ proposal, storyId }: { proposal: BookRewriteProposal; storyId: number | null }) {
  const ui = useUiText();
  const session = useBookModuleActions(state => state.session);
  const [applied, setApplied] = useState(false);
  const target = proposal.target;
  const available = storyId === target.storyId && session?.storyId === target.storyId && session.scope === target.scope && Boolean(session.replaceRewrite);
  const unchanged = available && target.parts.every(part => session?.modules.some(module => module.id === part.id && module.text === part.text));
  useEffect(() => { if (unchanged) setApplied(false); }, [unchanged]);
  const done = applied && !unchanged;
  return <button type="button" disabled={!unchanged}
    className="mt-2 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-default disabled:opacity-60"
    onClick={() => {
      try {
        // Re-read the mounted editor at click time, including during a chapter switch.
        const current = useBookModuleActions.getState().session;
        if (!current?.replaceRewrite || current.storyId !== storyId) throw new Error('请回到这次改写对应的文章。');
        current.replaceRewrite(target, proposal.text);
        setApplied(true);
        toast.success(ui('已替换，可在正文中撤销'));
      } catch (error) { toast.error(ui(error instanceof Error ? error.message : '这段改写暂时无法替换。')); }
    }}>
    {done ? <Check className="h-3 w-3" /> : <CornerDownLeft className="h-3 w-3" />}
    {ui(done ? '已替换' : !available ? '请回到原文' : !unchanged ? '原文已变化' : '替换选中内容')}
  </button>;
}
