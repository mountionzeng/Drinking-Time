import { z } from "zod";
import { parseChapterPackage } from "@shared/chapterPackage";

export const CHAPTER_FILE_MAX_BYTES = 12 * 1024 * 1024;
const envelope = z.object({
  package: z.unknown(),
  images: z
    .array(
      z.object({
        assetId: z.string().max(80),
        base64: z.string().max(2_800_000),
      })
    )
    .max(12)
    .default([]),
});
/** The package stays unchanged; its image bytes travel beside it in a download envelope. */
export function parseChapterFile(text: string) {
  if (new TextEncoder().encode(text).length > CHAPTER_FILE_MAX_BYTES)
    throw new Error("章节文件超过 12 MB");
  const raw: unknown = JSON.parse(text);
  const value =
    typeof raw === "object" && raw !== null && "package" in raw
      ? envelope.parse(raw)
      : { package: raw, images: [] };
  return { package: parseChapterPackage(value.package), images: value.images };
}
