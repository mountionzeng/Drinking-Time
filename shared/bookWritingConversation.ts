import { z } from "zod";

export const bookWritingDraftSchema = z.string().trim().min(1).max(40_000);

export const savedBookDocumentSchema = z.object({
  storyId: z.number().int().positive(),
  chapterId: z.number().int().positive(),
  title: z.string().min(1).max(200),
});

export const bookChatDraftSchema = z.object({
  storyId: z.number().int().positive(),
  scope: z.string().min(1).max(2000),
  text: bookWritingDraftSchema,
});

export const bookChatDocumentInput = z.object({
  requestId: z.string().min(1).max(160),
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(100).refine(text => !/[\r\n]/u.test(text)),
    text: z.string().min(1).max(200_000).refine(text => Boolean(text.trim())),
  })).min(1).max(12),
});
export type BookChatDocumentInput = z.infer<typeof bookChatDocumentInput>;

export function bookWritingRequest(message: string): "organize" | "draft" | undefined {
  const text = message.trim();
  if (/^(?:先不|不想|不用|别|不要|如果|比如)/u.test(text)) return;
  if (/(?:^|\n)\s*(?:帮我|请|麻烦|先)(?:把[^。！？\n]{1,80})?(?:梳理|理一下|理一理|整理)(?!成)|^(?:help me |please )?(?:organize|sort out) (?:these |the |my )?(?:notes|material)/iu.test(text)) return "organize";
  if (/(?:^|\n)\s*(?:帮我|请|麻烦|我想)(?:把|将)?[^。！？\n]{0,95}(?:写出来|写下来|写成(?:一段|文章|书稿)|放进书里|写进书里)|^(?:help me |please )?(?:draft|write up) /iu.test(text)) return "draft";
}

export function bookDocumentRequest(message: string) {
  const text = message.trim();
  const command = text.replace(/^(?:(?:这(?:一)?版(?:就)?定了|就按这(?:一)?版|定稿了|好的|OK)[。.!！；;，,\s]+)*/iu, '');
  if (!/^(?:(?:帮我|请|麻烦(?:你)?|我想|现在|please)[ \t]*)*(?:[把将][^。！？\n]{1,100}?)?(?:另存|创建|新建|建|保存|存为|create|save)[^。！？\n]{0,120}(?:文档|文稿|document)/iu.test(command)) return;
  // Quoted titles prevent conversational wording from becoming part of a file name.
  const title = (command.match(/(?:叫|名为|题为|命名为)\s*[《「『“"]([^》」』”"\r\n]{1,200})[》」』”"]/u) ??
    command.match(/[《「『“"]([^》」』”"\r\n]{1,200})[》」』”"]/u))?.[1].trim();
  return { title, keepVerbatim: /原话|原文|原样|逐字|照录|as written|verbatim/iu.test(text) };
}
