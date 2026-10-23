import { z } from "zod";
import type { ParagraphAnchor } from "./articleIllustrations";
import type { PackageImageInfo } from "./chapterPackage";
import {
  moduleDocumentSchema,
  type ModuleDocument,
  type ImagePackModule,
} from "./sharedLayout";
import { chapterPackageLines, sha256Hex } from "./chapterPackage";

/** Max old versions kept per chapter so an adopted candidate can be undone. */
export const CHAPTER_VERSION_KEEP = 10;
export const CHAPTER_IMPORT_PER_HOUR = 20;
export const CHAPTER_MAX_PER_STORY = 100;

/** One nonblank body line per blockId. Layout stores bindings; it never stores another text copy. */
export type StoredChapterBlocks = {
  body: string;
  blockIds: string[];
  containsAiText: boolean;
  settings: {
    fontId: string;
    style: string;
    texture: string;
    textureSeed: number;
  } | null;
  /** Storage keys only, never signed urls or data urls. */
  coverKey: string | null;
  bodyTextureKey: string | null;
  /**
   * Set only on the chapter that mirrors the platform draft: the sha256 of the
   * draft body it last copied. A chapter without it never follows the draft.
   */
  draftMirror?: { source: string; fingerprint: string };
  lineage?: { rootPackageId: string; parentPackageId: string | null };
  sourceChapterId?: string;
  /** Facts about each stored image key (mime, size, sha256), needed to export. */
  images: Record<string, PackageImageInfo>;
  illustrations: {
    key: string;
    after: ParagraphAnchor | null;
    blockId?: string;
    caption?: string;
  }[];
};

export const chapterTitleSchema = z.string().trim().min(1).max(200);
export const chapterLayoutSchema = moduleDocumentSchema.nullable();
export const chapterEnabled = () =>
  process.env.CHAPTER_PACKAGE_ENABLED === "true";

/** Persist bindings, not a second copy of the chapter's text. */
export type StoredChapterLayout = Omit<ModuleDocument, "pages"> & {
  pages: {
    label: string;
    modules: (
      | Exclude<ImagePackModule, { kind: "text" }>
      | (Omit<Extract<ImagePackModule, { kind: "text" }>, "text"> & {
          bind: string | string[];
        })
    )[];
  }[];
};

export const draftFingerprint = (title: string, body: string) =>
  sha256Hex(JSON.stringify([title, body]));

export function readChapterLayout(
  title: string,
  blocks: StoredChapterBlocks,
  layout: StoredChapterLayout | null
): ModuleDocument | null {
  if (!layout) return null;
  const lines = chapterPackageLines(blocks.body);
  return {
    ...layout,
    pages: layout.pages.map(page => ({
      ...page,
      modules: page.modules.flatMap((module): ImagePackModule[] => {
        if (module.kind === "image") return [module];
        const { bind, ...style } = module;
        if (bind === "title") return [{ ...style, text: title }];
        const text = (Array.isArray(bind) ? bind : [bind])
          .flatMap(id => {
            const index = blocks.blockIds.indexOf(id);
            return index < 0 ? [] : [lines[index]];
          })
          .join("\n");
        return text ? [{ ...style, text }] : [];
      }),
    })),
  };
}

