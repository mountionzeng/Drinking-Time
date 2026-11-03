import { z } from 'zod';

/** A proposal remembers the exact source; it never follows a later selection. */
export const bookRewriteTargetSchema = z.object({
  storyId: z.number().int().positive(),
  scope: z.string().min(1),
  parts: z.array(z.object({
    id: z.string().min(1), text: z.string().max(200_000),
    start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  }).refine(part => part.start <= part.end && part.end <= part.text.length)).min(1).max(200),
}).refine(target => new Set(target.parts.map(part => part.id)).size === target.parts.length);
export const bookRewriteProposalSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  target: bookRewriteTargetSchema,
});
export type BookRewriteTarget = z.infer<typeof bookRewriteTargetSchema>;
export type BookRewriteProposal = z.infer<typeof bookRewriteProposalSchema>;
export function bookRewriteSource(target: BookRewriteTarget) {
  return target.parts.map(part => part.text.slice(part.start, part.end)).join('\n');
}
