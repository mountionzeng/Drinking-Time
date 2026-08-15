/**
 * storyAgentPersistence — 故事状态的本地存储层
 *
 * 从 StoryAgentContext「大脑」里拆出来的一块：定义「持久化状态」的形状（PersistedState），
 * 以及如何从 localStorage 读取、清洗、评分、判断「这个故事到底有没有真实进展」。
 * 状态按 projectId 分键存储，刷新后对话还在。一律纯函数 + 直接读 localStorage，不碰 React。
 */
import {
  OPENING_MESSAGE,
  type ChatMessage,
  type StoryCard,
  type GeneratedScript,
  type StoryShot,
  type VisualCanvasItem,
} from "./types";
import { normalizeVisualCanvasItem } from "./storyAgentUtils";
import {
  normalizeImageProviderSelection,
  type ImageProviderSelection,
} from "./storyAgentImageProvider";
import {
  emptyStoryArtDirection,
  normalizeStoryArtDirection,
  type StoryArtDirection,
} from "@shared/artDirection";
import type { GeneratedImageItem } from "@/features/storyAgent/storyTypes";
import { normalizeStoryIntent, type StoryIntent } from "./intentTypes";
import {
  emptyPublishingDraftState,
  computePublishingDraftContentHash,
  isPublishingPlatformId,
  normalizePublishingDraftState,
  publishingDraftBufferKey,
  type PublishingDraftContent,
  type PublishingDraftState,
  type PublishingPlatformId,
  type PublishingVersionOperationReceipt,
} from "@shared/publishingDraft";

export type PublishingDraftBuffer = {
  storyId: number;
  platform: PublishingPlatformId;
  /** Version scope; omitted by legacy localStorage entries, which are V1. */
  versionId?: string;
  content: PublishingDraftContent;
  updatedAt: number;
};

export type PublishingDraftBufferMap = Record<string, PublishingDraftBuffer>;

// 一个故事在 localStorage 里持久化的完整形状。
export interface PersistedState {
  messages: ChatMessage[];
  cards: StoryCard[];
  scripts: GeneratedScript[];
  storyShots: StoryShot[];
  characters: Array<{ name: string; role: string; oneLiner: string }>;
  remoteStoryId?: number;
  title?: string;
  logline?: string;
  theme?: string;
  arc?: string;
  summary?: string;
  visualCanvasItems?: VisualCanvasItem[];
  visualPreference?: string;
  /** 「把这一刻画出来」收下的故事画面（与手机端同一存储位 body.mobileImages）。 */
  mobileImages?: GeneratedImageItem[];
  imageProvider?: ImageProviderSelection;
  artDirection?: StoryArtDirection;
  confirmedIntent?: StoryIntent | null;
  savedAt?: number;
  activeStoryId?: number;
  serverRevision?: number;
  publishing?: PublishingDraftState;
  publishingBuffers?: PublishingDraftBufferMap;
}

// localStorage 的键：每个 projectId 一个槽位；没有 projectId 就返回 null（不存）。
export const storageKey = (projectId: number | null) =>
  projectId ? `dt:storyAgent:${projectId}` : null;

