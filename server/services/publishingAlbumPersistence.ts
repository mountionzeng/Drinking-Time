import { createHash } from "node:crypto";

import { canonicalJsonStringify } from "../../shared/canonicalJson";
import {
  PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS,
  PUBLISHING_ALBUM_MAX_PAGES,
  publishingAlbumCodePointCount,
  type PublishingAlbumAggregate,
  type PublishingAlbumPage,
  type PublishingAlbumTypographyLayout,
} from "../../shared/publishingAlbum";
import type { PublishingDraftContent, PublishingPlatformId } from "../../shared/publishingDraft";
import {
  getPublishingDraftState,
  writePublishingDraftState,
  type PublishingDraftPersistenceResult,
} from "./publishingPersistence";

export class PublishingAlbumCapacityError extends Error {
  constructor(public readonly codePoints: number) {
    super(
      `这份文字超过静态画册最多 ${PUBLISHING_ALBUM_MAX_PAGES} 页的可读容量，请先精简正文再生成底图`
    );
    this.name = "PublishingAlbumCapacityError";
  }
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJsonStringify(value))
    .digest("hex");
}

function normalizedBody(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\t ]+$/gm, "").trim();
}

type AlbumTextBlock = { paragraphId: string; text: string };

function sourceBlocks(content: PublishingDraftContent): AlbumTextBlock[] {
  const body = normalizedBody(content.body);
  const raw = (body || content.title.trim() || "写下这一页想说的话")
    .split(/\n[\t ]*\n+/)
    .map(value => value.trim())
    .filter(Boolean);
  return raw.map((text, index) => ({
    paragraphId: `album-paragraph-${String(index + 1).padStart(3, "0")}-${hash(text).slice(0, 10)}`,
    text,
  }));
}

function splitBlock(block: AlbumTextBlock): AlbumTextBlock[] {
  const codePoints = Array.from(block.text);
  if (codePoints.length <= PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS) return [block];
  const chunks: AlbumTextBlock[] = [];
  for (let start = 0; start < codePoints.length; start += PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS) {
    chunks.push({
      paragraphId: `${block.paragraphId}-part-${chunks.length + 1}`,
      text: codePoints.slice(start, start + PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS).join(""),
    });
  }
  return chunks;
}

