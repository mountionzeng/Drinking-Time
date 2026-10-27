/**
 * Chapter package v1 (contract 1.0.0): one or more chapters, their text blocks
 * and an optional module layout, packed so the web app and the mini-program can
 * exchange them. See docs/integrations/chapter-package-contract.md.
 *
 * Everything here is a pure function: no storage, no network, no randomness.
 * The mini-program has its own copy of the validator/hash helpers in
 * miniprogram/domain/chapterPackage.ts; both are checked against the same
 * fixtures in tests/fixtures/chapter-package/.
 */
import { z } from "zod";
import {
  imagePackParagraphs,
  normalizeImagePackBody,
  resolveIllustrationOffset,
  type ParagraphAnchor,
} from "./articleIllustrations";
import { moduleDocumentSchema, type ImagePackModule, type ModuleDocument } from "./sharedLayout";

export const CHAPTER_PACKAGE_KIND = "chapter-package";
export const CHAPTER_PACKAGE_VERSION = 1;
export const CHAPTER_PACKAGE_CONTRACT_VERSION = "1.0.0";
export const CHAPTER_PACKAGE_LIMITS = {
  chapters: 30,
  totalText: 20_000,
  jsonBytes: 240 * 1024,
  pagesPerChapter: 9,
  modulesPerPage: 300,
  images: 12,
  imageBytes: 2 * 1024 * 1024,
  totalImageBytes: 8 * 1024 * 1024,
} as const;

export const CHAPTER_PACKAGE_ERROR_CODES = [
  "UNSUPPORTED_VERSION",
  "INVALID_SHAPE",
  "MISSING_BLOCK_REF",
  "MISSING_ASSET_REF",
  "LIMIT_EXCEEDED",
  "FORBIDDEN_IDENTIFIER",
  /** Producer side only: the caller did not supply facts about an image. */
  "ASSET_INFO_MISSING",
] as const;
export type ChapterPackageErrorCode = (typeof CHAPTER_PACKAGE_ERROR_CODES)[number];

export class ChapterPackageError extends Error {
  readonly code: ChapterPackageErrorCode;
  constructor(code: ChapterPackageErrorCode, message: string) {
    super(message);
    this.name = "ChapterPackageError";
    this.code = code;
  }
}
const fail = (code: ChapterPackageErrorCode, message: string): never => {
  throw new ChapterPackageError(code, message);
};

