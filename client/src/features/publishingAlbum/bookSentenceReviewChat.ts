import { readUiLanguage, translateUi } from '@/features/uiLanguage/UiLanguage';
import type { WritingCompanionSnapshot } from '@/features/writingCompanion/writingCompanionText';
import type { ChatMessage } from '@/features/storyAgent/types';
import { useBookModuleActions } from './bookModuleActions';
import { parseSentenceEdit } from './sentenceEditTarget';
import { bookBlockContext } from './bookBlockContext';
import { findPassages, parsePassageReference, recheckPassage, resumeBookPassage } from './bookPassageTarget';
import { writingBlockOffset } from './chapterBlockTree';
import { bookRewriteSource, isInlineBookRewrite, type BookRewriteChoices, type BookRewriteTarget } from '@shared/bookRewrite';

export function bookSentenceReviewReply(
  request: ChatMessage, storyId: number | null, snapshot: WritingCompanionSnapshot | undefined
): ChatMessage | undefined {
  if (!snapshot || snapshot.selection || snapshot.module?.selection) return;
  const edit = parseSentenceEdit(request.content);
  if (!edit) return;
  const editor = useBookModuleActions.getState().session;
  const matchesScope = editor?.storyId === storyId && editor.scope === snapshot.scope;
  const draftChanged = matchesScope && editor.chapterDocument && editor.chapterDocument.body !== snapshot.draft;
  const target = matchesScope && !draftChanged ? editor?.locateSentenceEdit?.(edit) : undefined;
  return {
    id: `reply:${request.id}`,
    role: 'assistant',
    content: translateUi(readUiLanguage(), target ? '请在原文里查看这处修改。'
      : draftChanged ? '书稿内容或版本已变化，请按当前正文重新指定要改的位置。'
      : '请用引号标出原句，或指定它所在的章节。'),
    timestamp: Date.now(),
    ...(target && { bookRewrite: { target, text: edit.text, sentenceInstruction: request.content } }),
  };
}

type PreparedBookReview = { reply: ChatMessage; writingContext?: never } | { writingContext: WritingCompanionSnapshot; reply?: never };

