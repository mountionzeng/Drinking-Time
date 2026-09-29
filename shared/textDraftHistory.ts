import { z } from "zod";
import { PUBLISHING_PLATFORM_IDS } from "./publishingDraft";

export const textDraftContentSchema = z.object({
  title: z.string().max(160),
  body: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().max(80)).max(12),
});
export const textSourceSchema = z.enum([
  "unknown",
  "own",
  "reference",
  "liked",
]);
export const textDraftMessageSchema = z.object({
  id: z.string().min(1).max(200),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(20_000),
});
export const textDraftRequestSchema = z.object({
  storyId: z.number().int().positive(),
  operationToken: z.string().min(8).max(100),
  expectedRevision: z.number().int().nonnegative(),
  platform: z.enum(PUBLISHING_PLATFORM_IDS),
  parentId: z.string().max(100).nullable(),
  basis: textDraftContentSchema.nullable(),
  messages: z.array(textDraftMessageSchema).max(200),
  instruction: z.string().max(8_000),
  source: textSourceSchema,
});
export type TextDraftRequest = z.infer<typeof textDraftRequestSchema>;
export type TextDraftMessage = z.infer<typeof textDraftMessageSchema>;
export type TextDraftContent = z.infer<typeof textDraftContentSchema>;
export const techniqueChoiceSchema = z.object({
  id: z.string().max(80),
  reason: z.string().max(600),
  strength: z.enum(["light", "medium"]),
});
export const writingObservationSchema = z.object({
  originalExpression: z.string().max(1200),
  adoptionLearning: z.string().max(1200),
  confidence: z.enum(["insufficient", "tentative", "supported"]),
  choices: z.array(techniqueChoiceSchema).max(3),
});
export const textDraftVersionSchema = z.object({
  id: z.string(),
  sequence: z.number().int(),
  requestHash: z.string(),
  status: z.enum(["generating", "ready", "failed", "unknown"]),
  error: z.string().optional(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
  request: textDraftRequestSchema,
  conversationSnapshot: z.array(textDraftMessageSchema),
  conversationDelta: z.array(textDraftMessageSchema),
  promptVersion: z.string(),
  libraryVersion: z.string(),
  systemPrompt: z.string(),
  modelMessage: z.string(),
  modelLabel: z.string().optional(),
  originalLearningEnabled: z.boolean().optional(),
  generated: textDraftContentSchema.optional(),
  observation: writingObservationSchema.optional(),
  adoption: z
    .object({
      content: textDraftContentSchema,
      adoptedAt: z.number(),
      feedback: z.string().max(2000),
      learningEnabled: z.boolean(),
    })
    .optional(),
});
export type TextDraftVersion = z.infer<typeof textDraftVersionSchema>;
export const textDraftHistorySchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  versions: z.array(textDraftVersionSchema),
});
export type TextDraftHistory = z.infer<typeof textDraftHistorySchema>;
export function readTextDraftHistory(value: unknown): TextDraftHistory {
  if (value == null) return { schemaVersion: 1, revision: 0, versions: [] };
  // Never silently replace corrupt/newer history with an empty collection.
  return textDraftHistorySchema.parse(value);
}

/** Changed messages are delta too; timestamps alone cannot detect edits. */
export function textConversationDelta(
  previous: readonly TextDraftMessage[],
  current: readonly TextDraftMessage[]
) {
  const seen = new Map(previous.map(message => [message.id, message]));
  return current.filter(message => {
    const prior = seen.get(message.id);
    return (
      !prior || prior.content !== message.content || prior.role !== message.role
    );
  });
}