// ---------------------------------------------------------------- hashing
// Pure SHA-256 so ids are deterministic without node:crypto (the mini-program
// domain layer has none). Verified against node:crypto in the tests.
function utf8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 of a UTF-8 string as lowercase hex. */
export function sha256Hex(text: string): string {
  const bytes = utf8(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  for (const word of [high, bitLength >>> 0])
    bytes.push((word >>> 24) & 255, (word >>> 16) & 255, (word >>> 8) & 255, word & 255);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map(value => value.toString(16).padStart(8, "0")).join("");
}

/** Deterministic id for a block that has none: the same chapter and content always give the same id. */
export const chapterPackageBlockId = (parts: readonly (string | number)[]) =>
  `block-${sha256Hex(JSON.stringify(parts))}`;
/** Opaque image id. The caller's own key (database id, photo id) never appears in a package. */
export const chapterPackageAssetId = (key: string) =>
  `asset-${sha256Hex(JSON.stringify(["chapter-package-v1-asset", key])).slice(0, 32)}`;

// ---------------------------------------------------------------- schema
const L = CHAPTER_PACKAGE_LIMITS;
const BLOCK_ID = /^block-[a-f0-9]{64}$/;
const ASSET_ID = /^asset-[a-f0-9]{32}$/;
const CHAPTER_ID = /^chapter-[a-z0-9-]{1,60}$/;
const PACKAGE_ID = /^cp_[A-Za-z0-9-]{8,64}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const blockIdSchema = z.string().regex(BLOCK_ID);
const assetIdSchema = z.string().regex(ASSET_ID);
const packageIdSchema = z.string().regex(PACKAGE_ID);
const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
/** One text block is exactly one line: no line breaks, never blank. */
const textSchema = z
  .string()
  .min(1)
  .max(L.totalText)
  .refine(text => !/[\r\n]/.test(text) && text.trim() !== "", "文字块必须是单行非空文字");

const textBlockSchema = z.object({ blockId: blockIdSchema, type: z.literal("text"), text: textSchema });
const imageBlockSchema = z.object({
  blockId: blockIdSchema,
  type: z.literal("image"),
  assetId: assetIdSchema,
  caption: z.string().max(200).optional(),
});
const blockSchema = z.discriminatedUnion("type", [textBlockSchema, imageBlockSchema]);

const moduleBase = {
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),
  rect: rectSchema,
  positioned: z.boolean().optional(),
};
const layoutModuleSchema = z.discriminatedUnion("kind", [
  z.object({
    ...moduleBase,
    kind: z.literal("text"),
    bind: z.union([z.object({ blockId: blockIdSchema }), z.object({ chapterTitle: z.literal(true) })]),
    fontSize: z.number().min(8).max(240),
    contentWidth: z.number().positive(),
    contentHeight: z.number().positive(),
    alignment: z.enum(["start", "center"]),
    emphasis: z.enum(["normal", "bright"]).optional(),
    backdrop: z.boolean().optional(),
  }),
  z.object({ ...moduleBase, kind: z.literal("image"), assetId: assetIdSchema, crop: rectSchema }),
]);
const layoutSchema = z.object({
  canvas: z.object({ width: z.literal(900), height: z.literal(1200) }),
  flowVersion: z.literal(1).optional(),
  settings: z.object({
    fontId: z.string().max(80),
    style: z.string().max(40),
    texture: z.string().max(40),
    textureSeed: z.number().int().min(0).max(1_000_000_000),
    includeCover: z.boolean(),
    bodyTextureAssetId: assetIdSchema.nullable(),
  }),
  pages: z.array(z.object({ label: z.string().max(80), modules: z.array(layoutModuleSchema) })).min(1),
});
const chapterSchema = z.object({
  chapterId: z.string().regex(CHAPTER_ID),
  title: z.string().max(200),
  containsAiText: z.boolean().default(false),
  cover: z.object({ assetId: assetIdSchema }).nullable().default(null),
  blocks: z.array(blockSchema),
  layout: layoutSchema.nullable().default(null),
});
const assetSchema = z.object({
  assetId: assetIdSchema,
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
  aiGenerated: z.boolean(),
});
export const chapterPackageSchema = z.object({
  kind: z.literal(CHAPTER_PACKAGE_KIND),
  version: z.literal(CHAPTER_PACKAGE_VERSION),
  packageId: packageIdSchema,
  lineage: z.object({ rootPackageId: packageIdSchema, parentPackageId: packageIdSchema.nullable() }),
  createdAt: z.string().regex(ISO_TIME),
  sender: z.object({ platform: z.enum(["web", "miniprogram"]), displayName: z.string().max(40), changeNote: z.string().trim().max(500).optional() }),
  storyTitle: z.string().max(200),
  chapters: z.array(chapterSchema),
  assets: z.array(assetSchema),
});
export type ChapterPackage = z.infer<typeof chapterPackageSchema>;
export type ChapterPackageChapter = ChapterPackage["chapters"][number];
export type ChapterPackageBlock = z.infer<typeof blockSchema>;
export type ChapterPackageLayout = NonNullable<ChapterPackageChapter["layout"]>;
export type ChapterPackageLayoutModule = z.infer<typeof layoutModuleSchema>;
export type ChapterPackageAsset = z.infer<typeof assetSchema>;
export type PackageImageInfo = Omit<ChapterPackageAsset, "assetId">;

/** Keys that identify a person, account or private record. Matched ignoring case, "_" and "-". */
const FORBIDDEN_KEYS = new Set([
  "openid", "unionid", "accountid", "familyid", "userid",
  "memoryid", "memoryids", "sourceid", "sourceids", "grantid",
]);
function findForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > 32 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""))) return key;
    const found = findForbiddenKey(item, depth + 1);
    if (found) return found;
  }
  return null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Cheap structural limit checks on the raw input, so a too-big package reports LIMIT_EXCEEDED, not a shape error. */