export function buildPublishingAlbumDraft(input: {
  versionId: string;
  platform: PublishingPlatformId;
  draftRevision: number;
  content: PublishingDraftContent;
  now?: number;
}): PublishingAlbumAggregate {
  const now = input.now ?? Date.now();
  const capacity = PUBLISHING_ALBUM_MAX_PAGES * PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS;
  const blocks = sourceBlocks(input.content).flatMap(splitBlock);
  const totalCodePoints = blocks.reduce(
    (total, block) => total + publishingAlbumCodePointCount(block.text),
    0
  );
  if (totalCodePoints > capacity) throw new PublishingAlbumCapacityError(totalCodePoints);

  const pages: PublishingAlbumPage[] = [];
  for (const block of blocks) {
    const current = pages.at(-1);
    const separator = current?.text ? "\n\n" : "";
    const mergedText = current ? `${current.text}${separator}${block.text}` : block.text;
    if (
      current &&
      publishingAlbumCodePointCount(mergedText) <= PUBLISHING_ALBUM_LAYOUT_PAGE_CODE_POINTS
    ) {
      current.text = mergedText;
      current.sourceParagraphIds.push(block.paragraphId);
      current.sourceTextHash = hash(current.text);
      continue;
    }
    const ordinal = pages.length + 1;
    const pageTextHash = hash(block.text);
    pages.push({
      pageId: `album-${input.versionId}-${String(ordinal).padStart(2, "0")}-${pageTextHash.slice(0, 10)}`,
      ordinal,
      revision: 0,
      textRevision: 0,
      backgroundRevision: 0,
      typographyRevision: 0,
      sourceParagraphIds: [block.paragraphId],
      sourceTextHash: pageTextHash,
      sourceStale: false,
      text: block.text,
      adoptedBackgroundAssetId: null,
      backgroundRounds: [],
      backgroundGeneration: null,
      typography: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (pages.length > PUBLISHING_ALBUM_MAX_PAGES) {
    throw new PublishingAlbumCapacityError(totalCodePoints);
  }
  return {
    version: 1,
    revision: 0,
    status: "draft",
    source: {
      platform: input.platform,
      draftRevision: input.draftRevision,
      contentHash: hash(input.content),
      createdAt: now,
    },
    pages,
    operationReceipts: {},
    createdAt: now,
    updatedAt: now,
  };
}

export async function initializePublishingAlbum(input: {
  storyId: number;
  userId: number;
  versionId: string;
  platform?: PublishingPlatformId;
  baseContainerRevision: number;
  baseVersionRevision: number;
  operationToken: string;
  now?: number;
}): Promise<PublishingDraftPersistenceResult> {
  const current = await getPublishingDraftState(input.storyId, input.userId);
  const version = current.publishing.versions?.find(candidate => candidate.versionId === input.versionId);
  if (!version) throw new Error("发布版本不存在或已经切换");
  const platform = input.platform ?? version.activePlatform;
  const draft = version.drafts[platform];
  if (!draft) throw new Error("当前平台还没有可制作画册的文字稿");
  const album = buildPublishingAlbumDraft({
    versionId: version.versionId,
    platform,
    draftRevision: draft.revision,
    content: draft.content,
    now: input.now,
  });
  return writePublishingDraftState({
    storyId: input.storyId,
    userId: input.userId,
    operationToken: input.operationToken,
    now: input.now,
    operation: {
      type: "initialize_album",
      versionId: version.versionId,
      album,
      requestHash: hash({ kind: "initialize", versionId: version.versionId, source: album.source }),
      baseContainerRevision: input.baseContainerRevision,
      baseVersionRevision: input.baseVersionRevision,
    },
  });
}

export async function updatePublishingAlbumPageText(input: {
  storyId: number;
  userId: number;
  versionId: string;
  pageId: string;
  text: string;
  baseTextRevision: number;
  operationToken: string;
  now?: number;
}): Promise<PublishingDraftPersistenceResult> {
  return writePublishingDraftState({
    storyId: input.storyId,
    userId: input.userId,
    operationToken: input.operationToken,
    now: input.now,
    operation: {
      type: "update_album_page_text",
      versionId: input.versionId,
      pageId: input.pageId,
      text: input.text,
      baseTextRevision: input.baseTextRevision,
      requestHash: hash({
        kind: "update_text",
        versionId: input.versionId,
        pageId: input.pageId,
        text: input.text,
        baseTextRevision: input.baseTextRevision,
      }),
    },
  });
}

export async function updatePublishingAlbumPageTypography(input: {
  storyId: number;
  userId: number;
  versionId: string;
  pageId: string;
  typography: PublishingAlbumTypographyLayout;
  baseTextRevision: number;
  baseTypographyRevision: number;
  operationToken: string;
  now?: number;
}): Promise<PublishingDraftPersistenceResult> {
  return writePublishingDraftState({
    storyId: input.storyId,
    userId: input.userId,
    operationToken: input.operationToken,
    now: input.now,
    operation: {
      type: "update_album_page_typography",
      versionId: input.versionId,
      pageId: input.pageId,
      typography: input.typography,
      baseTextRevision: input.baseTextRevision,
      baseTypographyRevision: input.baseTypographyRevision,
      requestHash: hash({
        kind: "update_typography",
        versionId: input.versionId,
        pageId: input.pageId,
        typography: input.typography,
        baseTextRevision: input.baseTextRevision,
        baseTypographyRevision: input.baseTypographyRevision,
      }),
    },
  });
}