export function prepareBookReview(
  request: ChatMessage, storyId: number | null, snapshot: WritingCompanionSnapshot | undefined,
  messages: readonly ChatMessage[],
): PreparedBookReview | undefined {
  if (!snapshot || snapshot.selection || snapshot.module?.selection) return;
  const exact = bookSentenceReviewReply(request, storyId, snapshot);
  if (exact) return { reply: exact };

  const mention = parsePassageReference(request.content);
  const lastAssistant = messages.findLast(message => message.role === 'assistant');
  const options = lastAssistant?.bookRewriteChoices;
  const focus = lastAssistant?.bookRewriteFocus;
  const scopedFocus = focus?.storyId === storyId && focus.scope === snapshot.scope ? focus : undefined;
  const briefEdit = /^(?:就)?(?:帮我)?(?:收短|缩短|精简|润色|口语)(?:一?[点下些]|一点儿)?[。.!！]?$/u.test(request.content.trim());
  const reference = mention ?? (scopedFocus && briefEdit ? { kind: 'current' as const } : undefined);
  const choiceText = request.content.trim().match(/^(?:第\s*)?([12一二两])\s*(?:段|个|处|项|条|[.。])?$/u)?.[1];
  const choice = choiceText ? (/[1一]/u.test(choiceText) ? 0 : 1)
    : /^(?:前面|开头|前一段|前者)(?:那(?:一|个)?[段句]?)?[。.]?$/u.test(request.content.trim()) ? 0
    : /^(?:后面|结尾|后一段|后者)(?:那(?:一|个)?[段句]?)?[。.]?$/u.test(request.content.trim()) ? 1 : undefined;
  const scopedOption = choice !== undefined ? options?.targets[choice] : undefined;
  const selected = scopedOption?.storyId === storyId && scopedOption?.scope === snapshot.scope ? scopedOption : undefined;
  if (!reference && !selected) return;

  const makeReply = (message: string, choices?: BookRewriteChoices, focus?: BookRewriteTarget) => ({
    reply: {
      id: `reply:${request.id}`,
      role: 'assistant' as const,
      content: translateUi(readUiLanguage(), message),
      timestamp: Date.now(),
      ...(choices && { bookRewriteChoices: choices }),
      ...(focus && { bookRewriteFocus: focus }),
    },
  });
  const editor = useBookModuleActions.getState().session;
  const chapter = editor?.chapterDocument;
  if (!storyId || !chapter || editor.storyId !== storyId || editor.scope !== snapshot.scope || chapter.body !== snapshot.draft)
    return makeReply('书稿内容或版本已变化，请按当前正文重新指定要改的位置。');

  const blocks = chapter.blocks;
  const source = { storyId, scope: snapshot.scope, chapterId: chapter.chapterId };
  const instruction = selected && options ? options.instruction : request.content.slice(0, 6000);
  const locateOnly = selected ? options?.locateOnly : reference?.kind === 'mention' && reference.locateOnly;
  const previous = messages.findLast(message => message.bookRewrite &&
    isInlineBookRewrite(message.bookRewrite) && message.bookRewrite.target.scope === snapshot.scope &&
    message.bookRewrite.target.storyId === storyId)?.bookRewrite;
  const usePrevious = reference?.kind === 'recent' || reference?.kind === 'current' && !snapshot.module;
  const prior = usePrevious && previous ? resumeBookPassage(blocks, previous) : undefined;
  const pinned = selected ?? (reference?.kind === 'current' ? scopedFocus : undefined);
  const choices = pinned ? [recheckPassage(blocks, pinned)].filter((target): target is BookRewriteTarget => Boolean(target))
    : prior ? [prior.target]
    : reference ? findPassages(blocks, reference, source, snapshot.module?.moduleId) : [];
  if (!choices.length) return makeReply(usePrevious && previous || pinned
    ? '书稿内容或版本已变化，请按当前正文重新指定要改的位置。'
    : '你指的是哪一段？可以选中它，或在这里引用一句原文。');
  if (choices.length > 2) return makeReply('你指的是哪一段？可以选中它，或在这里引用一句原文。');
  if (choices.length === 2) {
    const targets = choices;
    const snippets = targets.map((target, index) => {
      const text = bookRewriteSource(target).trim();
      const needle = reference?.kind === 'mention' ? text.toLowerCase().indexOf(reference.text.toLowerCase()) : 0;
      const start = Math.max(0, needle - 24);
      return `${index + 1}. ${start ? '…' : ''}${text.slice(start, start + 92)}${start + 92 < text.length ? '…' : ''}`;
    });
    const reply = makeReply('你指的是哪一段？回复 1 或 2。', { instruction, targets, ...(locateOnly && { locateOnly: true }) }).reply;
    return { reply: { ...reply, content: `${reply.content}\n\n${snippets.join('\n')}` } };
  }

  const target = choices[0];
  if (locateOnly) {
    const reply = makeReply('你说的是这一段。想怎么改？', undefined, target).reply;
    const text = bookRewriteSource(target).trim();
    return { reply: { ...reply, content: `${reply.content}\n\n${text.slice(0, 140)}${text.length > 140 ? '…' : ''}` } };
  }
  const part = target.parts[0];
  const index = blocks.findIndex(block => block.id === part.id);
  const module = bookBlockContext(blocks, part.id, source);
  if (!module || index < 0) return makeReply('书稿内容或版本已变化，请按当前正文重新指定要改的位置。');
  return {
    writingContext: {
      ...snapshot,
      bookRewriteTarget: target,
      rewriteSource: bookRewriteSource(target),
      module: {
        ...module,
        bookPassage: {
          start: writingBlockOffset(blocks, index) + part.start,
          chapterTitle: snapshot.chapterTitle,
          chapterVersion: snapshot.chapterVersion,
          instruction,
          ...(prior && { previousText: prior.previousText, previousInstruction: previous?.passageInstruction ?? previous?.sentenceInstruction }),
        },
      },
    },
  };
}

export function bookRewriteReplyMetadata(text: string | undefined, context: WritingCompanionSnapshot | undefined) {
  if (!text || !context?.bookRewriteTarget || text === bookRewriteSource(context.bookRewriteTarget)) return {};
  const edit = context.module?.bookPassage;
  return { bookRewrite: {
    target: context.bookRewriteTarget,
    text,
    ...(edit && { passageInstruction: edit.instruction, chapterVersion: edit.chapterVersion }),
  } };
}