function checkLimits(raw: Record<string, unknown>) {
  const over = (what: string): never => fail("LIMIT_EXCEEDED", `章节包超出上限：${what}`);
  const chapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  if (chapters.length > L.chapters) over(`最多 ${L.chapters} 章`);
  let text = 0;
  for (const chapter of chapters) {
    const record = asRecord(chapter);
    if (!record) continue;
    for (const block of Array.isArray(record.blocks) ? record.blocks : []) {
      const b = asRecord(block);
      if (b?.type === "text" && typeof b.text === "string") text += b.text.length;
    }
    const pages = asRecord(record.layout)?.pages;
    if (Array.isArray(pages)) {
      if (pages.length > L.pagesPerChapter) over(`每章最多 ${L.pagesPerChapter} 页`);
      for (const page of pages) {
        const modules = asRecord(page)?.modules;
        if (Array.isArray(modules) && modules.length > L.modulesPerPage) over(`每页最多 ${L.modulesPerPage} 个模块`);
      }
    }
  }
  if (text > L.totalText) over(`文字合计最多 ${L.totalText} 字`);
  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  if (assets.length > L.images) over(`图片最多 ${L.images} 张`);
  let total = 0;
  for (const asset of assets) {
    const bytes = asRecord(asset)?.bytes;
    if (typeof bytes !== "number") continue;
    if (bytes > L.imageBytes) over("单张图片最多 2 MB");
    total += bytes;
  }
  if (total > L.totalImageBytes) over("图片合计最多 8 MB");
  let size: number;
  try {
    size = utf8(JSON.stringify(raw)).length;
  } catch {
    return fail("INVALID_SHAPE", "章节包不是合法的 JSON 数据");
  }
  if (size > L.jsonBytes) over("不含图片的 JSON 最多 240 KB");
}

function checkSemantics(pkg: ChapterPackage) {
  const assetIds = new Set<string>();
  for (const asset of pkg.assets) {
    if (assetIds.has(asset.assetId)) fail("INVALID_SHAPE", "图片编号重复");
    assetIds.add(asset.assetId);
  }
  const needAsset = (id: string) => {
    if (!assetIds.has(id)) fail("MISSING_ASSET_REF", "章节包引用了 assets 里没有的图片");
  };
  const chapterIds = new Set<string>();
  for (const chapter of pkg.chapters) {
    if (chapterIds.has(chapter.chapterId)) fail("INVALID_SHAPE", "章节编号重复");
    chapterIds.add(chapter.chapterId);
    const blockTypes = new Map<string, "text" | "image">();
    for (const block of chapter.blocks) {
      if (blockTypes.has(block.blockId)) fail("INVALID_SHAPE", "同一章内块编号重复");
      blockTypes.set(block.blockId, block.type);
      if (block.type === "image") needAsset(block.assetId);
    }
    const bound = new Set<string>();
    let titleBound = false;
    if (chapter.cover) needAsset(chapter.cover.assetId);
    const layout = chapter.layout;
    if (!layout) continue;
    if (layout.settings.bodyTextureAssetId) needAsset(layout.settings.bodyTextureAssetId);
    if (layout.settings.includeCover && !chapter.cover) fail("INVALID_SHAPE", "排版要求封面，但章节没有封面图片");
    for (const page of layout.pages) {
      const moduleIds = new Set<string>();
      for (const module of page.modules) {
        if (moduleIds.has(module.id)) fail("INVALID_SHAPE", "同一页内模块编号重复");
        moduleIds.add(module.id);
        const r = module.rect;
        if (r.x < 0 || r.y < 0 || r.x + r.width > 900.01 || r.y + r.height > 1200.01)
          fail("INVALID_SHAPE", "模块超出画布");
        if (module.kind === "image") {
          needAsset(module.assetId);
          const c = module.crop;
          if (c.x < 0 || c.y < 0 || c.x + c.width > 1.00001 || c.y + c.height > 1.00001)
            fail("INVALID_SHAPE", "图片裁切范围无效");
        } else if ("blockId" in module.bind) {
          if (blockTypes.get(module.bind.blockId) !== "text")
            fail("MISSING_BLOCK_REF", "排版引用了不存在的文字块");
          // One line is one text module; two modules may not show the same line.
          if (bound.has(module.bind.blockId)) fail("INVALID_SHAPE", "同一个文字块被多个模块引用");
          bound.add(module.bind.blockId);
        } else {
          if (titleBound) fail("INVALID_SHAPE", "章节标题被多个模块引用");
          titleBound = true;
        }
      }
    }
  }
}