// 全新空状态：只放一条聊聊的开场白，其余清空。
export function emptyState(): PersistedState {
  return {
    messages: [
      {
        id: "first-question",
        role: "assistant",
        content: OPENING_MESSAGE,
        timestamp: Date.now(),
      },
    ],
    cards: [],
    scripts: [],
    storyShots: [],
    characters: [],
    visualCanvasItems: [],
    visualPreference: "",
    mobileImages: [],
    imageProvider: "default",
    artDirection: emptyStoryArtDirection(),
    confirmedIntent: null,
    publishing: emptyPublishingDraftState(),
    publishingBuffers: {},
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeBufferContent(value: unknown): PublishingDraftContent | null {
  const obj = asRecord(value);
  if (!obj) return null;
  return {
    title: typeof obj.title === "string" ? obj.title : "",
    body: typeof obj.body === "string" ? obj.body : "",
    tags: Array.isArray(obj.tags)
      ? Array.from(
          new Set(
            obj.tags
              .filter((tag): tag is string => typeof tag === "string")
              .map(tag => tag.trim())
              .filter(Boolean)
          )
        )
      : [],
  };
}

export function publishingBufferKey(
  storyId: number,
  platform: PublishingPlatformId,
  versionId = "v1"
): string {
  return publishingDraftBufferKey(storyId, platform, versionId);
}

export function normalizePublishingBuffers(
  value: unknown
): PublishingDraftBufferMap {
  const obj = asRecord(value);
  if (!obj) return {};
  const normalized: PublishingDraftBufferMap = {};
  for (const candidate of Object.values(obj)) {
    const buffer = asRecord(candidate);
    if (!buffer) continue;
    if (
      typeof buffer.storyId !== "number" ||
      !Number.isInteger(buffer.storyId) ||
      buffer.storyId === 0 ||
      !isPublishingPlatformId(buffer.platform)
    ) {
      continue;
    }
    const content = normalizeBufferContent(buffer.content);
    if (!content) continue;
    const entry: PublishingDraftBuffer = {
      storyId: buffer.storyId,
      platform: buffer.platform,
      versionId:
        typeof buffer.versionId === "string" && buffer.versionId.trim()
          ? buffer.versionId.trim()
          : "v1",
      content,
      updatedAt:
        typeof buffer.updatedAt === "number" &&
        Number.isFinite(buffer.updatedAt)
          ? buffer.updatedAt
          : 0,
    };
    normalized[
      publishingBufferKey(entry.storyId, entry.platform, entry.versionId)
    ] = entry;
  }
  return normalized;
}

export function setPublishingBuffer(
  buffers: PublishingDraftBufferMap,
  buffer: PublishingDraftBuffer
): PublishingDraftBufferMap {
  if (!isPublishingPlatformId(buffer.platform)) return buffers;
  const content = normalizeBufferContent(buffer.content);
  if (!content) return buffers;
  return {
    ...buffers,
    [publishingBufferKey(buffer.storyId, buffer.platform, buffer.versionId)]: {
      ...buffer,
      versionId: buffer.versionId ?? "v1",
      content,
    },
  };
}

export function getPublishingBuffer(
  buffers: PublishingDraftBufferMap,
  storyId: number,
  platform: PublishingPlatformId,
  versionId = "v1"
): PublishingDraftBuffer | undefined {
  return buffers[publishingBufferKey(storyId, platform, versionId)];
}

export function removePublishingBuffer(
  buffers: PublishingDraftBufferMap,
  storyId: number,
  platform: PublishingPlatformId,
  versionId = "v1"
): PublishingDraftBufferMap {
  const key = publishingBufferKey(storyId, platform, versionId);
  if (!(key in buffers)) return buffers;
  const next = { ...buffers };
  delete next[key];
  return next;
}

export function remapPublishingBuffers(
  buffers: PublishingDraftBufferMap,
  fromStoryId: number,
  toStoryId: number
): PublishingDraftBufferMap {
  let changed = false;
  const next = { ...buffers };
  for (const [key, buffer] of Object.entries(buffers)) {
    if (buffer.storyId !== fromStoryId) continue;
    delete next[key];
    const remapped = { ...buffer, storyId: toStoryId };
    next[publishingBufferKey(toStoryId, buffer.platform, buffer.versionId)] =
      remapped;
    changed = true;
  }
  return changed ? next : buffers;
}

export function publishingBufferContentHash(content: PublishingDraftContent): string {
  return computePublishingDraftContentHash(content);
}

export function reconcilePublishingBufferReceipt(
  buffers: PublishingDraftBufferMap,
  receipt: PublishingVersionOperationReceipt
): { committed: true; conflict?: "receipt_kind" | "buffer_changed" | "buffer_key_mismatch" | "target_buffer_exists"; buffers: PublishingDraftBufferMap } {
  if (receipt.operationKind !== "create_version" || !receipt.sourceVersionId || !receipt.bufferDisposition) {
    return { committed: true, conflict: "receipt_kind", buffers };
  }
  if (receipt.bufferDisposition === "leave") return { committed: true, buffers };
  const expectedKey = publishingBufferKey(receipt.storyId, receipt.platform, receipt.sourceVersionId);
  if (receipt.sourceBufferKey !== expectedKey) return { committed: true, conflict: "buffer_key_mismatch", buffers };
  const source = getPublishingBuffer(
    buffers,
    receipt.storyId,
    receipt.platform,
    receipt.sourceVersionId
  );
  if (!source) return { committed: true, buffers };
  // A receipt only closes the short crash window after its server commit. A
  // later local edit may happen to hash to the same content, but it belongs to
  // the source version and must never be moved by an old receipt on reload.
  if (source.updatedAt > receipt.committedAt) {
    return { committed: true, conflict: "buffer_changed", buffers };
  }
  if (!receipt.sourceBufferHash || publishingBufferContentHash(source.content) !== receipt.sourceBufferHash) {
    return { committed: true, conflict: "buffer_changed", buffers };
  }
  const target = getPublishingBuffer(buffers, receipt.storyId, receipt.platform, receipt.versionId);
  if (target && publishingBufferContentHash(target.content) !== publishingBufferContentHash(source.content)) {
    return { committed: true, conflict: "target_buffer_exists", buffers };
  }
  let next = setPublishingBuffer(buffers, { ...source, versionId: receipt.versionId });
  next = removePublishingBuffer(next, source.storyId, source.platform, receipt.sourceVersionId);
  return { committed: true, buffers: next };
}

/**
 * Replays committed server receipts against local buffers after a reload.
 * A browser can crash after the server commits a carry operation but before
 * React removes the source buffer; applying the receipt is idempotent and
 * keeps that window from duplicating or hiding the draft.
 */
export function reconcilePublishingBuffersFromState(
  buffers: PublishingDraftBufferMap,
  publishing: PublishingDraftState
): PublishingDraftBufferMap {
  let next = buffers;
  for (const receipt of Object.values(publishing.versionOperationReceipts ?? {})) {
    if (!receipt || typeof receipt !== "object") continue;
    next = reconcilePublishingBufferReceipt(
      next,
      receipt as PublishingVersionOperationReceipt
    ).buffers;
  }
  return next;
}

export function persistPublishingBuffersSafely(
  storage: Pick<Storage, "setItem">,
  key: string,
  state: PersistedState,
  next: PublishingDraftBufferMap,
  previous: PublishingDraftBufferMap
): { ok: true; buffers: PublishingDraftBufferMap } | { ok: false; buffers: PublishingDraftBufferMap } {
  try {
    storage.setItem(key, JSON.stringify({ ...state, publishingBuffers: next }));
    return { ok: true, buffers: next };
  } catch {
    return { ok: false, buffers: previous };
  }
}

// 把读回来的「未知形状」清洗成合法 PersistedState（缺字段一律给安全默认值）。
export function normalizePersisted(parsed: PersistedState): PersistedState {
  return {
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    scripts: Array.isArray(parsed.scripts) ? parsed.scripts : [],
    storyShots: Array.isArray(parsed.storyShots) ? parsed.storyShots : [],
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    remoteStoryId:
      typeof parsed.remoteStoryId === "number"
        ? parsed.remoteStoryId
        : undefined,
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    logline: typeof parsed.logline === "string" ? parsed.logline : undefined,
    theme: typeof parsed.theme === "string" ? parsed.theme : undefined,
    arc: typeof parsed.arc === "string" ? parsed.arc : undefined,
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    visualCanvasItems: Array.isArray(parsed.visualCanvasItems)
      ? parsed.visualCanvasItems
          .map(normalizeVisualCanvasItem)
          .filter((item): item is VisualCanvasItem => Boolean(item))
      : [],
    visualPreference:
      typeof parsed.visualPreference === "string"
        ? parsed.visualPreference
        : "",
    mobileImages: Array.isArray(parsed.mobileImages) ? parsed.mobileImages : [],
    imageProvider: normalizeImageProviderSelection(parsed.imageProvider),
    artDirection: normalizeStoryArtDirection(parsed.artDirection),
    confirmedIntent: normalizeStoryIntent(parsed.confirmedIntent),
    savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : undefined,
    activeStoryId:
      typeof parsed.activeStoryId === "number"
        ? parsed.activeStoryId
        : undefined,
    serverRevision:
      typeof parsed.serverRevision === "number" ? parsed.serverRevision : 0,
    publishing: normalizePublishingDraftState(parsed.publishing),
    publishingBuffers: normalizePublishingBuffers(parsed.publishingBuffers),
  };
}

// 按 projectId 从 localStorage 读出并清洗；读不到 / 解析失败都安全回退空状态。
export function loadState(projectId: number | null): PersistedState {
  const key = storageKey(projectId);
  if (!key) return emptyState();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyState();
    return normalizePersisted(JSON.parse(raw) as PersistedState);
  } catch {
    return emptyState();
  }
}

// 「工作量」打分：卡片 / 镜头 / 剧本 / 对话 / 画布各有权重，用来比较哪个故事更「实」。
export function storyWorkScore(state: PersistedState): number {
  return (
    state.cards.length * 100 +
    state.storyShots.length * 80 +
    state.scripts.length * 60 +
    Math.max(0, state.messages.length - 1) * 20 +
    (state.visualCanvasItems?.length ?? 0) * 40 +
    (state.artDirection?.candidates.length ?? 0) * 25 +
    (state.artDirection?.recipe ? 80 : 0) +
    (state.publishing?.core ? 80 : 0) +
    Object.keys(state.publishing?.drafts ?? {}).length * 60 +
    Object.keys(state.publishingBuffers ?? {}).length * 30
  );
}

// 有没有任何工作量（score > 0）。
export function hasStoryWork(state: PersistedState): boolean {
  return storyWorkScore(state) > 0;
}

// 推断「当前活跃故事 id」：优先显式 id，其次远端 id；否则有工作量给 -1（本地草稿），没有给 null。
export function activeStoryIdFrom(state: PersistedState): number | null {
  if (typeof state.activeStoryId === "number") return state.activeStoryId;
  if (typeof state.remoteStoryId === "number") return state.remoteStoryId;
  return hasStoryWork(state) ? -1 : null;
}

// 「这个故事是不是有真实进展」：有卡 / 剧本 / 镜头 / 画布，或用户发过非空消息、或发过带照片的消息。
export function hasLiveStoryWork(state: {
  messages: ChatMessage[];
  cards: StoryCard[];
  scripts: GeneratedScript[];
  storyShots: StoryShot[];
  visualCanvasItems?: VisualCanvasItem[];
  publishing?: PublishingDraftState;
  publishingBuffers?: PublishingDraftBufferMap;
}): boolean {
  return (
    state.cards.length > 0 ||
    state.scripts.length > 0 ||
    state.storyShots.length > 0 ||
    (state.visualCanvasItems?.length ?? 0) > 0 ||
    Boolean(state.publishing?.core) ||
    Object.keys(state.publishing?.drafts ?? {}).length > 0 ||
    Object.keys(state.publishingBuffers ?? {}).length > 0 ||
    state.messages.some(
      message =>
        message.role === "user" &&
        (message.content.trim().length > 0 || Boolean(message.photoUrl))
    )
  );
}

// projectId 会在本地 / 部署间漂移。当前槽位空时，从旧 projectId 的槽位里捞出「最实」的那个故事，
// 避免用户的工作看起来凭空消失。只读不删，源槽位保持不动。
export function findOrphanStory(
  currentProjectId: number
): PersistedState | null {
  const currentKey = storageKey(currentProjectId);
  let best: { state: PersistedState; score: number; savedAt: number } | null =
    null;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("dt:storyAgent:") || key === currentKey)
      continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = normalizePersisted(JSON.parse(raw) as PersistedState);
      const score = storyWorkScore(parsed);
      if (score === 0) continue;
      const savedAt = parsed.savedAt ?? 0;
      const better =
        !best ||
        savedAt > best.savedAt ||
        (savedAt === best.savedAt && score > best.score);
      if (better) best = { state: parsed, score, savedAt };
    } catch {
      // skip unparseable entries
    }
  }
  return best?.state ?? null;
}
