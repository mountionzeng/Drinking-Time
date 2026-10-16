import { z } from "zod";

export const layoutOperationKindSchema = z.enum([
  "text",
  "move",
  "resize",
  "crop",
  "style",
  "move-page",
  "add-text",
  "add-image",
  "delete-module",
  "insert-page",
  "delete-page",
  "arrange",
]);
export type LayoutOperationKind = z.infer<typeof layoutOperationKindSchema>;
export const layoutMemoryContextSchema = z.object({
  storyId: z.number().int().positive(),
  scope: z.string().min(1).max(2000),
  total: z.number().int().min(0).max(100),
  recent: z
    .array(
      z.object({
        kind: layoutOperationKindSchema,
        summary: z.string().min(1).max(700),
        undone: z.boolean(),
        at: z.number().finite().nonnegative(),
        sameSource: z.boolean(),
      })
    )
    .max(20),
});
export type LayoutMemoryContext = z.infer<typeof layoutMemoryContextSchema>;

export function layoutMemoryDescription(memory: LayoutMemoryContext) {
  return `【用户实际排版操作记录（本机，本故事最近${memory.total}次；以下按时间顺序）】\n${memory.recent
    .map(
      item =>
        `${item.undone ? "[已撤销的尝试]" : "[已操作]"}${item.sameSource ? "" : "[其他排版版本]"} ${item.summary}`
    )
    .join("\n")}\n【记录结束】`;
}