/** Validate an untrusted package. Throws ChapterPackageError with a stable code. */
export function parseChapterPackage(input: unknown): ChapterPackage {
  const raw = asRecord(input);
  if (!raw) return fail("INVALID_SHAPE", "章节包必须是一个对象");
  if (raw.kind !== CHAPTER_PACKAGE_KIND) return fail("INVALID_SHAPE", "这不是章节包");
  if (raw.version !== CHAPTER_PACKAGE_VERSION)
    return fail("UNSUPPORTED_VERSION", "章节包的版本这个应用还不认识，请先更新应用");
  const forbidden = findForbiddenKey(raw);
  if (forbidden) return fail("FORBIDDEN_IDENTIFIER", `章节包不能包含账号或内部标识（${forbidden}）`);
  checkLimits(raw);
  const result = chapterPackageSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return fail("INVALID_SHAPE", `章节包格式不正确：${issue.path.join(".") || "根"} ${issue.message}`);
  }
  checkSemantics(result.data);
  return result.data;
}
export function safeParseChapterPackage(
  input: unknown
): { ok: true; package: ChapterPackage } | { ok: false; code: ChapterPackageErrorCode; message: string } {
  try {
    return { ok: true, package: parseChapterPackage(input) };
  } catch (error) {
    if (error instanceof ChapterPackageError) return { ok: false, code: error.code, message: error.message };
    throw error;
  }
}

export type ChapterPackageWarningCode =
  | "MODULE_TEXT_WINS"
  | "TITLE_MODULE_MISMATCH"
  | "MULTILINE_MODULE_SPLIT"
  | "UNREFERENCED_BLOCK_OMITTED"
  | "ILLUSTRATION_ANCHOR_UNRESOLVED"
  | "EMPTY_TEXT_MODULE_DROPPED"
  | "UNPLACED_BLOCKS";
export type ChapterPackageWarning = { code: ChapterPackageWarningCode; chapterId: string; message: string };

// ------------------------------------------------------------ web converter
/** Placeholder image key for an imported asset the caller has not downloaded yet. */
export const CHAPTER_PACKAGE_ASSET_URL_PREFIX = "chapter-package-asset:";
function assetIdForKey(key: string): string {
  if (key.startsWith(CHAPTER_PACKAGE_ASSET_URL_PREFIX)) {
    const id = key.slice(CHAPTER_PACKAGE_ASSET_URL_PREFIX.length);
    if (ASSET_ID.test(id)) return id;
  }
  return chapterPackageAssetId(key);
}
const keyForAsset = (assetId: string, assetKeys?: Record<string, string>) =>
  assetKeys?.[assetId] ?? `${CHAPTER_PACKAGE_ASSET_URL_PREFIX}${assetId}`;
/** "One line is one text block": split on line breaks and drop blank lines. */
export function chapterPackageLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").filter(line => line.trim() !== "");
}

export type PackageMeta = {
  packageId: string;
  createdAt: string;
  displayName: string;
  /** Defaults to the chapter title. */
  storyTitle?: string;
  /** Defaults to a fresh root (this package is its own root). */
  lineage?: { rootPackageId: string; parentPackageId: string | null };
};
/** A web story seen as one chapter. Image fields hold the caller's own keys (e.g. image URLs). */
export type WebChapterSource = {
  chapterId: string;
  title: string;
  body: string;
  containsAiText?: boolean;
  /** Only used when `modules` is set. Defaults match the image-pack defaults. */
  settings?: { fontId: string; style: string; texture: string; textureSeed: number };
  coverKey?: string | null;
  bodyTextureKey?: string | null;
  illustrations?: { key: string; after: ParagraphAnchor | null }[];
  modules?: ModuleDocument | null;
};
/** Facts about every image key the chapter uses; supplied by the caller. */
export type WebChapterImages = Record<string, PackageImageInfo>;
/**
 * What a round trip needs to remember. Optional: without it ids are derived from
 * content and module ids follow the `cover-title` / `paragraph-N` convention.
 */
export type WebChapterSidecar = {
  /** One id per block in reading order (text lines and illustrations), from a previous import. */
  blockIds: string[];
};
export type WebChapterPackResult = {
  package: ChapterPackage;
  /** assetId -> the caller's key, so images can be sent and matched separately. */
  assetKeys: Record<string, string>;
  warnings: ChapterPackageWarning[];
};

type Entry =
  | { type: "text"; text: string; manual?: { moduleId: string; line: number } }
  | { type: "image"; key: string };
