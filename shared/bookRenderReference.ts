import { z } from "zod";

export const bookReferenceSource = z.union([z.literal("above"), z.literal("previous"), z.number().int().min(1).max(9999)]);
export type BookReferenceSource = z.infer<typeof bookReferenceSource>;
export const bookRenderReference = z.object({
  source: bookReferenceSource,
  imageId: z.number().int().positive(),
  fingerprint: z.string().length(64),
  use: z.enum(["continuity", "scene", "style"]),
  sendThumbnail: z.boolean(),
  allowPublicHosting: z.literal(true).optional(),
});
export type BookRenderReference = z.infer<typeof bookRenderReference>;

/** Only interpret a reference instruction, never a shot number mentioned in ordinary scene prose. */
export function bookReferenceIntent(text: string): { source: BookReferenceSource; use: BookRenderReference["use"] } | undefined {
  const commands = /(?:参考|沿用|参照|借用|照着|对齐)\s*(?:(?:第\s*)?(\d{1,4})\s*(?:镜头?|的(?:图|色调|画风|色彩|配色|风格))|(上一?个?镜头?)|上图|上(?:面|方|一张)(?:的|那张|这张|一张)?图)/g;
  const match = [...text.matchAll(commands)].at(-1);
  if (!match) return;
  const before = text.slice(0, match.index);
  if (/(?:不(?:要|用|再|必|需)?|别)\s*$/.test(before)) return;
  const source = match[1] ? Number(match[1]) : match[2] ? "previous" : "above";
  if (!source) return;

  const request = text.slice(match.index);
  const style = /色调|画风|色彩|配色|风格/;
  const subject = /建筑|城墙|城门|楼房|房屋|人物|角色|人脸|服饰|天气|雨雪|场景|机位|视角|主体|姿势/;
  const explicitStyle = /(?:只|仅)(?:要|借用?|参考|沿用|用|取)?(?:它的|图中的|图的|其|的)?(?:色调|画风|色彩|配色|风格)/;
  const asksOnly = /(?:只|仅仅?)\s*$/.test(before) && !/(?:不|不是)(?:只|仅仅?)\s*$/.test(before);
  const object = request.split(/[，,。；;\n]/,1)[0];
  // A later correction can expand a previously style-only reference or narrow it again.
  for (const part of request.split(/[，,。；;\n]/).reverse()) {
    const clause = part.replace(/(?:不只|不仅仅?|不是只)(?:是)?/g, "");
    if (explicitStyle.test(clause)) return { source, use: "style" };
    if (subject.test(clause) && /同一|相同|一样|一致|保持|延续|不变/.test(clause)) return { source, use: "continuity" };
  }
  if (asksOnly && style.test(object) && !/构图/.test(object)) return { source, use: "style" };
  if (subject.test(request)) return { source, use: "continuity" };
  if (/构图/.test(object)) return { source, use: "scene" };
  if (/的(?:色调|画风|色彩|配色|风格)/.test(object)) return { source, use: "style" };
  return { source, use: "continuity" };
}
