import { z } from "zod";
import type { ParagraphAnchor } from "./articleIllustrations";
import type { PackageImageInfo } from "./chapterPackage";
import { moduleDocumentSchema } from "./sharedLayout";

/** Max old versions kept per chapter so an adopted candidate can be undone. */
export const CHAPTER_VERSION_KEEP = 10;
export const CHAPTER_IMPORT_PER_HOUR = 20;
export const CHAPTER_MAX_PER_STORY = 100;

/** `blockIds` lines up with `lines` (text) and `images` in reading order; kept so ids survive edits. */
export type StoredChapterBlocks = {
  body: string;
  blockIds: string[];
  containsAiText: boolean;
  settings: { fontId: string; style: string; texture: string; textureSeed: number } | null;
  /** Storage keys only, never signed urls or data urls. */
  coverKey: string | null;
  bodyTextureKey: string | null;
  /** Facts about each stored image key (mime, size, sha256), needed to export. */
  images: Record<string, PackageImageInfo>;
  illustrations: { key: string; after: ParagraphAnchor | null }[];
};

export const chapterTitleSchema = z.string().trim().min(1).max(200);
export const chapterLayoutSchema = moduleDocumentSchema.nullable();
export const chapterEnabled = () => process.env.CHAPTER_PACKAGE_ENABLED === "true";

/**
 * Chapters picked for one platform draft -> a body. Follows the chapters' own
 * order (not the order of `pickedIds`), one non-blank line per text block, and
 * skips ids that are not in `chapters`. Chapter titles are not added to the body.
 */
export function composeBodyFromChapters(
  chapters: readonly { id: number; position: number; blocks: Pick<StoredChapterBlocks, "body"> }[],
  pickedIds: readonly number[]
): { body: string; chapterIds: number[] } {
  const picked = new Set(pickedIds);
  const ordered = chapters
    .filter(chapter => picked.has(chapter.id))
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const lines = ordered.flatMap(chapter =>
    chapter.blocks.body.replace(/\r\n?/g, "\n").split("\n").filter(line => line.trim() !== "")
  );
  return { body: lines.join("\n"), chapterIds: ordered.map(chapter => chapter.id) };
}
