import { bookChatDraftSchema, bookDocumentRequest, bookWritingRequest, type BookChatDocumentInput } from '@shared/bookWritingConversation';
import { readUiLanguage, translateUi } from '@/features/uiLanguage/UiLanguage';
import type { ChatMessage } from '@/features/storyAgent/types';
import type { WritingCompanionSnapshot } from '@/features/writingCompanion/writingCompanionText';
import { bookRewriteReplyMetadata, prepareBookReview } from './bookSentenceReviewChat';

type Section = BookChatDocumentInput['sections'][number];
type CreateDocument = (input: {
  storyId: number;
  title: string;
  kind: 'text';
  containsAiText: boolean;
  chatDocument: BookChatDocumentInput;
}) => Promise<{ id: number; storyId: number; title: string }>;

const confirmedHeading = /^[#* \t-]*([^：:（(*]{1,80}?)(?:[（(](?:已?定稿|原话|原样保留)[^）)]{0,24}[）)]\s*\*{0,2}\s*[：:]?|(?:已定稿|原话|定稿原文)\s*[：:])([\s\S]*)$/u;

/** A note headed “微信原话” belongs to the manuscript, even though it mentions a destination. */
export function isBookWritingMaterialTurn(message: string) {
  return Boolean(bookWritingRequest(message)) || message.split(/\r?\n/u).some(line => confirmedHeading.test(line)) ||
    /^(?:(?:我的|这是|以下是)\s*)?(?:写作|原始|零散)?(?:笔记|素材|旧稿|我的记录)[：:\n]/u.test(message.trim());
}

function confirmedSections(messages: readonly ChatMessage[]): Section[] {
  const sections: Section[] = [];
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const lines = message.content.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index++) {
      const match = lines[index].match(confirmedHeading);
      if (!match) continue;
      const heading = match[1].trim();
      const content = match[2].replace(/^[ \t]+/u, '') || lines.slice(index + 1).find(line => line.trim()) || '';
      const quote = content.match(/^(?:「([^]*?)」|『([^]*?)』|“([^]*?)”)$/u);
      const text = quote?.slice(1).find(Boolean) ?? content;
      if (heading && text.trim() && !sections.some(item => item.heading === heading && item.text === text))
        sections.push({ heading, text });
    }
  }
  return sections;
}

function targetsFromRequest(message: string, drafts: Section[], memory: Section[]) {
  const afterTitle = message.replace(/《[^》]+》/gu, '');
  const requested = new Map<string, { index: number; candidates: Section[] }>();
  if (/书稿|刚才(?:的)?(?:这版|那段)|当前(?:稿|正文)|manuscript/iu.test(afterTitle))
    requested.set('draft', { index: afterTitle.search(/书稿|刚才(?:的)?(?:这版|那段)|当前(?:稿|正文)|manuscript/iu), candidates: drafts });
  const distinctHeadings = new Set(memory.map(item => item.heading));
  for (const heading of distinctHeadings) {
    const channel = heading.match(/微信|短信|邮件|朋友圈|微博|小红书|weChat|email/iu)?.[0] ?? heading;
    const index = afterTitle.indexOf(channel);
    if (index < 0) continue;
    const key = channel.toLowerCase();
    const entries = memory.filter(item => item.heading === heading);
    const previous = requested.get(key);
    requested.set(key, { index, candidates: [...(previous?.candidates ?? []), ...entries] });
  }
  for (const channel of afterTitle.matchAll(/微信|短信|邮件|朋友圈|微博|小红书|weChat|email/giu)) {
    if (!requested.has(channel[0].toLowerCase()))
      requested.set(channel[0].toLowerCase(), { index: channel.index, candidates: [] });
  }
  if (!requested.size && drafts.length === 1) requested.set('draft', { index: 0, candidates: drafts });
  const sources = [...requested.values()].sort((a, b) => a.index - b.index);
  const count = /两段|分别|分开|separately/iu.test(afterTitle) ? 2 : 1;
  if (sources.length < count || sources.some(source => source.candidates.length !== 1)) return;
  return sources.map(source => source.candidates[0]);
}

export async function prepareBookTurn(
  request: ChatMessage, storyId: number | null, snapshot: WritingCompanionSnapshot | undefined,
  messages: readonly ChatMessage[], create: CreateDocument,
): Promise<{ reply?: ChatMessage; writingContext?: WritingCompanionSnapshot } | undefined> {
  const wantsDocument = bookDocumentRequest(request.content);
  if (!wantsDocument || snapshot?.manuscriptKind === 'storyboard')
    return prepareBookReview(request, storyId, snapshot, messages);
  const reply = (content: string): ChatMessage => ({
    id: `reply:${request.id}`, role: 'assistant', timestamp: Date.now(), content: translateUi(readUiLanguage(), content),
  });
  if (!storyId || storyId < 1 || !snapshot) return { reply: reply('请先打开要保存文稿的故事。') };
  if (!wantsDocument.title) return { reply: reply('你想给这份文稿起什么名字？请把名字放在书名号或引号里。') };
  if (!wantsDocument.keepVerbatim && /重新写|改写后|润色后|再写一版/u.test(request.content))
    return { reply: reply('请标出要保存的具体原话和各段的名字，我会按你选定的文字保存。') };
  const fromModel = messages.findLast(message => message.bookChatDraft?.storyId === storyId && message.bookChatDraft.scope === snapshot.scope)?.bookChatDraft;
  const draft = /当前(?:稿|书稿|正文)|右边的(?:书稿|正文)/u.test(request.content) && snapshot.draft.trim()
    ? { text: snapshot.draft }
    : fromModel;
  const sections = targetsFromRequest(request.content, draft ? [{ heading: '书稿', text: draft.text }] : [], confirmedSections([...messages, request]));
  if (!sections) return { reply: reply('请标出要保存的具体原话和各段的名字，我会按你选定的文字保存。') };
  const saved = await create({
    storyId, title: wantsDocument.title, kind: 'text',
    containsAiText: Boolean(fromModel && draft === fromModel && sections.some(section => section.text === draft.text)),
    chatDocument: { requestId: request.id, sections },
  });
  return { reply: { ...reply('已按原话保存。'), bookDocument: { storyId: saved.storyId, chapterId: saved.id, title: saved.title } } };
}

export function bookChatReplyMetadata(
  result: { rewriteText?: string; bookDraft?: string }, context: WritingCompanionSnapshot | undefined, storyId: number | null,
) {
  const draft = bookChatDraftSchema.safeParse({ storyId, scope: context?.scope, text: result.bookDraft });
  return {
    ...bookRewriteReplyMetadata(result.rewriteText, context),
    ...(draft.success && { bookChatDraft: draft.data }),
  };
}
