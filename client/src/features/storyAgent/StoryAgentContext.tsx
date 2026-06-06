/**
 * StoryAgentContext — shared store for chat messages, cards, and generated scripts
 *
 * State is keyed by projectId and persisted to localStorage so reloads keep
 * the conversation in place.
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { normalizeImageProvider, type ImageProvider } from '@shared/imageProvider';
import { trpc } from '@/lib/trpc';
import {
  OPENING_MESSAGE,
  buildReturningGreeting,
  type ChatMessage,
  type StoryCard,
  type GeneratedScript,
  type StoryShot,
  type SelectionState,
  type VisualCanvasItem,
} from './types';
import { buildPromptPool } from './promptPool';
// 拆「大脑」：以下纯函数已搬到独立文件，这里改为引入（逻辑完全不变）。
import { getSimilarCards } from './storyCardSimilarity';
import { newId, cardTitle, normalizeVisualCanvasItem, fileToBase64 } from './storyAgentUtils';

interface PersistedState {
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
  imageProvider?: ImageProviderSelection;
  savedAt?: number;
  activeStoryId?: number;
}

type StorySaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ImageProviderSelection = 'default' | ImageProvider;

export type StoryListItem = {
  id: number;
  title: string;
  logline?: string | null;
  updatedAt?: string | Date | null;
  cardCount?: number;
  shotCount?: number;
};

interface StoryAgentContextValue {
  messages: ChatMessage[];
  cards: StoryCard[];
  scripts: GeneratedScript[];
  storyShots: StoryShot[];
  characters: Array<{ name: string; role: string; oneLiner: string }>;
  /** Latest script (last item in `scripts`), null if none yet. */
  latestScript: GeneratedScript | null;
  isReplying: boolean;
  isGeneratingScript: boolean;
  sendMessage: (text: string, photoBase64?: string, photoMimeType?: string) => Promise<void>;
  reorderCards: (newOrder: StoryCard[]) => void;
  removeCard: (id: string) => void;
  /** Inline-edit a single card's content; persists locally + to the server. */
  updateCardContent: (id: string, content: string) => void;
  /** Inline-edit the latest script's title / logline / arc; persists. */
  updateScriptMeta: (field: 'title' | 'logline' | 'arcSummary', value: string) => void;
  /** Inline-edit one scene of the latest script; persists. */
  updateScriptScene: (sceneIndex: number, field: 'visual' | 'emotion', value: string) => void;
  /** Inline-edit a single shot's script field (subject/action/dialogue); persists. */
  updateStoryShotField: (
    index: number,
    field: 'subject' | 'action' | 'dialogue',
    value: string,
  ) => void;
  generateScript: () => Promise<void>;
  resetConversation: () => void;
  /** Story list management */
  activeStoryId: number | null;
  remoteStoryId?: number;
  saveStatus: StorySaveStatus;
  lastSavedAt?: number;
  storyList: StoryListItem[];
  isLoadingStories: boolean;
  loadStory: (id: number) => Promise<void>;
  createNewStory: () => void;
  backToList: () => void;
  deleteStory: (id: number) => Promise<void>;
  refreshStoryList: () => void;
  /**
   * 老用户点回旧故事时，小酌的「我还记得上次……」再问候（第二步：召回 + 记忆承诺）。
   * 仅活在内存里：永不进 messages、永不落库，所以反复点回不会堆叠、也不会污染历史。
   * 用户一旦再开口 / 返回列表 / 开新故事就清空。
   */
  returningGreeting: string | null;
  /** Visual anchor canvas / Art Agent */
  visualCanvasItems: VisualCanvasItem[];
  visualPreference: string;
  imageProvider: ImageProviderSelection;
  setImageProvider: (provider: ImageProviderSelection) => void;
  isArtWorking: boolean;
  addVisualReference: (file: File, instruction?: string, cardId?: string) => Promise<void>;
  refineVisualItem: (id: string, instruction: string) => Promise<void>;
  updateVisualCanvasItem: (id: string, patch: Partial<Pick<VisualCanvasItem, 'x' | 'y' | 'width' | 'height' | 'title'>>) => void;
  removeVisualCanvasItem: (id: string) => void;
  /** Inline selection edit */
  activeSelection: SelectionState | null;
  setActiveSelection: (state: SelectionState | null) => void;
  clearSelection: () => void;
  sendSelectionEdit: (instruction: string) => Promise<void>;
  /** 提示词片段池（从 visualCanvasItems 派生，去重后） */
  promptPool: import('./promptPool').PromptFragment[];
  /** 更新某镜引用的片段 ID 列表 */
  updateShotFragmentRefs: (shotIndex: number, fragmentIds: string[]) => void;
}

const StoryAgentContext = createContext<StoryAgentContextValue | null>(null);

type StoryAgentChatResult = {
  reply?: string;
  card?: Partial<StoryCard> | null;
  read?: unknown;
  configured?: boolean;
  modelLabel?: string;
};

type StoryAgentClassifyResult =
  | {
      characters?: Array<{ name: string; role: string; oneLiner: string }>;
      arc?: string;
      logline?: string;
      theme?: string;
      variants?: GeneratedScript['variants'];
      boringCheck?: GeneratedScript['boringCheck'];
      shots?: unknown[];
      configured?: boolean;
      modelLabel?: string;
    }
  | {
      error: string;
      configured?: boolean;
      modelLabel?: string;
    };

const storageKey = (projectId: number | null) =>
  projectId ? `dt:storyAgent:${projectId}` : null;

function normalizePersisted(parsed: PersistedState): PersistedState {
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
    imageProvider: normalizeImageProviderSelection(parsed.imageProvider),
    savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : undefined,
    activeStoryId: typeof parsed.activeStoryId === 'number' ? parsed.activeStoryId : undefined,
  };
}

function storyWorkScore(state: PersistedState): number {
  return (
    state.cards.length * 100 +
    state.storyShots.length * 80 +
    state.scripts.length * 60 +
    Math.max(0, state.messages.length - 1) * 20 +
    (state.visualCanvasItems?.length ?? 0) * 40
  );
}

function hasStoryWork(state: PersistedState): boolean {
  return storyWorkScore(state) > 0;
}

function activeStoryIdFrom(state: PersistedState): number | null {
  if (typeof state.activeStoryId === 'number') return state.activeStoryId;
  if (typeof state.remoteStoryId === 'number') return state.remoteStoryId;
  return hasStoryWork(state) ? -1 : null;
}

function hasLiveStoryWork(state: {
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
    state.messages.some((message) => message.role === 'user' && message.content.trim().length > 0)
  );
}

