import type { PublishingCoverArtReference, PublishingPlatformId } from "./publishingDraft";

export const PUBLISHING_ALBUM_VERSION = 1 as const;
export const PUBLISHING_ALBUM_LAYOUT_VERSION = 1 as const;
export const PUBLISHING_ALBUM_MAX_PAGES = 9;
export const PUBLISHING_ALBUM_MAX_PAGE_CODE_POINTS = 2_000;
export const PUBLISHING_ALBUM_MAX_POINTS = 256;
export const PUBLISHING_ALBUM_MAX_ROUNDS_PER_PAGE = 20;
export const PUBLISHING_ALBUM_MAX_CANDIDATES_PER_ROUND = 4;
export const PUBLISHING_ALBUM_MAX_FEEDBACK_LENGTH = 2_000;
export const PUBLISHING_ALBUM_MAX_AGGREGATE_BYTES = 1_000_000;

export type PublishingAlbumPoint = { x: number; y: number };

export type PublishingAlbumContrastStyle = {
  textColor: string;
  outlineColor: string | null;
  outlineWidth: number;
  backdropColor: string | null;
};

type PublishingAlbumTypographyBase = {
  layoutVersion: typeof PUBLISHING_ALBUM_LAYOUT_VERSION;
  fontId: string;
  alignment: "start" | "center" | "end";
  fontSize: number;
  letterSpacing: number;
  lineSpacing: number;
  contrast: PublishingAlbumContrastStyle;
};

export type PublishingAlbumRegionLayout = PublishingAlbumTypographyBase & {
  kind: "region";
  shape: "rectangle" | "ellipse";
  direction: "horizontal" | "vertical";
  region: { x: number; y: number; width: number; height: number };
};

export type PublishingAlbumPathLayout = PublishingAlbumTypographyBase & {
  kind: "path";
  points: PublishingAlbumPoint[];
};

export type PublishingAlbumTypographyLayout =
  | PublishingAlbumRegionLayout
  | PublishingAlbumPathLayout;

export type PublishingAlbumBackgroundRound = {
  roundId: string;
  requestHash: string;
  sourcePageRevision: number;
  sourceCoverAssetId: number;
  feedback: string;
  assetIds: number[];
  qualityFlaggedAssetIds: number[];
  qualityCheckUnavailable: boolean;
  stale: boolean;
  createdAt: number;
};

export type PublishingAlbumBackgroundGeneration = {
  operationToken: string;
  requestHash: string;
  versionId: string;
  pageId: string;
  status: "pending" | "completed" | "failed" | "unknown";
  provider: "midjourney" | "gpt-image" | "flux-schnell";
  taskId: string | null;
  inputSnapshot: {
    pageTextHash: string;
    pageRevision: number;
    coverAssetId: number;
    coverSourceCoreRevision: number;
    artDirectionHash: string;
    artReference: PublishingCoverArtReference | null;
    promptCompilerVersion: number;
    prompt: string;
    aspectRatio: string;
  };
  feedback: string;
  claimedAt: number;
  updatedAt: number;
  expiresAt: number;
  error?: string;
};

export type PublishingAlbumPage = {
  pageId: string;
  ordinal: number;
  revision: number;
  textRevision: number;
  backgroundRevision: number;
  typographyRevision: number;
  sourceParagraphIds: string[];
  sourceTextHash: string;
  sourceStale: boolean;
  text: string;
  adoptedBackgroundAssetId: number | null;
  backgroundRounds: PublishingAlbumBackgroundRound[];
  backgroundGeneration: PublishingAlbumBackgroundGeneration | null;
  typography: PublishingAlbumTypographyLayout | null;
  createdAt: number;
  updatedAt: number;
};

