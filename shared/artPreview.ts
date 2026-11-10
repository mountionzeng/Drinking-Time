import { z } from "zod";

export const artPreviewShotSchema = z.object({
  stableShotId: z.string().min(1), shotNo: z.number().int().positive(), label: z.string(),
  brief: z.string().min(1).max(1700), adaptation: z.string().min(1).max(400), requestId: z.string().uuid(),
});
export const artPreviewBatchSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), createdAt: z.number(), editorId: z.number(), editorName: z.string(),
  instruction: z.string(), sourceHash: z.string(), baselineImageId: z.number().int().positive(),
  musicContext: z.string(), estimatedCny: z.number(), shots: z.array(artPreviewShotSchema).min(1).max(12),
});
export type ArtPreviewBatch = z.infer<typeof artPreviewBatchSchema>;
export type ArtPreviewCommand = { kind: "plan"; imageId?: number } | { kind: "show" } |
  { kind: "choose"; shotNo: number; ordinal: number; version?: number };
const ordinal = (value: string) => Number(value) || ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[value];
export function parseArtPreviewChat(text: string): ArtPreviewCommand | null {
  const value = text.trim();
  if (/^(?:不要|先不|暂不|别|怎么|如何|don't\b|do not\b|how\b)/i.test(value)) return null;
  const choice = value.match(/第\s*(\d+|[一二三四五六七八九十])\s*(?:个)?镜(?:头)?\s*(?:采用|选|选择|用|就用)\s*第?\s*(\d+|[一二三四])\s*张\s*[。！!]?$/)
    ?? value.match(/shot\s*(\d+)\s*(?:use|choose|select)\s*(?:image\s*)?#?(\d+)\s*[.!]?$/i);
  if (choice) return { kind: "choose", shotNo: ordinal(choice[1]), ordinal: ordinal(choice[2]), version: Number(value.match(/\bV0*(\d+)/i)?.[1]) || undefined };
  if (!/示意图|示意方案|跨镜头预览|镜头小样|storyboard previews?/i.test(value)) return null;
  if (/查看|看看|继续|恢复|show|resume/i.test(value) && !/生成|制作|重新|generate|create/i.test(value)) return { kind: "show" };
  if (/生成|制作|出一|做一|重新|generate|create/i.test(value)) return { kind: "plan", imageId: Number(value.match(/(?:图片|图像|图|image)\s*#\s*(\d+)/i)?.[1]) || undefined };
  return null;
}

export function readArtPreviewBatches(body: Record<string, unknown>): ArtPreviewBatch[] {
  return (Array.isArray(body.artPreviewBatches) ? body.artPreviewBatches : []).flatMap(raw => {
    const parsed = artPreviewBatchSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}