type TextModuleOf = Extract<ImagePackModule, { kind: "text" }>;
const BLOCK_SCOPE = "chapter-package-v1";
const trimEq = (a: string, b: string) => a.trim() === b.trim();
const keyOfMeta = (meta: PackageMeta) => ({
  rootPackageId: meta.lineage?.rootPackageId ?? meta.packageId,
  parentPackageId: meta.lineage?.parentPackageId ?? null,
});

/** Body lines and illustrations in reading order, using the image-pack's own paragraph rules. */
function readingOrder(source: WebChapterSource, warnings: ChapterPackageWarning[]): Entry[] {
  const paragraphs = imagePackParagraphs(source.body);
  const lines = normalizeImagePackBody(source.body).split("\n").filter(line => line.trim() !== "");
  const entries: Entry[] = [];
  const placed = (offset: number) =>
    (source.illustrations ?? []).flatMap(item =>
      resolveIllustrationOffset(paragraphs, item.after) === offset ? [{ type: "image" as const, key: item.key }] : []
    );
  entries.push(...placed(0));
  paragraphs.forEach((paragraph, index) => {
    entries.push({ type: "text", text: lines[index] }, ...placed(paragraph.end));
  });
  for (const item of source.illustrations ?? []) {
    if (resolveIllustrationOffset(paragraphs, item.after) !== null) continue;
    warnings.push({
      code: "ILLUSTRATION_ANCHOR_UNRESOLVED",
      chapterId: source.chapterId,
      message: "有一张插图对应的段落已变化，已放到章节末尾。",
    });
    entries.push({ type: "image", key: item.key });
  }
  return entries;
}

type Draft =
  | { type: "text"; text: string; used: boolean }
  | { type: "image"; key: string; used: boolean };

/** Bind layout modules to entries; module text wins over the original line (sender's intent). */
function bindModules(
  source: WebChapterSource,
  entries: Entry[],
  warnings: ChapterPackageWarning[]
): { drafts: Draft[]; moduleOf: Map<string, { page: number; moduleId: string; blockPos: number | "title" }> } {
  const drafts: Draft[] = entries.map(entry =>
    entry.type === "text" ? { type: "text", text: entry.text, used: false } : { type: "image", key: entry.key, used: false }
  );
  const moduleOf = new Map<string, { page: number; moduleId: string; blockPos: number | "title" }>();
  const manual: Draft[] = [];
  const warn = (code: ChapterPackageWarningCode, message: string) =>
    warnings.push({ code, chapterId: source.chapterId, message });

  (source.modules?.pages ?? []).forEach((page, pageIndex) => {
    for (const module of page.modules) {
      if (module.kind === "image") continue;
      const sidecarKey = `${pageIndex}/${module.id}`;
      const bound = source.modules && module.id === "cover-title"
        ? "title"
        : source.modules && /^paragraph-(\d+)$/.test(module.id) && Number(/^paragraph-(\d+)$/.exec(module.id)![1]) <
            drafts.filter(d => d.type === "text").length
          ? Number(/^paragraph-(\d+)$/.exec(module.id)![1])
          : undefined;
      const target = bound ?? sidecarKey; // resolved below via sidecar mapping if caller supplied one
      if (target === "title") {
        if (!trimEq(module.text, source.title))
          warn("TITLE_MODULE_MISMATCH", "封面标题模块的文字和章节标题不一致，打包仍使用章节标题。");
        moduleOf.set(`${pageIndex}:${module.id}`, { page: pageIndex, moduleId: module.id, blockPos: "title" });
        continue;
      }
      if (typeof target === "number") {
        const lines = chapterPackageLines(module.text);
        const textDrafts = drafts.filter((d): d is Draft & { type: "text" } => d.type === "text");
        if (lines.length === 0) {
          warn("EMPTY_TEXT_MODULE_DROPPED", `第 ${target + 1} 段的模块文字已清空，这段不会被打包。`);
          continue;
        }
        if (!trimEq(lines[0], textDrafts[target]?.text ?? ""))
          warn("MODULE_TEXT_WINS", `第 ${target + 1} 段的排版文字和正文不同，打包使用排版里的文字。`);
        const position = drafts.indexOf(textDrafts[target]);
        drafts[position] = { type: "text", text: lines[0], used: true };
        moduleOf.set(`${pageIndex}:${module.id}`, { page: pageIndex, moduleId: module.id, blockPos: position });
        if (lines.length > 1) {
          warn("MULTILINE_MODULE_SPLIT", `一个模块的文字分成了 ${lines.length} 行，已拆成相邻的 ${lines.length} 个块。`);
          let after = position;
          for (let i = 1; i < lines.length; i++) {
            const extra: Draft = { type: "text", text: lines[i], used: true };
            drafts.splice(after + 1, 0, extra);
            moduleOf.set(`${pageIndex}:${module.id}~${i}`, { page: pageIndex, moduleId: `${module.id}~${i}`, blockPos: after + 1 });
            after += 1;
          }
        }
        continue;
      }
      // Manual module: not a recognised paragraph/title binding.
      for (const line of chapterPackageLines(module.text)) manual.push({ type: "text", text: line, used: true });
    }
  });
  for (const module of (source.modules?.pages ?? []).flatMap(p => p.modules)) {
    if (module.kind !== "image") continue;
    const match = drafts.find((d): d is Draft & { type: "image" } => d.type === "image" && d.key === module.imageUrl);
    if (match) match.used = true;
  }
  return { drafts: source.modules ? [...drafts.filter(d => d.used), ...manual] : drafts, moduleOf };
}

