import { z } from "zod";

const crop = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict()
  .refine(value => value.x + value.width <= 1.00001 && value.y + value.height <= 1.00001, "图片裁切范围无效");
/** Image blocks refer only to the sanitized pictures in the same artwork snapshot. */
export const bookShareReadingSchema = z.object({
  blocks: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().max(200_000) }).strict(),
    z.object({ kind: z.literal("image"), image: z.number().int().min(0).max(8), crop }).strict(),
  ])).min(1).max(2000),
}).strict().refine(value => value.blocks.reduce((size, block) => size + (block.kind === "text" ? block.text.length : 0), 0) <= 200_000, "分享文字过长");
export type BookShareReading = z.infer<typeof bookShareReadingSchema>;