function loadState(projectId: number | null): PersistedState {
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

// Story data is keyed by the server-assigned projectId, but that id can drift
// across local/dev deploys. When the active project's slot is empty, recover the
// richest story stranded under a previous projectId so the user's work doesn't
// appear to vanish. Non-destructive: the source key is left intact.
function findOrphanStory(currentProjectId: number): PersistedState | null {
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

function emptyState(): PersistedState {
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
    imageProvider: 'default',
  };
}

function normalizeImageProviderSelection(value: unknown): ImageProviderSelection {
  if (value === 'default') return 'default';
  if (typeof value !== 'string') return 'default';
  return normalizeImageProvider(value);
}

function imageProviderForRequest(value: ImageProviderSelection): ImageProvider | undefined {
  return value === 'default' ? undefined : value;
}

// newId / cardTitle / stringList / normalizeVisualCanvasItem / fileToBase64
// 已搬到 ./storyAgentUtils（见顶部 import），此处不再重复定义。

function normalizeCard(raw: unknown): StoryCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const content =
    typeof obj.content === 'string'
      ? obj.content.trim()
      : typeof obj.title === 'string'
        ? obj.title.trim()
        : '';
  if (!content) return null;
  const card: StoryCard = {
    id: typeof obj.id === 'string' ? obj.id : newId('card'),
    title: typeof obj.title === 'string' ? obj.title : '',
    content,
    rawText: typeof obj.rawText === 'string' ? obj.rawText : undefined,
    sourceQuote: typeof obj.sourceQuote === 'string' ? obj.sourceQuote : undefined,
    emotion: typeof obj.emotion === 'string' ? obj.emotion : '未标',
    emotionOptions: Array.isArray(obj.emotionOptions)
      ? obj.emotionOptions.filter((v): v is string => typeof v === 'string')
      : undefined,
    emotionBlend: Array.isArray(obj.emotionBlend)
      ? obj.emotionBlend.filter((v): v is string => typeof v === 'string')
      : undefined,
    sensoryDetails: Array.isArray(obj.sensoryDetails)
      ? obj.sensoryDetails.filter((v): v is string => typeof v === 'string')
      : [],
    intensity: typeof obj.intensity === 'number' ? obj.intensity : undefined,
    direction: typeof obj.direction === 'string' ? obj.direction : undefined,
    complexity: typeof obj.complexity === 'string' ? obj.complexity : undefined,
    trigger: typeof obj.trigger === 'string' ? obj.trigger : undefined,
    dramaticFunction:
      typeof obj.dramaticFunction === 'string' ? obj.dramaticFunction : undefined,
    personalTrace: typeof obj.personalTrace === 'string' ? obj.personalTrace : undefined,
    retrievalQuery: typeof obj.retrievalQuery === 'string' ? obj.retrievalQuery : undefined,
    themeHints: Array.isArray(obj.themeHints)
      ? obj.themeHints.filter((v): v is string => typeof v === 'string')
      : undefined,
    outlierSignal: typeof obj.outlierSignal === 'string' ? obj.outlierSignal : undefined,
    softMembership: Array.isArray(obj.softMembership)
      ? obj.softMembership.filter((v): v is string => typeof v === 'string')
      : undefined,
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
  };
  return { ...card, title: card.title || cardTitle(card) };
}

function normalizeShot(raw: unknown, index: number): StoryShot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const action = str(obj.action);
  if (!action) return null;
  return {
    shotNo: typeof obj.shotNo === 'number' ? obj.shotNo : index + 1,
    subject: str(obj.subject),
    action,
    dialogue: str(obj.dialogue),
    shotType: str(obj.shotType) || '中',
    beat: str(obj.beat) || (index === 0 ? '开场' : '起势'),
    cameraAngle: str(obj.cameraAngle),
    cameraMove: str(obj.cameraMove),
    location: str(obj.location),
    timeLight: str(obj.timeLight),
    mood: str(obj.mood),
    sound: str(obj.sound),
    styleRef: str(obj.styleRef),
    note: str(obj.note),
    emotion: str(obj.emotion) || '未标',
    sourceCardContent: str(obj.sourceCardContent),
    emotionCharge: str(obj.emotionCharge),
    emotionDelta: str(obj.emotionDelta),
    visualAnchorText: str(obj.visualAnchorText),
    promptDraft: str(obj.promptDraft),
    negativePrompt: str(obj.negativePrompt),
    fragmentRefs: Array.isArray(obj.fragmentRefs)
      ? obj.fragmentRefs.filter((v): v is string => typeof v === 'string')
      : undefined,
  };
}

function normalizeMessages(rawMessages: unknown): ChatMessage[] {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) return emptyState().messages;
  const converted = rawMessages
    .map((m, i) => {
      if (!m || typeof m !== 'object') return null;
      const obj = m as Record<string, unknown>;
      const role =
        obj.role === 'user' || obj.who === 'u'
          ? 'user'
          : obj.role === 'assistant' || obj.who === 's'
            ? 'assistant'
            : null;
      const content =
        typeof obj.content === 'string'
          ? obj.content
          : typeof obj.text === 'string'
            ? obj.text
            : '';
      if (!role || !content.trim()) return null;
      const pending = obj.pendingCard as Record<string, unknown> | undefined;
      const message: ChatMessage = {
        id: typeof obj.id === 'string' ? obj.id : `msg-${i}-${Date.now()}`,
        role,
        content,
        timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : Date.now() + i,
      };
      if (pending && typeof pending.cardId === 'string' && pending.status === 'kept') {
        message.spawnedCardId = pending.cardId;
      }
      return message;
    })
    .filter((m): m is ChatMessage => Boolean(m));
  return converted.length > 0 ? converted : emptyState().messages;
}

function scriptFromStory(params: {
  title?: string;
  logline?: string;
  theme?: string;
  arc?: string;
  shots: StoryShot[];
  cards: StoryCard[];
  variants?: GeneratedScript['variants'];
  boringCheck?: GeneratedScript['boringCheck'];
  createdAt?: number;
}): GeneratedScript | null {
  if (!params.shots.length && !params.logline && !params.arc) return null;
  return {
    id: newId('script'),
    title: params.title || '故事镜头草案',
    logline: params.logline || params.shots[0]?.action || '这一组素材还在成形',
    theme: params.theme,
    scenes: params.shots.map((shot) => ({
      sceneNo: `S${String(shot.shotNo).padStart(2, '0')}`,
      fromCardId:
        params.cards.find((card) => card.content === shot.sourceCardContent)?.id || '',
      visual: [shot.subject, shot.action, shot.dialogue ? `「${shot.dialogue}」` : '']
        .filter(Boolean)
        .join(' · '),
      emotion: shot.emotion || shot.beat || '未标',
    })),
    arcSummary: params.arc || '',
    variants: params.variants,
    boringCheck: params.boringCheck,
    cardOrder: params.cards.map((c) => c.id),
    createdAt: params.createdAt ?? Date.now(),
  };
}

// tokenizeForSimilarity / storyCardSearchText / getSimilarCards
// \u5df2\u642c\u5230 ./storyCardSimilarity\uff08\u89c1\u9876\u90e8 import\uff09\uff0c\u6b64\u5904\u4e0d\u518d\u91cd\u590d\u5b9a\u4e49\u3002

function archiveMessagesFrom(
  sourceMessages: ChatMessage[],
  sourceCards: StoryCard[],
) {
  return sourceMessages.map((message) => {
    const spawnedCard = message.spawnedCardId
      ? sourceCards.find((card) => card.id === message.spawnedCardId)
      : undefined;
    return {
      who: message.role === 'user' ? 'u' : 's',
      name: message.role === 'user' ? '你' : '小酌',
      text: message.content,
      pendingCard: spawnedCard
        ? {
            status: 'kept',
            cardId: spawnedCard.id,
            content: spawnedCard.content,
            emotion: spawnedCard.emotion,
            sensoryDetails: spawnedCard.sensoryDetails,
          }
        : undefined,
    };
  });
}