/** Story + module draft -> a chapter package. Pure: no network, no randomness besides the caller's ids. */
export function toChapterPackage(
  source: WebChapterSource,
  images: WebChapterImages,
  meta: PackageMeta,
  sidecar?: WebChapterSidecar
): WebChapterPackResult {
  const warnings: ChapterPackageWarning[] = [];
  const entries = readingOrder(source, warnings);
  const { drafts } = bindModules(source, entries, warnings);
  if (source.modules && drafts.length < entries.length)
    warnings.push({
      code: "UNREFERENCED_BLOCK_OMITTED",
      chapterId: source.chapterId,
      message: "排版没有用到的正文或插图没有打包，接收方看不到它们。",
    });
  const assetKeys: Record<string, string> = {};
  const assetInfoOf = (key: string): PackageImageInfo => {
    const info = images[key];
    if (!info) fail("ASSET_INFO_MISSING", `缺少图片 ${key} 的大小/格式信息，无法打包`);
    const assetId = assetIdForKey(key);
    assetKeys[assetId] = key;
    return info;
  };
  const assetIdOf = (key: string): string => {
    assetInfoOf(key);
    return assetIdForKey(key);
  };
  const blockIdFor = (index: number, draft: Draft) =>
    sidecar?.blockIds[index] ??
    chapterPackageBlockId(
      draft.type === "text"
        ? [BLOCK_SCOPE, source.chapterId, index, "text", draft.text]
        : [BLOCK_SCOPE, source.chapterId, index, "image", assetIdOf(draft.key)]
    );
  const blocks: ChapterPackageBlock[] = drafts.map((draft, index) =>
    draft.type === "text"
      ? { blockId: blockIdFor(index, draft), type: "text", text: draft.text }
      : { blockId: blockIdFor(index, draft), type: "image", assetId: assetIdOf(draft.key) }
  );
  const textBlockIndex = new Map<number, string>();
  let textOrdinal = 0;
  drafts.forEach((draft, index) => {
    if (draft.type === "text") textBlockIndex.set(textOrdinal++, blocks[index].blockId);
  });

  let layout: ChapterPackageLayout | null = null;
  if (source.modules) {
    const settings = source.settings;
    const pages = source.modules.pages.map(page => ({
      label: page.label,
      modules: page.modules.flatMap((module): ChapterPackageLayoutModule[] => {
        if (module.kind === "image") {
          const assetId = assetIdOf(module.imageUrl);
          return [{
            id: module.id, kind: "image", assetId, rect: module.rect, crop: module.crop,
            ...(module.positioned !== undefined ? { positioned: module.positioned } : {}),
          }];
        }
        const base: TextModuleOf = module;
        const binding = base.id === "cover-title"
          ? ({ chapterTitle: true } as const)
          : (() => {
              const match = /^paragraph-(\d+)$/.exec(base.id);
              if (!match) return null;
              const pos = Number(match[1]);
              const blockId = textBlockIndex.get(pos);
              return blockId ? ({ blockId } as const) : null;
            })();
        if (!binding) return [];
        return [{
          id: base.id, kind: "text", bind: binding, rect: base.rect,
          fontSize: base.fontSize, contentWidth: base.contentWidth, contentHeight: base.contentHeight,
          alignment: base.alignment,
          ...(base.emphasis !== undefined ? { emphasis: base.emphasis } : {}),
          ...(base.backdrop !== undefined ? { backdrop: base.backdrop } : {}),
          ...(base.positioned !== undefined ? { positioned: base.positioned } : {}),
        }];
      }),
    })).filter(page => page.modules.length > 0);
    layout = {
      canvas: { width: 900, height: 1200 },
      ...(source.modules.flowVersion ? { flowVersion: source.modules.flowVersion as 1 } : {}),
      settings: {
        fontId: settings?.fontId ?? "noto-serif-sc",
        style: settings?.style ?? "sage",
        texture: settings?.texture ?? "paper",
        textureSeed: settings?.textureSeed ?? 1,
        includeCover: Boolean(source.coverKey),
        bodyTextureAssetId: source.bodyTextureKey ? assetIdOf(source.bodyTextureKey) : null,
      },
      pages: pages.length ? pages : [{ label: "正文", modules: [] }],
    };
  }

  const usedAssetIds = new Set<string>();
  for (const block of blocks) if (block.type === "image") usedAssetIds.add(block.assetId);
  if (source.coverKey) usedAssetIds.add(assetIdOf(source.coverKey));
  if (source.bodyTextureKey) usedAssetIds.add(assetIdOf(source.bodyTextureKey));
  for (const page of layout?.pages ?? [])
    for (const module of page.modules) if (module.kind === "image") usedAssetIds.add(module.assetId);

  const assets: ChapterPackageAsset[] = [...usedAssetIds].sort().map(assetId => {
    const key = assetKeys[assetId] ?? fail("ASSET_INFO_MISSING", "缺少图片信息");
    return { assetId, ...images[key] };
  });

  const pkg = parseChapterPackage({
    kind: CHAPTER_PACKAGE_KIND,
    version: CHAPTER_PACKAGE_VERSION,
    packageId: meta.packageId,
    lineage: keyOfMeta(meta),
    createdAt: meta.createdAt,
    sender: { platform: "web", displayName: meta.displayName },
    storyTitle: meta.storyTitle ?? source.title,
    chapters: [{
      chapterId: source.chapterId,
      title: source.title,
      containsAiText: source.containsAiText ?? false,
      cover: source.coverKey ? { assetId: assetIdOf(source.coverKey) } : null,
      blocks,
      layout,
    }],
    assets,
  });
  return { package: pkg, assetKeys, warnings };
}

