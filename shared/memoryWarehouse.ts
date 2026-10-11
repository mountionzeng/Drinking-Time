import { z } from "zod";

export const memoryCardInputSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(12_000),
  kind: z.enum(["event", "thought", "conversation"]),
  origin: z.enum(["note", "user", "assistant"]),
  sourceStoryId: z.number().int().positive().nullable(),
});
export type MemoryCardInput = z.infer<typeof memoryCardInputSchema>;
export const memoryCardSnapshotSchema = memoryCardInputSchema.extend({
  content: z.string().min(1).max(12_000),
  createdAt: z.number(),
});
export type MemoryCardSnapshot = z.infer<typeof memoryCardSnapshotSchema>;
export const memoryCardSelectionSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(20)
  .refine(
    ids => new Set(ids).size === ids.length,
    "不能重复选择同一张记忆卡片"
  );