/** Module ids keep their block binding across moves, insertions and deletions. */
export function writeChapterLayout(
  title: string,
  blocks: StoredChapterBlocks,
  previous: StoredChapterLayout | null,
  document: ModuleDocument,
  fresh: () => string
) {
  const oldLines = chapterPackageLines(blocks.body);
  const bindings = new Map(
    previous?.pages.flatMap(page =>
      page.modules.flatMap(module =>
        module.kind === "text" ? [[module.id, module.bind] as const] : []
      )
    ) ?? []
  );
  const edits = new Map<string, { text: string; rank: number }>();
  const seenModules = new Set<string>();
  let nextTitle = title;
  let newRank = oldLines.length;
  const layout: StoredChapterLayout = {
    ...document,
    pages: document.pages.map(page => ({
      ...page,
      modules: page.modules.flatMap(
        (module): StoredChapterLayout["pages"][number]["modules"] => {
          if (seenModules.has(module.id))
            throw new Error("排版里有重复模块编号");
          seenModules.add(module.id);
          if (module.kind === "image") return [module];
          const { text, ...style } = module;
          const prior = bindings.get(module.id);
          if (module.id === "cover-title" || prior === "title") {
            nextTitle = text.trim() || title;
            return [{ ...style, bind: "title" }];
          }
          const ordinal = /^paragraph-(\d+)$/.exec(module.id);
          const existing =
            prior ??
            (!previous && ordinal
              ? blocks.blockIds[Number(ordinal[1])]
              : undefined);
          const previousIds = existing
            ? Array.isArray(existing)
              ? existing
              : [existing]
            : [];
          const lines = chapterPackageLines(text);
          if (!lines.length) return [];
          const ids = lines.map((_, index) => previousIds[index] ?? fresh());
          const oldRank = blocks.blockIds.indexOf(previousIds[0]);
          const rank = oldRank < 0 ? newRank++ : oldRank;
          lines.forEach((line, index) =>
            edits.set(ids[index], {
              text: line,
              rank: rank + index / (lines.length + 1),
            })
          );
          return [{ ...style, bind: ids.length === 1 ? ids[0] : ids }];
        }
      ),
    })),
  };
  // Text never placed on a page remains canonical; deleted bound modules remove their blocks.
  const previouslyBound = new Set(
    [...bindings.values()].flatMap(bind =>
      Array.isArray(bind) ? bind : [bind]
    )
  );
  blocks.blockIds.forEach((id, index) => {
    if (!edits.has(id) && !previouslyBound.has(id))
      edits.set(id, { text: oldLines[index], rank: index });
  });
  const ordered = [...edits].sort((a, b) => a[1].rank - b[1].rank);
  return {
    title: nextTitle,
    blocks: {
      ...blocks,
      body: ordered.map(([, value]) => value.text).join("\n"),
      blockIds: ordered.map(([id]) => id),
    },
    layout,
  };
}

/**
 * Chapters picked for one platform draft -> a body. Follows the chapters' own
 * order (not the order of `pickedIds`), one non-blank line per text block, and
 * skips ids that are not in `chapters`. Chapter titles are not added to the body.
 */
export function composeBodyFromChapters(
  chapters: readonly {
    id: number;
    position: number;
    blocks: Pick<StoredChapterBlocks, "body">;
  }[],
  pickedIds: readonly number[]
): { body: string; chapterIds: number[] } {
  const picked = new Set(pickedIds);
  const ordered = chapters
    .filter(chapter => picked.has(chapter.id))
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const lines = ordered.flatMap(chapter =>
    chapter.blocks.body
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter(line => line.trim() !== "")
  );
  return {
    body: lines.join("\n"),
    chapterIds: ordered.map(chapter => chapter.id),
  };
}

/** A stored layout may only point at images by url/key, never embed them. */
export const CHAPTER_LAYOUT_MAX_BYTES = 200 * 1024;
export function chapterLayoutProblem(
  layout: { pages: { modules: { kind: string; imageUrl?: string }[] }[] } | null
): string | null {
  if (!layout) return null;
  for (const page of layout.pages)
    for (const module of page.modules)
      if (
        module.kind === "image" &&
        (module.imageUrl ?? "").startsWith("data:")
      )
        return "排版里有只存在于本机的图片，暂时不能保存到服务器";
  if (
    new TextEncoder().encode(JSON.stringify(layout)).length >
    CHAPTER_LAYOUT_MAX_BYTES
  )
    return "排版太大，无法保存";
  return null;
}

/**
 * Keep line ids stable when a chapter's text is edited. Only meaningful when the
 * ids map one-to-one to the text lines (no pictures between them); otherwise the
 * ids are dropped and re-derived from content on the next export.
 * Lines kept at the start or end keep their id; edited lines in the middle keep
 * theirs by position; extra new lines get `fresh()` ids.
 */
export function realignBlockIds(
  oldBody: string,
  oldIds: readonly string[],
  newBody: string,
  fresh: () => string
): string[] {
  const lines = (text: string) =>
    text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter(line => line.trim() !== "");
  const before = lines(oldBody);
  const after = lines(newBody);
  if (oldIds.length === 0 || oldIds.length !== before.length) return [];
  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  )
    head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const middleOld = oldIds.slice(head, oldIds.length - tail);
  const middleNew = after.length - head - tail;
  const middle = Array.from(
    { length: middleNew },
    (_, index) => middleOld[index] ?? fresh()
  );
  return [
    ...oldIds.slice(0, head),
    ...middle,
    ...oldIds.slice(oldIds.length - tail),
  ];
}