export type WebChapterResult = {
  chapterId: string;
  title: string;
  body: string;
  containsAiText: boolean;
  settings: { fontId: string; style: string; texture: string; textureSeed: number } | null;
  coverKey: string | null;
  bodyTextureKey: string | null;
  illustrations: { key: string; after: ParagraphAnchor | null }[];
  modules: ModuleDocument | null;
  /** assetId -> this result's own key (the placeholder url unless the caller resolved it). */
  assetKeys: Record<string, string>;
  /** Facts about every image this chapter uses, keyed the same way as `assetKeys` values. */
  images: WebChapterImages;
  sidecar: WebChapterSidecar;
  warnings: ChapterPackageWarning[];
};

/** Resolve a package asset to a key the caller can use (e.g. to fetch the bytes). */
export type ResolveAssetKey = (assetId: string, asset: ChapterPackageAsset) => string;

/** A chapter package (one chapter) -> a web story draft. Pure; images keep placeholder keys unless resolved. */
export function fromChapterPackage(
  input: unknown,
  options?: { chapterId?: string; resolveAssetKey?: ResolveAssetKey }
): WebChapterResult {
  const pkg = parseChapterPackage(input);
  const found = options?.chapterId
    ? pkg.chapters.find(item => item.chapterId === options.chapterId)
    : pkg.chapters[0];
  if (!found) return fail("INVALID_SHAPE", "章节包里没有这一章");
  const chapter = found;
  const warnings: ChapterPackageWarning[] = [];
  const assetById = new Map(pkg.assets.map(asset => [asset.assetId, asset]));
  const keyFor = (assetId: string) => {
    const asset = assetById.get(assetId);
    return options?.resolveAssetKey && asset ? options.resolveAssetKey(assetId, asset) : keyForAsset(assetId);
  };
  const assetKeys: Record<string, string> = {};
  const images: WebChapterImages = {};
  const useAsset = (assetId: string) => {
    const key = keyFor(assetId);
    assetKeys[assetId] = key;
    const asset = assetById.get(assetId);
    if (asset) { const { assetId: _id, ...info } = asset; images[key] = info; }
    return key;
  };

  const lines: string[] = [];
  const sidecarBlockIds: string[] = [];
  const textBlockPos = new Map<string, number>();
  for (const block of chapter.blocks) {
    sidecarBlockIds.push(block.blockId);
    if (block.type === "text") { textBlockPos.set(block.blockId, lines.length); lines.push(block.text); }
  }
  const body = lines.join("\n");
  const paragraphs = imagePackParagraphs(body);
  // Anchor each illustration to the paragraph ending the text seen so far (null = before any text).
  const illustrations: { key: string; after: ParagraphAnchor | null }[] = [];
  {
    let textSeen = 0;
    for (const block of chapter.blocks) {
      if (block.type === "text") { textSeen++; continue; }
      illustrations.push({ key: useAsset(block.assetId), after: textSeen === 0 ? null : paragraphs[textSeen - 1]?.anchor ?? null });
    }
  }

  const coverAssetId = chapter.cover?.assetId ?? null;
  const coverKey = coverAssetId ? useAsset(coverAssetId) : null;
  const bodyTextureAssetId = chapter.layout?.settings.bodyTextureAssetId ?? null;
  const bodyTextureKey = bodyTextureAssetId ? useAsset(bodyTextureAssetId) : null;

  let modules: ModuleDocument | null = null;
  const unplaced: string[] = [];
  if (chapter.layout) {
    const seenParagraphIds = new Map<string, number>();
    let nextParagraph = 0;
    const idFor = (blockId: string) => {
      const pos = textBlockPos.get(blockId);
      if (pos === undefined) return null;
      if (!seenParagraphIds.has(blockId)) seenParagraphIds.set(blockId, nextParagraph++);
      return `paragraph-${seenParagraphIds.get(blockId)}`;
    };
    modules = {
      version: 1,
      ...(chapter.layout.flowVersion ? { flowVersion: chapter.layout.flowVersion } : {}),
      pages: chapter.layout.pages.map(page => ({
        label: page.label,
        modules: page.modules.map((module): ImagePackModule => {
          if (module.kind === "image") {
            return {
              id: module.id, kind: "image", imageUrl: useAsset(module.assetId), rect: module.rect, crop: module.crop,
              ...(module.positioned !== undefined ? { positioned: module.positioned } : {}),
            };
          }
          const text = "blockId" in module.bind ? lines[textBlockPos.get(module.bind.blockId)!] : chapter.title;
          const id = "blockId" in module.bind ? idFor(module.bind.blockId) ?? module.id : "cover-title";
          return {
            id, kind: "text", text, rect: module.rect, fontSize: module.fontSize,
            contentWidth: module.contentWidth, contentHeight: module.contentHeight, alignment: module.alignment,
            ...(module.emphasis !== undefined ? { emphasis: module.emphasis } : {}),
            ...(module.backdrop !== undefined ? { backdrop: module.backdrop } : {}),
            ...(module.positioned !== undefined ? { positioned: module.positioned } : {}),
          };
        }),
      })),
    };
    const parsedModules = moduleDocumentSchema.safeParse(modules);
    if (!parsedModules.success) fail("INVALID_SHAPE", "排版数据无法还原成网页的模块文档");
    for (const [blockId, pos] of textBlockPos)
      if (!seenParagraphIds.has(blockId)) unplaced.push(sidecarBlockIds[pos]);
    if (unplaced.length)
      warnings.push({
        code: "UNPLACED_BLOCKS",
        chapterId: chapter.chapterId,
        message: `排版没有覆盖 ${unplaced.length} 段正文，接收方需要自动补排。`,
      });
  }

  return {
    chapterId: chapter.chapterId,
    title: chapter.title,
    body,
    containsAiText: chapter.containsAiText,
    settings: chapter.layout
      ? { fontId: chapter.layout.settings.fontId, style: chapter.layout.settings.style,
          texture: chapter.layout.settings.texture, textureSeed: chapter.layout.settings.textureSeed }
      : null,
    coverKey,
    bodyTextureKey,
    illustrations,
    modules,
    assetKeys,
    images,
    sidecar: { blockIds: sidecarBlockIds },
    warnings,
  };
}

//__APPEND__