export type PublishingAlbumAggregate = {
  version: typeof PUBLISHING_ALBUM_VERSION;
  revision: number;
  status: "draft" | "ready";
  source: {
    platform: PublishingPlatformId;
    draftRevision: number;
    contentHash: string;
    createdAt: number;
  };
  pages: PublishingAlbumPage[];
  createdAt: number;
  updatedAt: number;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finiteInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function timestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function normalizedCoordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function normalizePoint(value: unknown): PublishingAlbumPoint | null {
  const obj = record(value);
  const x = normalizedCoordinate(obj?.x);
  const y = normalizedCoordinate(obj?.y);
  return x == null || y == null ? null : { x, y };
}

function normalizeColor(value: unknown, fallback: string): string {
  const color = cleanString(value, 32);
  return /^(?:#[0-9a-f]{3,8}|rgba?\([^)]{1,28}\))$/i.test(color)
    ? color
    : fallback;
}

function normalizeContrast(value: unknown): PublishingAlbumContrastStyle {
  const obj = record(value);
  const outlineWidth = typeof obj?.outlineWidth === "number" && Number.isFinite(obj.outlineWidth)
    ? Math.min(8, Math.max(0, obj.outlineWidth))
    : 0;
  return {
    textColor: normalizeColor(obj?.textColor, "#ffffff"),
    outlineColor: obj?.outlineColor == null
      ? null
      : normalizeColor(obj.outlineColor, "#000000"),
    outlineWidth,
    backdropColor: obj?.backdropColor == null
      ? null
      : normalizeColor(obj.backdropColor, "rgba(0,0,0,0.35)"),
  };
}

function normalizeTypography(value: unknown): PublishingAlbumTypographyLayout | null {
  const obj = record(value);
  if (!obj || (obj.kind !== "region" && obj.kind !== "path")) return null;
  const fontId = cleanString(obj.fontId, 80);
  if (!fontId) return null;
  const base: PublishingAlbumTypographyBase = {
    layoutVersion: PUBLISHING_ALBUM_LAYOUT_VERSION,
    fontId,
    alignment: obj.alignment === "start" || obj.alignment === "end"
      ? obj.alignment
      : "center",
    fontSize: typeof obj.fontSize === "number" && Number.isFinite(obj.fontSize)
      ? Math.min(240, Math.max(8, obj.fontSize))
      : 32,
    letterSpacing:
      typeof obj.letterSpacing === "number" && Number.isFinite(obj.letterSpacing)
        ? Math.min(20, Math.max(-5, obj.letterSpacing))
        : 0,
    lineSpacing:
      typeof obj.lineSpacing === "number" && Number.isFinite(obj.lineSpacing)
        ? Math.min(3, Math.max(0.8, obj.lineSpacing))
        : 1.25,
    contrast: normalizeContrast(obj.contrast),
  };
  if (obj.kind === "path") {
    if (!Array.isArray(obj.points) || obj.points.length < 2 || obj.points.length > PUBLISHING_ALBUM_MAX_POINTS) {
      return null;
    }
    const points = obj.points.map(normalizePoint);
    return points.some(point => point == null)
      ? null
      : { ...base, kind: "path", points: points as PublishingAlbumPoint[] };
  }
  const region = record(obj.region);
  const x = normalizedCoordinate(region?.x);
  const y = normalizedCoordinate(region?.y);
  const width = normalizedCoordinate(region?.width);
  const height = normalizedCoordinate(region?.height);
  if (
    x == null || y == null || width == null || height == null ||
    width <= 0 || height <= 0 || x + width > 1 || y + height > 1
  ) {
    return null;
  }
  return {
    ...base,
    kind: "region",
    shape: obj.shape === "ellipse" ? "ellipse" : "rectangle",
    direction: obj.direction === "vertical" ? "vertical" : "horizontal",
    region: { x, y, width, height },
  };
}

function normalizeArtReference(value: unknown): PublishingCoverArtReference | null {
  const obj = record(value);
  if (!obj) return null;
  const list = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.flatMap(item => {
        const text = cleanString(item, 160);
        return text ? [text] : [];
      }).slice(0, 20)
    : [];
  return {
    label: cleanString(obj.label, 160),
    ...(cleanString(obj.imageUrl, 2_000) ? { imageUrl: cleanString(obj.imageUrl, 2_000) } : {}),
    style: list(obj.style),
    palette: list(obj.palette),
    light: list(obj.light),
    composition: list(obj.composition),
    material: list(obj.material),
    mood: list(obj.mood),
  };
}

function normalizeGeneration(value: unknown, pageId: string, now: number): PublishingAlbumBackgroundGeneration | null {
  const obj = record(value);
  const snapshot = record(obj?.inputSnapshot);
  const operationToken = cleanString(obj?.operationToken, 200);
  const requestHash = cleanString(obj?.requestHash, 160);
  const versionId = cleanString(obj?.versionId, 64);
  const taskPageId = cleanString(obj?.pageId, 120);
  const prompt = cleanString(snapshot?.prompt, 12_000);
  const coverAssetId = positiveInteger(snapshot?.coverAssetId);
  if (
    !obj || !snapshot || !operationToken || !requestHash || !versionId ||
    taskPageId !== pageId || !prompt || coverAssetId == null ||
    !["pending", "completed", "failed", "unknown"].includes(String(obj.status))
  ) {
    return null;
  }
  return {
    operationToken,
    requestHash,
    versionId,
    pageId,
    status: obj.status as PublishingAlbumBackgroundGeneration["status"],
    provider: obj.provider === "gpt-image" || obj.provider === "flux-schnell"
      ? obj.provider
      : "midjourney",
    taskId: cleanString(obj.taskId, 500) || null,
    inputSnapshot: {
      pageTextHash: cleanString(snapshot.pageTextHash, 160),
      pageRevision: finiteInteger(snapshot.pageRevision),
      coverAssetId,
      coverSourceCoreRevision: finiteInteger(snapshot.coverSourceCoreRevision),
      artDirectionHash: cleanString(snapshot.artDirectionHash, 160),
      artReference: normalizeArtReference(snapshot.artReference),
      promptCompilerVersion: finiteInteger(snapshot.promptCompilerVersion, 1),
      prompt,
      aspectRatio: cleanString(snapshot.aspectRatio, 40),
    },
    feedback: cleanString(obj.feedback, PUBLISHING_ALBUM_MAX_FEEDBACK_LENGTH),
    claimedAt: timestamp(obj.claimedAt, now),
    updatedAt: timestamp(obj.updatedAt, now),
    expiresAt: timestamp(obj.expiresAt, now),
    ...(cleanString(obj.error, 2_000) ? { error: cleanString(obj.error, 2_000) } : {}),
  };
}

function normalizeRound(value: unknown, now: number): PublishingAlbumBackgroundRound | null {
  const obj = record(value);
  const roundId = cleanString(obj?.roundId, 160);
  const requestHash = cleanString(obj?.requestHash, 160);
  const sourceCoverAssetId = positiveInteger(obj?.sourceCoverAssetId);
  if (!obj || !roundId || !requestHash || sourceCoverAssetId == null || !Array.isArray(obj.assetIds)) {
    return null;
  }
  const assetIds = obj.assetIds.map(positiveInteger);
  if (
    assetIds.length < 1 || assetIds.length > PUBLISHING_ALBUM_MAX_CANDIDATES_PER_ROUND ||
    assetIds.some(assetId => assetId == null) || new Set(assetIds).size !== assetIds.length
  ) {
    return null;
  }
  const ids = assetIds as number[];
  const flagged = Array.isArray(obj.qualityFlaggedAssetIds)
    ? Array.from(new Set(obj.qualityFlaggedAssetIds.map(positiveInteger).filter(
        (assetId): assetId is number => assetId != null && ids.includes(assetId)
      )))
    : [];
  return {
    roundId,
    requestHash,
    sourcePageRevision: finiteInteger(obj.sourcePageRevision),
    sourceCoverAssetId,
    feedback: cleanString(obj.feedback, PUBLISHING_ALBUM_MAX_FEEDBACK_LENGTH),
    assetIds: ids,
    qualityFlaggedAssetIds: flagged,
    qualityCheckUnavailable: obj.qualityCheckUnavailable === true,
    stale: obj.stale === true,
    createdAt: timestamp(obj.createdAt, now),
  };
}

function normalizePage(value: unknown, index: number, now: number): PublishingAlbumPage | null {
  const obj = record(value);
  const pageId = cleanString(obj?.pageId, 120);
  const text = typeof obj?.text === "string" ? obj.text : "";
  if (!obj || !pageId || codePointCount(text) > PUBLISHING_ALBUM_MAX_PAGE_CODE_POINTS) return null;
  const rounds = Array.isArray(obj.backgroundRounds)
    ? obj.backgroundRounds.slice(0, PUBLISHING_ALBUM_MAX_ROUNDS_PER_PAGE)
        .map(round => normalizeRound(round, now))
        .filter((round): round is PublishingAlbumBackgroundRound => round != null)
    : [];
  const adoptedBackgroundAssetId = positiveInteger(obj.adoptedBackgroundAssetId);
  if (adoptedBackgroundAssetId != null && !rounds.some(round => round.assetIds.includes(adoptedBackgroundAssetId))) {
    return null;
  }
  return {
    pageId,
    ordinal: Math.max(1, finiteInteger(obj.ordinal, index + 1)),
    revision: finiteInteger(obj.revision),
    textRevision: finiteInteger(obj.textRevision),
    backgroundRevision: finiteInteger(obj.backgroundRevision),
    typographyRevision: finiteInteger(obj.typographyRevision),
    sourceParagraphIds: Array.isArray(obj.sourceParagraphIds)
      ? Array.from(new Set(obj.sourceParagraphIds.flatMap(item => {
          const id = cleanString(item, 160);
          return id ? [id] : [];
        }))).slice(0, 100)
      : [],
    sourceTextHash: cleanString(obj.sourceTextHash, 160),
    sourceStale: obj.sourceStale === true,
    text,
    adoptedBackgroundAssetId,
    backgroundRounds: rounds,
    backgroundGeneration: normalizeGeneration(obj.backgroundGeneration, pageId, now),
    typography: normalizeTypography(obj.typography),
    createdAt: timestamp(obj.createdAt, now),
    updatedAt: timestamp(obj.updatedAt, now),
  };
}

export function normalizePublishingAlbumAggregate(
  value: unknown,
  now = Date.now()
): PublishingAlbumAggregate | null {
  const obj = record(value);
  const source = record(obj?.source);
  if (!obj || !source || !Array.isArray(obj.pages)) return null;
  const platform = source.platform;
  if (![
    "xiaohongshu", "x", "instagram", "linkedin", "wechat_moments", "douyin_tiktok",
  ].includes(String(platform))) return null;
  if (obj.pages.length < 1 || obj.pages.length > PUBLISHING_ALBUM_MAX_PAGES) return null;
  const pages = obj.pages.map((page, index) => normalizePage(page, index, now));
  if (pages.some(page => page == null)) return null;
  const normalizedPages = pages as PublishingAlbumPage[];
  if (new Set(normalizedPages.map(page => page.pageId)).size !== normalizedPages.length) return null;
  const aggregate: PublishingAlbumAggregate = {
    version: PUBLISHING_ALBUM_VERSION,
    revision: finiteInteger(obj.revision),
    status: normalizedPages.every(page =>
      page.adoptedBackgroundAssetId != null && page.typography != null
    ) ? "ready" : "draft",
    source: {
      platform: platform as PublishingPlatformId,
      draftRevision: finiteInteger(source.draftRevision),
      contentHash: cleanString(source.contentHash, 160),
      createdAt: timestamp(source.createdAt, now),
    },
    pages: normalizedPages.sort((left, right) => left.ordinal - right.ordinal),
    createdAt: timestamp(obj.createdAt, now),
    updatedAt: timestamp(obj.updatedAt, now),
  };
  if (new TextEncoder().encode(JSON.stringify(aggregate)).byteLength > PUBLISHING_ALBUM_MAX_AGGREGATE_BYTES) {
    return null;
  }
  return aggregate;
}

export function publishingAlbumIsReady(album: PublishingAlbumAggregate): boolean {
  return album.pages.length > 0 && album.pages.every(page =>
    page.adoptedBackgroundAssetId != null && page.typography != null
  );
}

export function publishingAlbumCodePointCount(value: string): number {
  return codePointCount(value);
}
