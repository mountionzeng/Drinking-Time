import { z } from "zod";

export const MAX_WAREHOUSE_FILE_BYTES = 25 * 1024 * 1024;
export const WAREHOUSE_FILE_CHAT_EVENT = "warehouse-file-chat";
export const warehouseFileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(300),
  mime: z.string().max(120),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string(),
  extension: z.string(),
  extractedText: z.string().max(40000),
  extractionStatus: z.enum(["readable", "partial", "stored"]),
  extractionNote: z.string(),
});
export type WarehouseFile = z.infer<typeof warehouseFileSchema>;
export function readWarehouseFiles(body: unknown): WarehouseFile[] {
  const value =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).warehouseFiles
      : undefined;
  return Array.isArray(value)
    ? value.flatMap(row => {
        const parsed = warehouseFileSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
}
export function warehouseFileDownloadUrl(storyId: number, fileId: number) {
  return `/api/warehouse-files/${storyId}/${fileId}`;
}
export function warehouseFileChatIds(text: string): number[] {
  return [
    ...new Set(
      [...text.matchAll(/(?:仓库)?文件\s*#(\d+)|\bfile\s*#(\d+)/gi)]
        .map(match => Number(match[1] ?? match[2]))
        .filter(id => Number.isSafeInteger(id) && id > 0)
    ),
  ].slice(0, 8);
}
export function warehouseFileChatRequest(
  files: Array<{ id: number; name: string }>,
  question: string
) {
  return `${files.map(file => `仓库文件 #${file.id}「${file.name}」`).join("、")}\n${question.trim() || "先保存到仓库，告诉我能读取哪些内容。"}`;
}
