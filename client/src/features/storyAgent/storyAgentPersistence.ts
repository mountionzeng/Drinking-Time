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
} from './types';
import { normalizeVisualCanvasItem } from './storyAgentUtils';
import {
  normalizeImageProviderSelection,
  type ImageProviderSelection,
} from './storyAgentImageProvider';
import {
  emptyStoryArtDirection,
  normalizeStoryArtDirection,
  type StoryArtDirection,
} from '@shared/artDirection';
import type { GeneratedImageItem } from '@/features/mobileChat/types';

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
  savedAt?: number;
  activeStoryId?: number;
  serverRevision?: number;
}

// localStorage 的键：每个 projectId 一个槽位；没有 projectId 就返回 null（不存）。
export const storageKey = (projectId: number | null) =>
  projectId ? `dt:storyAgent:${projectId}` : null;

// 全新空状态：只放一条小酌的开场白，其余清空。
export function emptyState(): PersistedState {
  return {
    messages: [
      {
        id: 'first-question',
        role: 'assistant',
        content: OPENING_MESSAGE,
        timestamp: Date.now(),
      },
    ],
    cards: [],
    scripts: [],
    storyShots: [],
    characters: [],
    visualCanvasItems: [],
    visualPreference: '',
    mobileImages: [],
    imageProvider: 'default',
    artDirection: emptyStoryArtDirection(),
  };
}

// 把读回来的「未知形状」清洗成合法 PersistedState（缺字段一律给安全默认值）。
export function normalizePersisted(parsed: PersistedState): PersistedState {
  return {
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    scripts: Array.isArray(parsed.scripts) ? parsed.scripts : [],
    storyShots: Array.isArray(parsed.storyShots) ? parsed.storyShots : [],
    characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    remoteStoryId: typeof parsed.remoteStoryId === 'number' ? parsed.remoteStoryId : undefined,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    logline: typeof parsed.logline === 'string' ? parsed.logline : undefined,
    theme: typeof parsed.theme === 'string' ? parsed.theme : undefined,
    arc: typeof parsed.arc === 'string' ? parsed.arc : undefined,
    summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    visualCanvasItems: Array.isArray(parsed.visualCanvasItems)
      ? parsed.visualCanvasItems.map(normalizeVisualCanvasItem).filter((item): item is VisualCanvasItem => Boolean(item))
      : [],
    visualPreference: typeof parsed.visualPreference === 'string' ? parsed.visualPreference : '',
    mobileImages: Array.isArray(parsed.mobileImages) ? parsed.mobileImages : [],
    imageProvider: normalizeImageProviderSelection(parsed.imageProvider),
    artDirection: normalizeStoryArtDirection(parsed.artDirection),
    savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : undefined,
    activeStoryId: typeof parsed.activeStoryId === 'number' ? parsed.activeStoryId : undefined,
    serverRevision:
      typeof parsed.serverRevision === 'number' ? parsed.serverRevision : 0,
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
    (state.artDirection?.recipe ? 80 : 0)
  );
}

// 有没有任何工作量（score > 0）。
export function hasStoryWork(state: PersistedState): boolean {
  return storyWorkScore(state) > 0;
}

// 推断「当前活跃故事 id」：优先显式 id，其次远端 id；否则有工作量给 -1（本地草稿），没有给 null。
export function activeStoryIdFrom(state: PersistedState): number | null {
  if (typeof state.activeStoryId === 'number') return state.activeStoryId;
  if (typeof state.remoteStoryId === 'number') return state.remoteStoryId;
  return hasStoryWork(state) ? -1 : null;
}

// 「这个故事是不是有真实进展」：有卡 / 剧本 / 镜头 / 画布，或用户发过非空消息、或发过带照片的消息。
export function hasLiveStoryWork(state: {
  messages: ChatMessage[];
  cards: StoryCard[];
  scripts: GeneratedScript[];
  storyShots: StoryShot[];
  visualCanvasItems?: VisualCanvasItem[];
}): boolean {
  return (
    state.cards.length > 0 ||
    state.scripts.length > 0 ||
    state.storyShots.length > 0 ||
    (state.visualCanvasItems?.length ?? 0) > 0 ||
    state.messages.some(
      (message) =>
        message.role === 'user' &&
        (message.content.trim().length > 0 || Boolean(message.photoUrl)),
    )
  );
}

// projectId 会在本地 / 部署间漂移。当前槽位空时，从旧 projectId 的槽位里捞出「最实」的那个故事，
// 避免用户的工作看起来凭空消失。只读不删，源槽位保持不动。
export function findOrphanStory(currentProjectId: number): PersistedState | null {
  const currentKey = storageKey(currentProjectId);
  let best: { state: PersistedState; score: number; savedAt: number } | null = null;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('dt:storyAgent:') || key === currentKey) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = normalizePersisted(JSON.parse(raw) as PersistedState);
      const score = storyWorkScore(parsed);
      if (score === 0) continue;
      const savedAt = parsed.savedAt ?? 0;
      const better =
        !best || savedAt > best.savedAt || (savedAt === best.savedAt && score > best.score);
      if (better) best = { state: parsed, score, savedAt };
    } catch {
      // skip unparseable entries
    }
  }
  return best?.state ?? null;
}