export function StoryAgentProvider({
  projectId,
  children,
}: {
  projectId: number | null;
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const chatMut = trpc.storyAgent.chat.useMutation();
  const uploadPhotoMut = trpc.storyAgent.uploadPhoto.useMutation(); // 上传图片用
  const artRiffMut = trpc.artAgent.riff.useMutation();
  const classifyMut = trpc.storyAgent.classify.useMutation();
  const storyUpsertMut = trpc.storyAgent.storyUpsert.useMutation();
  const storyDeleteMut = trpc.storyAgent.storyDelete.useMutation();
  const saveSnapshotMut = trpc.editContext.saveSnapshot.useMutation();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cards, setCards] = useState<StoryCard[]>([]);
  const [scripts, setScripts] = useState<GeneratedScript[]>([]);
  const [storyShots, setStoryShots] = useState<StoryShot[]>([]);
  const [characters, setCharacters] = useState<Array<{ name: string; role: string; oneLiner: string }>>([]);
  const [remoteStoryId, setRemoteStoryId] = useState<number | undefined>(undefined);
  const [storyTitle, setStoryTitle] = useState<string | undefined>(undefined);
  const [storyLogline, setStoryLogline] = useState<string | undefined>(undefined);
  const [storyTheme, setStoryTheme] = useState<string | undefined>(undefined);
  const [storyArc, setStoryArc] = useState<string | undefined>(undefined);
  const [visualCanvasItems, setVisualCanvasItems] = useState<VisualCanvasItem[]>([]);
  const [visualPreference, setVisualPreference] = useState('');
  const [imageProvider, setImageProvider] = useState<ImageProviderSelection>('default');
  const [isArtWorking, setIsArtWorking] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<StorySaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [storyList, setStoryList] = useState<StoryListItem[]>([]);
  // 第二步：老用户点回旧故事时的「我还记得上次……」再问候。纯内存、不落库（见 interface 注释）。
  const [returningGreeting, setReturningGreeting] = useState<string | null>(null);
  const [activeSelection, setActiveSelection] = useState<SelectionState | null>(null);
  const hydratedFor = useRef<number | null>(null);

  // ── Auto-save refs ──────────────────────────────────────────────────
  // Stable session ID for this browser session
  const sessionIdRef = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  // Hash of cards/scripts/shots at the time of last snapshot (explicit or auto)
  const lastSnapshotHashRef = useRef('');
  const lastArchiveSaveHashRef = useRef('');
  // Timestamp of the most recent cards/scripts/shots state change
  const lastStateChangeTimeRef = useRef(Date.now());
  // Mirror of isReplying / isGeneratingScript as refs so the timer closure can read them
  const isReplyingRef = useRef(false);
  const isGeneratingScriptRef = useRef(false);
  // ID of the most recent explicitly-triggered snapshot (before sendMessage)
  const lastSnapshotIdRef = useRef<number | null>(null);

  // Hydrate from localStorage when projectId becomes available / changes
  useEffect(() => {
    if (projectId === null) return;
    if (hydratedFor.current === projectId) return;
    let persisted = loadState(projectId);
    // This project's slot is empty — likely the projectId drifted after a server
    // reset. Pull back the story stranded under the old projectId instead of
    // showing a blank workspace.
    const slotEmpty = !hasStoryWork(persisted);
    if (slotEmpty) {
      const orphan = findOrphanStory(projectId);
      if (orphan) {
        persisted = orphan;
        toast.success('已从本地备份恢复上次的故事');
      }
    }
    setMessages(persisted.messages);
    setCards(persisted.cards);
    setScripts(persisted.scripts);
    setStoryShots(persisted.storyShots);
    setCharacters(persisted.characters);
    setRemoteStoryId(persisted.remoteStoryId);
    setStoryTitle(persisted.title);
    setStoryLogline(persisted.logline);
    setStoryTheme(persisted.theme);
    setStoryArc(persisted.arc);
    setVisualCanvasItems(persisted.visualCanvasItems ?? []);
    setVisualPreference(persisted.visualPreference ?? '');
    setImageProvider(persisted.imageProvider ?? 'default');
    // Option A：进门先看「继续 vs 开新」选择屏，不再把老用户自动塞回上次那篇。
    // 已保存过的故事（有 remoteStoryId）一律回到选择屏——它仍在云端列表里，随时可点回；
    // 只有「未存过的新草稿」(有内容但还没 remoteStoryId) 才直接恢复，否则它不在列表里、
    // 进了选择屏就再也找不回来、会丢草稿。
    const restored = activeStoryIdFrom(persisted);
    const isUnsavedNewDraft =
      persisted.remoteStoryId == null && hasStoryWork(persisted);
    setActiveStoryId(isUnsavedNewDraft ? restored : null);
    setSaveStatus(persisted.remoteStoryId ? 'saved' : 'idle');
    setLastSavedAt(persisted.savedAt);
    hydratedFor.current = projectId;
  }, [projectId]);

  // Story loading is now handled explicitly via loadStory() from the story list.

  // Persist on change
  useEffect(() => {
    const key = storageKey(projectId);
    if (!key || hydratedFor.current !== projectId) return;
    const data: PersistedState = {
      messages,
      cards,
      scripts,
      storyShots,
      characters,
      remoteStoryId,
      title: storyTitle,
      logline: storyLogline,
      theme: storyTheme,
      arc: storyArc,
      visualCanvasItems,
      visualPreference,
      imageProvider,
      savedAt: Date.now(),
      activeStoryId: activeStoryId ?? undefined,
    };
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      // ignore quota errors
    }
  }, [
    projectId,
    messages,
    cards,
    scripts,
    storyShots,
    characters,
    remoteStoryId,
    storyTitle,
    storyLogline,
    storyTheme,
    storyArc,
    visualCanvasItems,
    visualPreference,
    imageProvider,
    activeStoryId,
  ]);

  // ── Auto-save: keep refs in sync ───────────────────────────────────
  useEffect(() => { isReplyingRef.current = isReplying; }, [isReplying]);
  useEffect(() => { isGeneratingScriptRef.current = isGeneratingScript; }, [isGeneratingScript]);

  // Track the last time the editable state changed (for the 2-second inactivity guard)
  useEffect(() => {
    lastStateChangeTimeRef.current = Date.now();
  }, [cards, scripts, storyShots, visualCanvasItems, visualPreference]);

  // ── Auto-save: 5-minute timer ───────────────────────────────────────
  useEffect(() => {
    if (projectId === null) return;

    const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;
    const INACTIVITY_THRESHOLD_MS = 2_000;

    const timerId = setInterval(() => {
      // Skip while Agent is actively generating
      if (isReplyingRef.current || isGeneratingScriptRef.current) return;

      // Lightweight hash: card/script/shot IDs + card count
      const currentHash = JSON.stringify({
        cardIds: cards.map((c) => c.id),
        scriptIds: scripts.map((s) => s.id),
        shotNos: storyShots.map((s) => s.shotNo),
        cardContents: cards.map((c) => c.content),
        visualIds: visualCanvasItems.map((item) => item.id),
        visualPreference,
      });

      // Skip if nothing changed since last snapshot
      if (currentHash === lastSnapshotHashRef.current) return;

      // Skip if the user has been active within the last 2 seconds
      if (Date.now() - lastStateChangeTimeRef.current < INACTIVITY_THRESHOLD_MS) return;

      lastSnapshotHashRef.current = currentHash;

      saveSnapshotMut.mutate(
        {
          projectId,
          sessionId: sessionIdRef.current,
          state: {
            cards: cards as unknown as Record<string, unknown>[],
            script: scripts as unknown as Record<string, unknown>[],
            shots: storyShots as unknown as Record<string, unknown>[],
            visualCanvasItems: visualCanvasItems as unknown as Record<string, unknown>[],
            visualPreference,
          },
          autoSave: true,
        },
        {
          onError: (err) => {
            console.warn('[autoSave] snapshot failed, will retry next interval:', err);
            // Revert hash so the next timer tick retries
            lastSnapshotHashRef.current = '';
          },
        },
      );
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearInterval(timerId);
    // cards/scripts/storyShots intentionally read via closure — timer only restarts on projectId change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const saveArchiveStory = useCallback(
    async (snapshot: {
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
      imageProvider?: ImageProviderSelection;
    }) => {
      if (!hasLiveStoryWork(snapshot)) return;
      const latest =
        snapshot.scripts.length > 0
          ? snapshot.scripts[snapshot.scripts.length - 1]
          : null;
      const title =
        snapshot.title ||
        storyTitle ||
        latest?.title ||
        snapshot.cards[0]?.title ||
        '未命名故事';
      const logline = snapshot.logline ?? storyLogline ?? latest?.logline ?? '';
      const theme = snapshot.theme ?? storyTheme ?? latest?.theme ?? '';
      const arc = snapshot.arc ?? storyArc ?? latest?.arcSummary ?? '';
      const canvasItems = snapshot.visualCanvasItems ?? visualCanvasItems;
      const preference = snapshot.visualPreference ?? visualPreference;
      const selectedProvider = snapshot.imageProvider ?? imageProvider;

      try {
        setSaveStatus('saving');
        const saved = await storyUpsertMut.mutateAsync({
          id: snapshot.remoteStoryId ?? remoteStoryId,
          projectId: projectId ?? undefined,
          title,
          logline,
          theme,
          arc,
          summary: snapshot.summary ?? '',
          body: {
            cards: snapshot.cards,
            characters: snapshot.characters,
            shots: snapshot.storyShots,
            visualCanvasItems: canvasItems,
            visualPreference: preference,
            imageProvider: selectedProvider,
            variants: latest?.variants ?? [],
            boringCheck: latest?.boringCheck ?? null,
            messages: archiveMessagesFrom(snapshot.messages, snapshot.cards),
          },
        });
        if (saved && typeof saved.id === 'number') {
          setRemoteStoryId(saved.id);
          // 只在「正处于某篇故事」时把 activeStoryId 对齐到 saved.id（新故事 -1 → 真 id）。
          // 若用户正停在选择屏 (activeStoryId === null)，后台自动保存绝不能把人弹进故事——
          // 否则进门时 hydrate 灌入内容触发的一次后台保存，会让选择屏「闪一下」就跳进上次那篇
          // （Option A 实测 bug：#1 闪一下就结束）。
          setActiveStoryId((current) => (current === null ? null : saved.id));
          setSaveStatus('saved');
          setLastSavedAt(Date.now());
        }
      } catch (error) {
        console.warn('save archive story failed', error);
        // Clear stale remoteStoryId so the next save attempt creates a fresh story
        // instead of repeatedly failing to update a story that no longer exists.
        setRemoteStoryId(undefined);
        setSaveStatus('error');
        toast.error('云端保存失败，本机仍有临时备份，会继续重试');
      }
    },
    [
      projectId,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      visualCanvasItems,
      visualPreference,
      imageProvider,
    ],
  );

  useEffect(() => {
    if (projectId !== null && hydratedFor.current !== projectId) return;
    if (isReplying || isGeneratingScript) return;
    const snapshot = {
      messages,
      cards,
      scripts,
      storyShots,
      characters,
      remoteStoryId,
      title: storyTitle,
      logline: storyLogline,
      theme: storyTheme,
      arc: storyArc,
      visualCanvasItems,
      visualPreference,
      imageProvider,
    };
    if (!hasLiveStoryWork(snapshot)) return;

    const currentHash = JSON.stringify({
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        spawnedCardId: message.spawnedCardId,
      })),
      cards,
      scripts,
      storyShots,
      characters,
      title: storyTitle,
      logline: storyLogline,
      theme: storyTheme,
      arc: storyArc,
      visualCanvasItems,
      visualPreference,
      imageProvider,
    });
    if (currentHash === lastArchiveSaveHashRef.current) return;

    const timerId = window.setTimeout(() => {
      lastArchiveSaveHashRef.current = currentHash;
      void saveArchiveStory(snapshot);
    }, 1_500);

    return () => window.clearTimeout(timerId);
  }, [
    messages,
    cards,
    scripts,
    storyShots,
    characters,
    remoteStoryId,
    storyTitle,
    storyLogline,
    storyTheme,
    storyArc,
    visualCanvasItems,
    visualPreference,
    imageProvider,
    isReplying,
    isGeneratingScript,
    projectId,
    saveArchiveStory,
  ]);

  const sendMessage = useCallback(
    async (text: string, photoBase64?: string, photoMimeType = "image/jpeg") => {
      const trimmed = text.trim();
      if ((!trimmed && !photoBase64) || isReplying) return;

      const userMsg: ChatMessage = {
        id: newId('msg'),
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setIsReplying(true);
      // 用户重新开口，「我还记得上次」再问候已完成使命——收起，免得卡在新对话中间。
      setReturningGreeting(null);

      // Capture snapshot of current state before Agent generation.
      // Errors are silent — snapshot failure must never block message send.
      if (projectId !== null) {
        try {
          const snapshotResult = await saveSnapshotMut.mutateAsync({
            projectId,
            sessionId: sessionIdRef.current,
            state: {
              cards: cards as unknown as Record<string, unknown>[],
              script: scripts as unknown as Record<string, unknown>[],
              shots: storyShots as unknown as Record<string, unknown>[],
              visualCanvasItems: visualCanvasItems as unknown as Record<string, unknown>[],
              visualPreference,
            },
          });
          lastSnapshotIdRef.current = snapshotResult.snapshotId;
          // Sync hash so the auto-save timer doesn't duplicate this snapshot
          lastSnapshotHashRef.current = JSON.stringify({
            cardIds: cards.map((c) => c.id),
            scriptIds: scripts.map((s) => s.id),
            shotNos: storyShots.map((s) => s.shotNo),
            cardContents: cards.map((c) => c.content),
            visualIds: visualCanvasItems.map((item) => item.id),
            visualPreference,
          });
        } catch (err) {
          console.warn('[snapshot] captureSnapshot failed, proceeding without context:', err);
        }
      }

      try {
        // 如果有照片，先上传拿 URL
        let photoUrl: string | undefined;
        if (photoBase64) {
          try {
            const uploadResult = await uploadPhotoMut.mutateAsync({
              base64: photoBase64,
              mimeType: photoMimeType,
            });
            if (uploadResult.status === "ok") photoUrl = uploadResult.url;
          } catch (err) {
            console.error("[sendMessage] 照片上传失败:", err);
          }
        }

        const result = await chatMut.mutateAsync({
          message: trimmed || "帮我看看这张照片",
          history: nextMessages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
          existingCardCount: cards.length,
          currentShots: storyShots.map((shot) => ({
            shotNo: shot.shotNo,
            subject: shot.subject,
            action: shot.action,
            dialogue: shot.dialogue,
            shotType: shot.shotType,
            cameraAngle: shot.cameraAngle,
            cameraMove: shot.cameraMove,
            location: shot.location,
            timeLight: shot.timeLight,
            mood: shot.mood,
            sound: shot.sound,
            styleRef: shot.styleRef,
          })),
          similarCards: getSimilarCards(trimmed, cards),
          projectId: projectId ?? undefined,
          photoUrl, // 传给 LLM 做多模态理解
        }) as StoryAgentChatResult;
        let nextCards = cards;
        let spawnedCardId: string | undefined;

        if (result.card) {
          const normalized = normalizeCard({
            ...result.card,
            id: newId('card'),
            title: result.card.title || cardTitle(result.card),
            createdAt: Date.now(),
          });
          if (normalized) {
            spawnedCardId = normalized.id;
            nextCards = [...cards, normalized];
            setCards(nextCards);
            toast.success(`新卡片：${normalized.title}`);
          }
        }

        if (result.configured === false) {
          toast.error('旧 Agent 接口还没配置模型 API');
        }

        const replyMsg: ChatMessage = {
          id: newId('msg'),
          role: 'assistant',
          content: result.reply || '我在。你可以再多说一点那个感觉。',
          timestamp: Date.now(),
          spawnedCardId,
        };
        const finalMessages = [...nextMessages, replyMsg];
        setMessages(finalMessages);

        await saveArchiveStory({
          messages: finalMessages,
          cards: nextCards,
          scripts,
          storyShots,
          characters,
          remoteStoryId,
          title: storyTitle,
          logline: storyLogline,
          theme: storyTheme,
          arc: storyArc,
        });
      } catch (err) {
        console.error('storyAgent.chat failed', err);
        toast.error('Agent 暂时没接上，再试一次？');
      } finally {
        setIsReplying(false);
      }
    },
    [
      projectId,
      isReplying,
      messages,
      cards,
      storyShots,
      scripts,
      characters,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      visualCanvasItems,
      visualPreference,
      saveArchiveStory,
      uploadPhotoMut,
    ],
  );

  const reorderCards = useCallback(
    (newOrder: StoryCard[]) => {
      setCards(newOrder);
      void saveArchiveStory({
        messages,
        cards: newOrder,
        scripts,
        storyShots,
        characters,
        remoteStoryId,
        title: storyTitle,
        logline: storyLogline,
        theme: storyTheme,
        arc: storyArc,
      });
    },
    [
      messages,
      scripts,
      storyShots,
      characters,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      saveArchiveStory,
    ],
  );

  const removeCard = useCallback(
    (id: string) => {
      const removed = cards.find((card) => card.id === id);
      const nextCards = cards.filter((card) => card.id !== id);
      const nextStoryShots = removed
        ? storyShots.filter((shot) => shot.sourceCardContent !== removed.content)
        : storyShots;
      setCards(nextCards);
      setStoryShots(nextStoryShots);
      void saveArchiveStory({
        messages,
        cards: nextCards,
        scripts,
        storyShots: nextStoryShots,
        characters,
        remoteStoryId,
        title: storyTitle,
        logline: storyLogline,
        theme: storyTheme,
        arc: storyArc,
      });
    },
    [
      cards,
      storyShots,
      messages,
      scripts,
      characters,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      saveArchiveStory,
    ],
  );

  // Inline edit of a single card's content. Mirrors removeCard's persistence:
  // setCards triggers the persist-on-change effect (localStorage), and
  // saveArchiveStory pushes the durable server copy.
  const updateCardContent = useCallback(
    (id: string, content: string) => {
      const nextCards = cards.map((card) =>
        card.id === id ? { ...card, content } : card,
      );
      setCards(nextCards);
      void saveArchiveStory({
        messages,
        cards: nextCards,
        scripts,
        storyShots,
        characters,
        remoteStoryId,
        title: storyTitle,
        logline: storyLogline,
        theme: storyTheme,
        arc: storyArc,
      });
    },
    [
      cards,
      messages,
      scripts,
      storyShots,
      characters,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      saveArchiveStory,
    ],
  );

  // Replace the latest script with an edited copy. Same persistence path as
  // updateCardContent: setScripts → persist-on-change effect + saveArchiveStory.
  const commitScripts = useCallback(
    (nextScripts: GeneratedScript[]) => {
      setScripts(nextScripts);
      void saveArchiveStory({
        messages,
        cards,
        scripts: nextScripts,
        storyShots,
        characters,
        remoteStoryId,
        title: storyTitle,
        logline: storyLogline,
        theme: storyTheme,
        arc: storyArc,
      });
    },
    [
      messages,
      cards,
      storyShots,
      characters,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      saveArchiveStory,
    ],
  );

  const updateScriptMeta = useCallback(
    (field: 'title' | 'logline' | 'arcSummary', value: string) => {
      const idx = scripts.length - 1;
      if (idx < 0) return;
      const nextScripts = scripts.map((s, i) =>
        i === idx ? { ...s, [field]: value } : s,
      );
      commitScripts(nextScripts);
    },
    [scripts, commitScripts],
  );

  const updateScriptScene = useCallback(
    (sceneIndex: number, field: 'visual' | 'emotion', value: string) => {
      const idx = scripts.length - 1;
      if (idx < 0) return;
      const last = scripts[idx];
      if (!last || sceneIndex < 0 || sceneIndex >= last.scenes.length) return;
      const nextScenes = last.scenes.map((sc, i) =>
        i === sceneIndex ? { ...sc, [field]: value } : sc,
      );
      const nextScripts = scripts.map((s, i) =>
        i === idx ? { ...s, scenes: nextScenes } : s,
      );
      commitScripts(nextScripts);
    },
    [scripts, commitScripts],
  );

  const updateStoryShotField = useCallback(
    (index: number, field: 'subject' | 'action' | 'dialogue', value: string) => {
      if (index < 0 || index >= storyShots.length) return;
      const nextStoryShots = storyShots.map((shot, i) =>
        i === index ? { ...shot, [field]: value } : shot,
      );
      setStoryShots(nextStoryShots);
      void saveArchiveStory({
        messages,
        cards,
        scripts,
        storyShots: nextStoryShots,
        characters,
        remoteStoryId,
        title: storyTitle,
        logline: storyLogline,
        theme: storyTheme,
        arc: storyArc,
      });
    },
    [
      storyShots,
      messages,
      cards,
      scripts,
      characters,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      saveArchiveStory,
    ],
  );

  const generateScript = useCallback(async () => {
    if (cards.length === 0) {
      toast.error('先生成卡片再合成剧本');
      return;
    }
    if (isGeneratingScript) return;
    setIsGeneratingScript(true);

    try {
      const result = await classifyMut.mutateAsync({
        cards: cards.map((card) => ({
          content: card.content,
          rawText: card.rawText,
          sourceQuote: card.sourceQuote,
          emotion: card.emotion,
          emotionOptions: card.emotionOptions,
          emotionBlend: card.emotionBlend,
          intensity: card.intensity,
          direction: card.direction,
          complexity: card.complexity,
          trigger: card.trigger,
          dramaticFunction: card.dramaticFunction,
          personalTrace: card.personalTrace,
          retrievalQuery: card.retrievalQuery,
          themeHints: card.themeHints,
          outlierSignal: card.outlierSignal,
          softMembership: card.softMembership,
        })),
        characterHint: characters[0]?.name ?? '',
        visualAnchors: visualCanvasItems.map((item) => ({
          title: item.title,
          imageUrl: item.imageUrl,
          objective: item.analysis.objective,
          aesthetic: item.analysis.aesthetic,
          prompt: item.prompt,
          visualStyle: item.analysis.visualStyle,
          mood: item.analysis.mood,
          colorPalette: item.analysis.colorPalette,
        })),
        projectId: projectId ?? undefined,
      }) as StoryAgentClassifyResult;
      if ('error' in result) {
        toast.error(result.error);
        return;
      }

      const nextShots = Array.isArray(result.shots)
        ? result.shots.map(normalizeShot).filter((s): s is StoryShot => Boolean(s))
        : [];
      if (!nextShots.length) {
        toast.error('模型没有返回有效镜头');
        return;
      }

      const nextCharacters = Array.isArray(result.characters)
        ? result.characters
            .filter((c) => c && typeof c.name === 'string')
            .map((c) => ({
              name: c.name,
              role: typeof c.role === 'string' ? c.role : '',
              oneLiner: typeof c.oneLiner === 'string' ? c.oneLiner : '',
            }))
        : [];
      const nextTitle = storyTitle || result.logline || '故事镜头草案';
      const script = scriptFromStory({
        title: nextTitle,
        logline: result.logline,
        theme: result.theme,
        arc: result.arc,
        shots: nextShots,
        cards,
        variants: result.variants,
        boringCheck: result.boringCheck,
      });
      if (!script) {
        toast.error('剧本生成失败：结果为空');
        return;
      }

      const nextScripts = [...scripts, script];
      setStoryTitle(nextTitle);
      setStoryLogline(result.logline);
      setStoryTheme(result.theme);
      setStoryArc(result.arc);
      setStoryShots(nextShots);
      setCharacters(nextCharacters);
      setScripts(nextScripts);

      await saveArchiveStory({
        messages,
        cards,
        scripts: nextScripts,
        storyShots: nextShots,
        characters: nextCharacters,
        remoteStoryId,
        title: nextTitle,
        logline: result.logline,
        theme: result.theme,
        arc: result.arc,
      });
      if (projectId !== null) {
        await utils.shot.list.invalidate({ projectId });
      }
      toast.success(`剧本已生成：${script.title}`);
    } catch (err) {
      console.error('storyAgent.generateScript failed', err);
      toast.error('剧本生成失败');
    } finally {
      setIsGeneratingScript(false);
    }
  }, [
    cards,
    characters,
    classifyMut,
    isGeneratingScript,
    messages,
    projectId,
    scripts,
    remoteStoryId,
    storyTitle,
    utils.shot.list,
    visualCanvasItems,
    saveArchiveStory,
  ]);

  const resetConversation = useCallback(() => {
    const fresh = emptyState();
    setMessages(fresh.messages);
    setCards([]);
    setScripts([]);
    setStoryShots([]);
    setCharacters([]);
    setRemoteStoryId(undefined);
    setStoryTitle(undefined);
    setStoryLogline(undefined);
    setStoryTheme(undefined);
    setStoryArc(undefined);
    setVisualCanvasItems([]);
    setVisualPreference('');
    setActiveStoryId(-1);
    setSaveStatus('idle');
    setLastSavedAt(undefined);
    setReturningGreeting(null);
    toast.success('已开始新故事，旧故事仍保留在云端故事库');
  }, []);

  const refreshStoryList = useCallback(async () => {
    setIsLoadingStories(true);
    try {
      const data = await utils.storyAgent.storyList.fetch();
      const items: StoryListItem[] = (data.stories ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        logline: s.logline,
        updatedAt: s.updatedAt,
        cardCount: s.cardCount,
        shotCount: s.shotCount,
      }));
      setStoryList(items);
      // Clear stale remoteStoryId if it no longer exists on the server
      // (e.g. after server restart wiped in-memory state). This ensures the
      // next save attempt creates a new story rather than failing silently.
      setRemoteStoryId((prev) => {
        if (prev !== undefined && !items.some((s) => s.id === prev)) {
          setActiveStoryId((current) => (current === prev ? -1 : current));
          return undefined;
        }
        return prev;
      });
    } catch (error) {
      console.warn('refreshStoryList failed', error);
    } finally {
      setIsLoadingStories(false);
    }
  }, [utils.storyAgent.storyList]);

  // Fetch story list on mount
  useEffect(() => {
    if (projectId !== null) {
      refreshStoryList();
    }
  }, [projectId, refreshStoryList]);

  const clearCurrentStory = useCallback(() => {
    const fresh = emptyState();
    setMessages(fresh.messages);
    setCards([]);
    setScripts([]);
    setStoryShots([]);
    setCharacters([]);
    setRemoteStoryId(undefined);
    setStoryTitle(undefined);
    setStoryLogline(undefined);
    setStoryTheme(undefined);
    setStoryArc(undefined);
    setVisualCanvasItems([]);
    setVisualPreference('');
    setImageProvider('default');
    setSaveStatus('idle');
    setLastSavedAt(undefined);
    setReturningGreeting(null);
  }, []);

  const loadStory = useCallback(async (id: number) => {
    try {
      const row = await utils.storyAgent.storyGet.fetch({ id });
      if (!row) {
        toast.error('故事不存在');
        return;
      }
      const body = row.body && typeof row.body === 'object'
        ? (row.body as Record<string, unknown>)
        : {};
      const restoredCards = Array.isArray(body.cards)
        ? body.cards.map(normalizeCard).filter((c): c is StoryCard => Boolean(c))
        : [];
      const restoredShots = Array.isArray(body.shots)
        ? body.shots.map(normalizeShot).filter((s): s is StoryShot => Boolean(s))
        : [];
      const restoredMessages = normalizeMessages(body.messages);
      const restoredCharacters = Array.isArray(body.characters)
        ? body.characters
            .filter((c): c is { name: string; role: string; oneLiner: string } =>
              Boolean(c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string'),
            )
            .map((c) => ({
              name: c.name,
              role: typeof c.role === 'string' ? c.role : '',
              oneLiner: typeof c.oneLiner === 'string' ? c.oneLiner : '',
            }))
        : [];
      const restoredVisualCanvasItems = Array.isArray(body.visualCanvasItems)
        ? body.visualCanvasItems
            .map(normalizeVisualCanvasItem)
            .filter((item): item is VisualCanvasItem => Boolean(item))
        : [];
      const restoredVisualPreference =
        typeof body.visualPreference === 'string' ? body.visualPreference : '';
      const restoredImageProvider = normalizeImageProviderSelection(body.imageProvider);

      setRemoteStoryId(id);
      setStoryTitle(row.title || undefined);
      setStoryLogline(row.logline || undefined);
      setStoryTheme(row.theme || undefined);
      setStoryArc(row.arc || undefined);
      setCards(restoredCards);
      setStoryShots(restoredShots);
      setCharacters(restoredCharacters);
      setMessages(restoredMessages);
      setVisualCanvasItems(restoredVisualCanvasItems);
      setVisualPreference(restoredVisualPreference);
      setImageProvider(restoredImageProvider);

      const remoteScript = scriptFromStory({
        title: row.title || undefined,
        logline: row.logline || undefined,
        theme: row.theme || undefined,
        arc: row.arc || undefined,
        shots: restoredShots,
        cards: restoredCards,
        variants: Array.isArray(body.variants)
          ? (body.variants as GeneratedScript['variants'])
          : undefined,
        boringCheck:
          body.boringCheck && typeof body.boringCheck === 'object'
            ? (body.boringCheck as GeneratedScript['boringCheck'])
            : undefined,
      });
      setScripts(remoteScript ? [remoteScript] : []);
      setActiveStoryId(id);
      setSaveStatus('saved');
      setLastSavedAt(row.updatedAt ? new Date(row.updatedAt).getTime() : Date.now());

      // 第二步：用这篇真实留存的内容，让小酌说一句「我还记得上次……」把人接回来。
      // 只在这篇有过用户发言时才召回（只有开场白的空壳故事不硬造记忆）。
      const lastCard = restoredCards[restoredCards.length - 1];
      setReturningGreeting(
        buildReturningGreeting({
          hasPriorUserMessages: restoredMessages.some(
            (m) => m.role === 'user' && m.content.trim().length > 0,
          ),
          logline: row.logline,
          lastCardQuote: lastCard?.sourceQuote || lastCard?.content,
          title: row.title,
        }),
      );
    } catch (error) {
      console.error('loadStory failed', error);
      toast.error('加载故事失败');
    }
  }, [utils.storyAgent.storyGet]);

  // 不再自动加载最近一篇：老用户进门先看「继续 vs 开新」选择屏（StoryListView），
  // 由 loadStory() / createNewStory() 显式进入对话。（Option A：开头直接问）
  // 注意：刷新时仍会通过上面的 hydrate 恢复「显式打开过的」activeStoryId，
  // 这里只移除「自动替用户挑最近一篇」的行为。

  const createNewStory = useCallback(() => {
    clearCurrentStory();
    setActiveStoryId(-1); // -1 = new unsaved story, will get real ID on first save
  }, [clearCurrentStory]);

  const backToList = useCallback(() => {
    setActiveStoryId(null);
    setReturningGreeting(null);
    refreshStoryList();
  }, [refreshStoryList]);

  const handleDeleteStory = useCallback(async (id: number) => {
    try {
      await storyDeleteMut.mutateAsync({ id });
      if (activeStoryId === id) {
        clearCurrentStory();
        setActiveStoryId(null);
      }
      await refreshStoryList();
      toast.success('故事已删除');
    } catch (error) {
      console.error('deleteStory failed', error);
      toast.error('删除失败');
    }
  }, [storyDeleteMut, activeStoryId, clearCurrentStory, refreshStoryList]);

  const persistVisualCanvas = useCallback(
    (nextItems: VisualCanvasItem[], nextPreference = visualPreference) => {
      setVisualCanvasItems(nextItems);
      setVisualPreference(nextPreference);
      void saveArchiveStory({
        messages,
        cards,
        scripts,
        storyShots,
        characters,
        remoteStoryId,
        title: storyTitle,
        logline: storyLogline,
        theme: storyTheme,
        arc: storyArc,
        visualCanvasItems: nextItems,
        visualPreference: nextPreference,
        imageProvider,
      });
    },
    [
      visualPreference,
      messages,
      cards,
      scripts,
      storyShots,
      characters,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      imageProvider,
      saveArchiveStory,
    ],
  );

  const addVisualReference = useCallback(
    async (file: File, instruction?: string, cardId?: string) => {
      if (isArtWorking) return;
      if (!file.type.startsWith('image/')) {
        toast.error('美术 Agent 现在只接图片。');
        return;
      }
      setIsArtWorking(true);
      try {
        const imageBase64 = await fileToBase64(file);
        const result = await artRiffMut.mutateAsync({
          imageBase64,
          mimeType: file.type || 'image/jpeg',
          fileName: file.name,
          instruction,
          projectPreference: visualPreference,
          imageProvider: imageProviderForRequest(imageProvider),
        });
        const offset = visualCanvasItems.length * 18;
        const item: VisualCanvasItem = {
          id: newId('visual'),
          title: file.name.replace(/\.[^.]+$/, '') || `视觉锚 ${visualCanvasItems.length + 1}`,
          imageUrl: result.imageUrl,
          originalImageUrl: result.originalImageUrl,
          source: 'riff',
          cardId,
          x: 18 + offset,
          y: 18 + offset,
          width: 170,
          height: 218,
          prompt: result.prompt,
          userInstruction: instruction,
          analysis: result.analysis,
          createdAt: Date.now(),
        };
        persistVisualCanvas([...visualCanvasItems, item], result.preferenceUpdate || visualPreference);
        toast.success(cardId ? '美术 Agent 已经把图放进这张卡' : '美术 Agent 已经把图落到画布上');
      } catch (error) {
        console.error('artAgent.riff failed', error);
        toast.error(error instanceof Error ? error.message : '美术 Agent 暂时没接上');
      } finally {
        setIsArtWorking(false);
      }
    },
    [
      isArtWorking,
      artRiffMut,
      visualPreference,
      imageProvider,
      visualCanvasItems,
      persistVisualCanvas,
    ],
  );

  const refineVisualItem = useCallback(
    async (id: string, instruction: string) => {
      const trimmed = instruction.trim();
      if (!trimmed) {
        toast.error('先说一句你想怎么改');
        return;
      }
      const item = visualCanvasItems.find((entry) => entry.id === id);
      if (!item || isArtWorking) return;
      setIsArtWorking(true);
      try {
        const result = await artRiffMut.mutateAsync({
          imageUrl: item.imageUrl,
          instruction: trimmed,
          projectPreference: visualPreference,
          previousPrompt: item.prompt,
          previousAnalysis: item.analysis as unknown as Record<string, unknown>,
          imageProvider: imageProviderForRequest(imageProvider),
        });
        const nextItem: VisualCanvasItem = {
          ...item,
          id: newId('visual'),
          title: `${item.title} · riff`,
          imageUrl: result.imageUrl,
          originalImageUrl: item.originalImageUrl ?? item.imageUrl,
          source: 'riff',
          parentId: item.id,
          x: item.x + 24,
          y: item.y + 24,
          prompt: result.prompt,
          userInstruction: trimmed,
          analysis: result.analysis,
          createdAt: Date.now(),
        };
        persistVisualCanvas([...visualCanvasItems, nextItem], result.preferenceUpdate || visualPreference);
        toast.success('已按你的口味再 riff 一版');
      } catch (error) {
        console.error('artAgent.refine failed', error);
        toast.error(error instanceof Error ? error.message : '改图失败，再试一次');
      } finally {
        setIsArtWorking(false);
      }
    },
    [
      visualCanvasItems,
      isArtWorking,
      artRiffMut,
      visualPreference,
      imageProvider,
      persistVisualCanvas,
    ],
  );

  const updateVisualCanvasItem = useCallback(
    (id: string, patch: Partial<Pick<VisualCanvasItem, 'x' | 'y' | 'width' | 'height' | 'title'>>) => {
      const nextItems = visualCanvasItems.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
      persistVisualCanvas(nextItems);
    },
    [visualCanvasItems, persistVisualCanvas],
  );

  const removeVisualCanvasItem = useCallback(
    (id: string) => {
      persistVisualCanvas(visualCanvasItems.filter((item) => item.id !== id));
    },
    [visualCanvasItems, persistVisualCanvas],
  );

  const clearSelection = useCallback(() => setActiveSelection(null), []);

  const selectionEditMut = trpc.storyAgent.selectionEdit.useMutation();

  /** Apply modifiedFullText back to the source entity */
  const applySelectionEdit = useCallback(
    (sourceType: string, sourceId: string, modifiedFullText: string) => {
      switch (sourceType) {
        case 'card':
          updateCardContent(sourceId, modifiedFullText);
          break;
        case 'script-scene': {
          const sceneIdx = Number(sourceId);
          if (!Number.isNaN(sceneIdx)) updateScriptScene(sceneIdx, 'visual', modifiedFullText);
          break;
        }
        case 'script-meta': {
          const field = sourceId as 'title' | 'logline' | 'arcSummary';
          updateScriptMeta(field, modifiedFullText);
          break;
        }
        case 'shot': {
          const parts = sourceId.split(':');
          const shotIdx = Number(parts[0]);
          const shotField = parts[1] as 'subject' | 'action' | 'dialogue';
          if (!Number.isNaN(shotIdx) && shotField) updateStoryShotField(shotIdx, shotField, modifiedFullText);
          break;
        }
        case 'chat': {
          setMessages((prev) =>
            prev.map((m) => (m.id === sourceId ? { ...m, content: modifiedFullText } : m)),
          );
          break;
        }
      }
    },
    [updateCardContent, updateScriptScene, updateScriptMeta, updateStoryShotField],
  );

  const sendSelectionEdit = useCallback(
    async (instruction: string) => {
      if (!activeSelection || isReplying) return;

      const { sourceType, sourceId, selectedText, fullText } = activeSelection;
      const selectionQuote = { sourceType, sourceId, selectedText };

      const userMsg: ChatMessage = {
        id: newId('msg'),
        role: 'user',
        content: instruction,
        timestamp: Date.now(),
        selectionQuote,
      };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setIsReplying(true);
      setReturningGreeting(null);

      try {
        const result = await selectionEditMut.mutateAsync({
          fullText,
          selectedText,
          instruction,
          projectId: projectId ?? undefined,
          history: nextMessages.slice(-8).map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        });

        // Apply modification to source entity
        if (!result.isApprovalOnly && result.modifiedFullText !== fullText) {
          applySelectionEdit(sourceType, sourceId, result.modifiedFullText);
        }

        const replyMsg: ChatMessage = {
          id: newId('msg'),
          role: 'assistant',
          content: result.reply || '已处理。',
          timestamp: Date.now(),
        };
        const finalMessages = [...nextMessages, replyMsg];
        setMessages(finalMessages);
        setActiveSelection(null);

        // Trigger snapshot for style learning annotation
        if (projectId !== null) {
          try {
            const updatedCards = sourceType === 'card'
              ? cards.map((c) => (c.id === sourceId ? { ...c, content: result.modifiedFullText } : c))
              : cards;
            await saveSnapshotMut.mutateAsync({
              projectId,
              sessionId: sessionIdRef.current,
              state: {
                cards: updatedCards as unknown as Record<string, unknown>[],
                script: scripts as unknown as Record<string, unknown>[],
                shots: storyShots as unknown as Record<string, unknown>[],
              },
              inlineCorrection: {
                originalText: selectedText,
                modifiedText: result.isApprovalOnly ? selectedText : result.modifiedFullText,
                instruction,
                sourceType,
              },
            });
          } catch (err) {
            console.warn('[snapshot] inline correction snapshot failed:', err);
          }
        }

        await saveArchiveStory({
          messages: finalMessages,
          cards,
          scripts,
          storyShots,
          characters,
          remoteStoryId,
          title: storyTitle,
          logline: storyLogline,
          theme: storyTheme,
          arc: storyArc,
        });
      } catch (err) {
        console.error('selectionEdit failed', err);
        toast.error('修改失败，再试一次？');
        // Don't clear selection on failure so user can retry
      } finally {
        setIsReplying(false);
      }
    },
    [
      activeSelection, isReplying, messages, projectId, cards, scripts,
      storyShots, characters, remoteStoryId, storyTitle, storyLogline,
      storyTheme, storyArc, saveArchiveStory, selectionEditMut, applySelectionEdit,
    ],
  );

  // ── 提示词片段池（从 visualCanvasItems 派生） ──
  const promptPool = useMemo(
    () => buildPromptPool(visualCanvasItems),
    [visualCanvasItems],
  );

  const updateShotFragmentRefs = useCallback(
    (shotIndex: number, fragmentIds: string[]) => {
      setStoryShots((prev) => {
        if (shotIndex < 0 || shotIndex >= prev.length) return prev;
        const next = [...prev];
        next[shotIndex] = { ...next[shotIndex], fragmentRefs: fragmentIds };
        return next;
      });
    },
    [],
  );

  const value = useMemo<StoryAgentContextValue>(
    () => ({
      messages,
      cards,
      scripts,
      storyShots,
      characters,
      latestScript: scripts.length > 0 ? scripts[scripts.length - 1] : null,
      isReplying,
      isGeneratingScript,
      sendMessage,
      reorderCards,
      removeCard,
      updateCardContent,
      updateScriptMeta,
      updateScriptScene,
      updateStoryShotField,
      generateScript,
      resetConversation,
      activeStoryId,
      remoteStoryId,
      saveStatus,
      lastSavedAt,
      storyList,
      isLoadingStories,
      loadStory,
      createNewStory,
      backToList,
      deleteStory: handleDeleteStory,
      refreshStoryList,
      returningGreeting,
      visualCanvasItems,
      visualPreference,
      imageProvider,
      setImageProvider,
      isArtWorking,
      addVisualReference,
      refineVisualItem,
      updateVisualCanvasItem,
      removeVisualCanvasItem,
      activeSelection,
      setActiveSelection,
      clearSelection,
      sendSelectionEdit,
      promptPool,
      updateShotFragmentRefs,
    }),
    [
      messages,
      cards,
      scripts,
      storyShots,
      characters,
      isReplying,
      isGeneratingScript,
      sendMessage,
      reorderCards,
      removeCard,
      updateCardContent,
      updateScriptMeta,
      updateScriptScene,
      updateStoryShotField,
      generateScript,
      resetConversation,
      activeStoryId,
      remoteStoryId,
      saveStatus,
      lastSavedAt,
      storyList,
      isLoadingStories,
      loadStory,
      createNewStory,
      backToList,
      handleDeleteStory,
      refreshStoryList,
      returningGreeting,
      visualCanvasItems,
      visualPreference,
      imageProvider,
      isArtWorking,
      addVisualReference,
      refineVisualItem,
      updateVisualCanvasItem,
      removeVisualCanvasItem,
      activeSelection,
      setActiveSelection,
      clearSelection,
      sendSelectionEdit,
      promptPool,
      updateShotFragmentRefs,
    ],
  );

  return (
    <StoryAgentContext.Provider value={value}>
      {children}
    </StoryAgentContext.Provider>
  );
}

export function useStoryAgent() {
  const ctx = useContext(StoryAgentContext);
  if (!ctx) throw new Error('useStoryAgent must be used within StoryAgentProvider');
  return ctx;
}
