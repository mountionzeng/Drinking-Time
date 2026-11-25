import { useState, type CSSProperties } from 'react';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { isInlineBookRewrite, type BookRewriteProposal, type BookRewriteTarget } from '@shared/bookRewrite';
import { useStorySpine } from '@/features/storyAgent/spine/storySpine';
import { useUiText } from '@/features/uiLanguage/UiLanguage';
import { useBookModuleActions } from './bookModuleActions';
import { recheckPassage } from './bookPassageTarget';
import { locateSentenceEdit, parseSentenceEdit } from './sentenceEditTarget';
import type { WritingBlock } from './chapterBlockTree';

function sameRange(left: BookRewriteTarget | undefined, right: BookRewriteTarget) {
  const current = left?.parts[0], expected = right.parts[0];
  return left?.parts.length === 1 && right.parts.length === 1 &&
    current?.id === expected.id && current?.text === expected.text &&
    current?.start === expected.start && current?.end === expected.end;
}

export function reviewStillMatches(blocks: WritingBlock[], proposal: BookRewriteProposal) {
  if (proposal.passageInstruction) return Boolean(recheckPassage(blocks, proposal.target));
  const edit = parseSentenceEdit(proposal.sentenceInstruction ?? '');
  return edit && sameRange(locateSentenceEdit(blocks, edit, proposal.target), proposal.target);
}

export function useBookSentenceReview(source?: { storyId: number; scope: string }) {
  const messages = useStorySpine(state => state.messages);
  const account = useStorySpine(state => state.accountId);
  const activeStory = useStorySpine(state => state.activeStoryId);
  const [resolved, setResolved] = useState<ReadonlySet<string>>(() => new Set());
  if (!source || activeStory !== source.storyId) return null;
  const pending = new Map<string, { id: string; proposal: BookRewriteProposal }>();
  for (const message of messages) {
    const proposal = message.bookRewrite;
    if (!proposal || !isInlineBookRewrite(proposal) || proposal.target.storyId !== source.storyId || proposal.target.scope !== source.scope) continue;
    const { id: blockId } = proposal.target.parts[0];
    const id = `dt:book-sentence-review:${account}:${source.storyId}:${message.id}`;
    let handled = resolved.has(id);
    try { handled ||= localStorage.getItem(id) === 'resolved'; } catch { /* Keep the current-session decision. */ }
    // A later request for the same block replaces the earlier preview.
    pending.delete(blockId);
    if (!handled) pending.set(blockId, { id, proposal });
  }
  function resolve(id: string) {
    try { localStorage.setItem(id, 'resolved'); } catch { /* Keep the current-session decision. */ }
    setResolved(previous => new Set(previous).add(id));
  }
  return { pending, resolve };
}

export function BookSentenceReview({ proposal, style, onResolve }: {
  proposal: BookRewriteProposal;
  style: CSSProperties;
  onResolve(): void;
}) {
  const ui = useUiText();
  const { target, text } = proposal;
  const part = target.parts[0];
  const buttonClass = 'inline-flex size-7 items-center justify-center rounded text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary';
  function accept() {
    try {
      const editor = useBookModuleActions.getState().session;
      const edit = parseSentenceEdit(proposal.sentenceInstruction ?? '');
      const currentTarget = proposal.passageInstruction && editor?.chapterDocument
        ? recheckPassage(editor.chapterDocument.blocks, target)
        : edit ? editor?.locateSentenceEdit?.(edit) : undefined;
      if (!editor?.replaceRewrite || editor.storyId !== target.storyId || editor.scope !== target.scope ||
        !sameRange(currentTarget, target)) {
        throw new Error('原文已变化');
      }
      editor.replaceRewrite(target, text);
      onResolve();
      toast.success(ui('已替换，可在正文中撤销'));
    } catch (error) {
      toast.error(ui(error instanceof Error ? error.message : '这段改写暂时无法替换。'));
    }
  }
  return <div data-book-sentence-review={part.id} className="min-h-[1.6em] whitespace-pre-wrap break-words px-1" style={style}>
    {part.text.slice(0, part.start)}
    <del className="bg-destructive/10 text-destructive">{part.text.slice(part.start, part.end)}</del>
    {' '}
    <ins className="bg-primary/10 text-primary underline decoration-2">{text}</ins>
    {part.text.slice(part.end)}
    <span className="ml-1 inline-flex align-middle" data-book-handle onPointerDown={event => event.stopPropagation()}>
      <button type="button" className={buttonClass} onClick={accept} title={ui('采用修改')} aria-label={ui('采用修改')}>
        <Check className="size-4" aria-hidden="true" />
      </button>
      <button type="button" className={buttonClass} onClick={onResolve} title={ui('放弃修改')} aria-label={ui('放弃修改')}>
        <X className="size-4" aria-hidden="true" />
      </button>
    </span>
  </div>;
}
