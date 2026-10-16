import { z } from "zod";

const rect = z.object({
  x: z.number().finite().min(0).max(1200),
  y: z.number().finite().min(0).max(1200),
  width: z.number().finite().positive().max(1200),
  height: z.number().finite().positive().max(1200),
});

/** A user-provided discussion snapshot, never an authority for writes or asset access. */
export const layoutModuleContextSchema = z
  .object({
    storyId: z.number().int().positive(),
    scope: z.string().min(1).max(2000),
    moduleId: z.string().min(1).max(200),
    kind: z.enum(["text", "image"]),
    page: z.number().int().min(1).max(9),
    pageCount: z.number().int().min(1).max(9),
    rect,
    text: z.string().max(12_000).optional(),
    fontSize: z.number().finite().positive().max(2400).optional(),
    emphasis: z.enum(["normal", "bright"]).optional(),
    backdrop: z.boolean().optional(),
    crop: rect.optional(),
    pageText: z.string().max(16_000),
    // Only a bounded locally rendered JPEG; never fetch a client-supplied URL.
    pagePreview: z
      .string()
      .max(240_000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
  })
  .refine(value => value.page <= value.pageCount, "页码已失效");

export type LayoutModuleContext = z.infer<typeof layoutModuleContextSchema>;

export function layoutModuleLabel(context: LayoutModuleContext) {
  return `第 ${context.page} 页 · ${context.kind === "text" ? "文字" : "图片"}模块`;
}

export function layoutModuleDescription(context: LayoutModuleContext) {
  return [
    `${layoutModuleLabel(context)}（共 ${context.pageCount} 页）`,
    `页面为 900×1200；选中模块的位置和大小：${JSON.stringify(context.rect)}`,
    context.kind === "text"
      ? `模块原文：${context.text ?? ""}\n显示字号：${context.fontSize ?? "未知"}；${context.emphasis === "bright" ? "加粗浅色字" : "正常文字"}；${context.backdrop ? "有半透明底色" : "无底色"}`
      : `裁切范围（原图比例）：${JSON.stringify(context.crop)}`,
    `本页文字（仅作排版参考）：\n${context.pageText}`,
  ].join("\n");
}
