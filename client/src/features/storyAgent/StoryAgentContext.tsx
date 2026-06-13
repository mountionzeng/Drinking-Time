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
// normalizeImageProvider / ImageProvider 的使用已随出图渠道助手搬到 ./storyAgentImageProvider。
import { trpc } from '@/lib/trpc';
import {
  // OPENING_MESSAGE 现仅被 ./storyAgentPersistence 的 emptyState 使用，本文件不再直接引用。
  buildReturningGreeting,
  normalizeChatMessages,
  type ChatMessage,
  type StoryCard,
  type GeneratedScript,
  type StoryShot,
  type SelectionState,
  type VisualCanvasItem,
} from './types';
import { buildPromptPool } from './promptPool';
// 拆「大脑」：以下逻辑已搬到独立文件，这里改为引入（逻辑完全不变）。
import { getSimilarCards } from './storyCardSimilarity';
import { newId, cardTitle, normalizeVisualCanvasItem, fileToBase64 } from './storyAgentUtils';
import {
  buildCardPhotoMap,
  buildInheritedPhotoReference,
  reconcileInheritedPhotos,
} from './inheritedPhoto';
import {
  type ImageProviderSelection,
  normalizeImageProviderSelection,
  imageProviderForRequest,
} from './storyAgentImageProvider';
import {
  type PersistedState,
  storageKey,
  emptyState,
  loadState,
  findOrphanStory,
  hasStoryWork,
  activeStoryIdFrom,
  hasLiveStoryWork,
} from './storyAgentPersistence';
import {
  artCandidatesNeedConvergence,
  deriveStoryArtRecipe,
  emptyStoryArtDirection,
  normalizeStoryArtDirection,
  type ArtCandidateVerdict,
  type ArtRecipeDNA,
  type StoryArtDirection,
} from '@shared/artDirection';
import {
  buildStoryArtReferences,
  nextReferencePurpose,
} from './storyArtReferences';

// PersistedState、ImageProviderSelection 的定义与一众持久化/出图渠道助手已搬到上面两个模块。
// 对外仍从本文件导出 ImageProviderSelection（StoryCardsBoard 等组件在用，保持引用不变）。
export type { ImageProviderSelection };

type StorySaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
  artDirection: StoryArtDirection;
  setImageProvider: (provider: ImageProviderSelection) => void;
  isArtWorking: boolean;
  addVisualReference: (file: File, instruction?: string, cardId?: string) => Promise<void>;
  refineVisualItem: (id: string, instruction: string) => Promise<void>;
  updateVisualCanvasItem: (id: string, patch: Partial<Pick<VisualCanvasItem, 'x' | 'y' | 'width' | 'height' | 'title'>>) => void;
  removeVisualCanvasItem: (id: string) => void;
  prepareArtDirection: () => void;
  toggleArtReference: (id: string) => void;
  cycleArtReferencePurpose: (id: string) => void;
  generateArtCandidates: (mode?: 'explore' | 'converge') => Promise<void>;
  setArtCandidateVerdict: (id: string, verdict: ArtCandidateVerdict) => Promise<void>;
  reviewArtRecipe: () => Promise<void>;
  updateArtRecipeField: (field: keyof ArtRecipeDNA, values: string[]) => void;
  lockArtRecipe: () => void;
  resetArtDirection: () => void;
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

// 持久化层（PersistedState + storageKey / loadState / findOrphanStory / normalizePersisted /
//   storyWorkScore / hasStoryWork / activeStoryIdFrom / hasLiveStoryWork / emptyState）
//   已搬到 ./storyAgentPersistence。
// 出图渠道助手（normalizeImageProviderSelection / imageProviderForRequest）已搬到 ./storyAgentImageProvider。
// newId / cardTitle / stringList / normalizeVisualCanvasItem / fileToBase64 已搬到 ./storyAgentUtils。
// 以上均见顶部 import，逻辑完全不变。

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
  return normalizeChatMessages(rawMessages, emptyState().messages);
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
      photoUrl: message.photoUrl,
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

/**
 * 把「从外部恢复的故事状态」统一过一遍继承图补挂(收口点)。
 *
 * 故事状态有不止一条恢复路径:① 刷新时从 localStorage hydrate;② 从云端故事库点开某篇(loadStory)。
 * 老卡(功能上线前生成 / 云端早存)名下没有「对话照片」reference 视觉锚,必须在每条恢复路径上都补一次,
 * 否则就出现「这条路补了、那条路没补」的漂移——#18 那张云端老卡看不到继承图,正是 loadStory 漏调所致。
 *
 * 收口到这一个函数:今后新增任何「加载已有故事」的入口,只要调它,就不会再漏。
 * 纯逻辑仍在 inheritedPhoto.ts(可单测);这里只把 newId/Date.now 这类非确定输入兜进来。
 */
function reconcileRestoredVisualItems(
  visualCanvasItems: VisualCanvasItem[],
  cards: ReadonlyArray<Pick<StoryCard, 'id'>>,
  messages: ReadonlyArray<Pick<ChatMessage, 'role' | 'photoUrl' | 'spawnedCardId'>>,
): VisualCanvasItem[] {
  return reconcileInheritedPhotos({
    visualCanvasItems,
    cards,
    cardPhotoMap: buildCardPhotoMap(messages),
    makeId: () => newId('visual'),
    now: Date.now(),
  });
}

function artTargetFrom(cards: StoryCard[], shots: StoryShot[]): string {
  const richestCard = [...cards].sort((left, right) => {
    const leftScore =
      left.content.length +
      (left.sourceQuote?.length ?? 0) +
      left.sensoryDetails.join('').length;
    const rightScore =
      right.content.length +
      (right.sourceQuote?.length ?? 0) +
      right.sensoryDetails.join('').length;
    return rightScore - leftScore;
  })[0];
  if (richestCard) {
    return [
      richestCard.content,
      richestCard.sourceQuote ? `原话：${richestCard.sourceQuote}` : '',
      richestCard.sensoryDetails.length
        ? `感官细节：${richestCard.sensoryDetails.join('、')}`
        : '',
    ]
      .filter(Boolean)
      .join('；')
      .slice(0, 360);
  }
  const firstShot = shots[0];
  return firstShot
    ? [firstShot.subject, firstShot.action, firstShot.location, firstShot.timeLight]
        .filter(Boolean)
        .join('；')
        .slice(0, 360)
    : '';
}

export function StoryAgentProvider({
  projectId,
  onActiveStoryChange,
  children,
}: {
  projectId: number | null;
  // 把"当前打开的故事"向上同步给共享真相源（U4）——故事是唯一单位，
  // Creation 侧（Shot Table / creation 聊天）跟随这个值。
  onActiveStoryChange?: (storyId: number | null) => void;
  children: ReactNode;
}) {
  const utils = trpc.useUtils();
  const chatMut = trpc.storyAgent.chat.useMutation();
  const uploadPhotoMut = trpc.storyAgent.uploadPhoto.useMutation(); // 上传图片用
  const artRiffMut = trpc.artAgent.riff.useMutation();
  const analyzeReferenceMut = trpc.artAgent.analyzeReference.useMutation();
  const artCandidatesMut = trpc.artAgent.generateCandidates.useMutation();
  const imageSignalMut = trpc.storyAgent.recordSignal.useMutation();
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
  const [artDirection, setArtDirection] = useState<StoryArtDirection>(
    emptyStoryArtDirection,
  );
  const [isArtWorking, setIsArtWorking] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  // 向上同步当前故事到共享真相源（U4）。仅同步"真实故事 id"（>0）；新故事草稿(-1)/无故事(null)
  // 对 Creation 侧无意义，归一为 null，让 Shot Table 落空状态而非查无效 id。
  useEffect(() => {
    if (!onActiveStoryChange) return;
    onActiveStoryChange(activeStoryId && activeStoryId > 0 ? activeStoryId : null);
  }, [activeStoryId, onActiveStoryChange]);
  const [saveStatus, setSaveStatus] = useState<StorySaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | undefined>(undefined);
  const [serverRevision, setServerRevision] = useState(0);
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [storyList, setStoryList] = useState<StoryListItem[]>([]);
  // 第二步：老用户点回旧故事时的「我还记得上次……」再问候。纯内存、不落库（见 interface 注释）。
  const [returningGreeting, setReturningGreeting] = useState<string | null>(null);
  const [activeSelection, setActiveSelection] = useState<SelectionState | null>(null);
  const hydratedFor = useRef<number | null>(null);
  const serverRevisionRef = useRef(0);
  const storySaveQueue = useRef<Promise<void>>(Promise.resolve());

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
    // 老卡兜底(本地 hydrate 路):走统一收口的 reconcileRestoredVisualItems,
    // 与 loadStory 共用同一条补挂逻辑,避免两条恢复路漂移。补挂后的数组会经由
    // 下面 PersistedState 的 persist-on-change effect 落回 localStorage。
    setVisualCanvasItems(
      reconcileRestoredVisualItems(
        persisted.visualCanvasItems ?? [],
        persisted.cards,
        persisted.messages,
      ),
    );
    setVisualPreference(persisted.visualPreference ?? '');
    setImageProvider(persisted.imageProvider ?? 'default');
    setArtDirection(normalizeStoryArtDirection(persisted.artDirection));
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
    const restoredRevision = persisted.serverRevision ?? 0;
    serverRevisionRef.current = restoredRevision;
    setServerRevision(restoredRevision);
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
      artDirection,
      savedAt: Date.now(),
      activeStoryId: activeStoryId ?? undefined,
      serverRevision,
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
    artDirection,
    activeStoryId,
    serverRevision,
  ]);

  // ── Auto-save: keep refs in sync ───────────────────────────────────
  useEffect(() => { isReplyingRef.current = isReplying; }, [isReplying]);
  useEffect(() => { isGeneratingScriptRef.current = isGeneratingScript; }, [isGeneratingScript]);

  // Track the last time the editable state changed (for the 2-second inactivity guard)
  useEffect(() => {
    lastStateChangeTimeRef.current = Date.now();
  }, [cards, scripts, storyShots, visualCanvasItems, visualPreference, artDirection]);

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
        artDirection,
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
            artDirection: artDirection as unknown as Record<string, unknown>,
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
    (snapshot: {
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
      artDirection?: StoryArtDirection;
    }): Promise<number | undefined> => {
      if (!hasLiveStoryWork(snapshot)) return Promise.resolve(undefined);
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
      const selectedArtDirection = snapshot.artDirection ?? artDirection;

      const save = async () => {
        try {
          setSaveStatus('saving');
          const saved = await storyUpsertMut.mutateAsync({
            id: snapshot.remoteStoryId ?? remoteStoryId,
            baseRevision:
              (snapshot.remoteStoryId ?? remoteStoryId)
                ? serverRevisionRef.current
                : undefined,
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
              artDirection: selectedArtDirection,
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
            if (!saved.syncConflict && typeof saved.revision === 'number') {
              serverRevisionRef.current = saved.revision;
              setServerRevision(saved.revision);
            }
            // 美术工作台等调用方需要拿到保存后的故事 id（新故事 -1 → 真 id）
            return saved.id;
          }
        } catch (error) {
          console.warn('save archive story failed', error);
          // 保存失败后清掉失效的远端 ID，让下次保存可以重新创建故事。
          setRemoteStoryId(undefined);
          serverRevisionRef.current = 0;
          setServerRevision(0);
          setSaveStatus('error');
          toast.error('云端保存失败，本机仍有临时备份，会继续重试');
        }
        return undefined;
      };
      const queued = storySaveQueue.current.then(save, save);
      storySaveQueue.current = queued.then(
        () => undefined,
        () => undefined
      );
      return queued;
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
      artDirection,
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
      artDirection,
    };
    if (!hasLiveStoryWork(snapshot)) return;

    const currentHash = JSON.stringify({
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        photoUrl: message.photoUrl,
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
      artDirection,
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
    artDirection,
    isReplying,
    isGeneratingScript,
    projectId,
    saveArchiveStory,
  ]);

  const sendMessage = useCallback(
    async (text: string, photoBase64?: string, photoMimeType = "image/jpeg") => {
      const trimmed = text.trim();
      if ((!trimmed && !photoBase64) || isReplying) return;

      setIsReplying(true);
      // 用户重新开口，「我还记得上次」再问候已完成使命——收起，免得卡在新对话中间。
      setReturningGreeting(null);

      try {
        // 如果有照片，先上传——这里要拆成「两个 URL」，用途完全不同：
        //  • photoUrlForLLM ：喂给大模型做多模态识别，必须是 data URL（内联 base64）最稳，
        //    走 storage 托管 URL 反而会有 302 代理抖动导致模型读不到图。
        //  • photoUrlForStore：落库 / 渲染用，优先用 storage 托管 URL，避免把几百 KB 的 base64
        //    塞进 localStorage / 远端故事体里，越攒越大最终撑爆（这就是之前潜伏的隐患）。
        let photoUrlForLLM: string | undefined;
        let photoUrlForStore: string | undefined;
        if (photoBase64) {
          try {
            const uploadResult = await uploadPhotoMut.mutateAsync({
              base64: photoBase64,
              mimeType: photoMimeType,
            });
            if (uploadResult.status === "ok") {
              photoUrlForLLM = uploadResult.url; // data URL，喂给 LLM
              // storedUrl 只在「storage 上传成功」那条分支里才有；fallback 分支没有，
              // 拿不到托管 URL 时就退回 data URL，保证至少能显示出来。
              const stored =
                "storedUrl" in uploadResult ? uploadResult.storedUrl : undefined;
              photoUrlForStore = stored ?? uploadResult.url;
            }
          } catch (err) {
            console.error("[sendMessage] 照片上传失败:", err);
          }
        }

        const userContent = trimmed || "帮我看看这张照片";
        const userMsg: ChatMessage = {
          id: newId('msg'),
          role: 'user',
          content: userContent,
          timestamp: Date.now(),
          photoUrl: photoUrlForStore, // 聊天气泡 / 落库都用托管 URL，不存 base64
        };
        const nextMessages = [...messages, userMsg];
        setMessages(nextMessages);

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
                artDirection: artDirection as unknown as Record<string, unknown>,
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
              artDirection,
            });
          } catch (err) {
            console.warn('[snapshot] captureSnapshot failed, proceeding without context:', err);
          }
        }

        const result = await chatMut.mutateAsync({
          message: userContent,
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
          similarCards: getSimilarCards(userContent, cards),
          projectId: projectId ?? undefined,
          photoUrl: photoUrlForLLM, // 传给 LLM 做多模态理解（data URL 最稳）
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

        // ── 让卡片「继承」对话里发来的照片 ──
        // 只有「这一轮带了照片」且「真的生成了卡片」时，才把原图作为视觉锚挂到该卡片上。
        // 具体构造逻辑抽到了 ./inheritedPhoto（纯函数，便于单测）；返回 null 表示这一轮不挂图。
        // 持久化避开 TDZ：用稳定的 setVisualCanvasItems + 把新数组显式传进 saveArchiveStory，
        // 不碰后面才声明的 persistVisualCanvas（它在 sendMessage 之后定义，放进依赖数组会触发 TDZ）。
        const inheritedRef = buildInheritedPhotoReference({
          photoUrlForStore,
          spawnedCardId,
          existingCount: visualCanvasItems.length,
          id: newId('visual'),
          createdAt: Date.now(),
        });
        let nextVisualItems = visualCanvasItems;
        if (inheritedRef) {
          nextVisualItems = [...visualCanvasItems, inheritedRef];
          setVisualCanvasItems(nextVisualItems);
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
          visualCanvasItems: nextVisualItems, // 把刚挂上的对话照片一起落库，否则会回退到本轮已过期的闭包值
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
      artDirection,
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
        // 合成出的镜头按 storyId 归属（U3）：写到当前打开的故事名下。
        // 只传真实 id(>0)——新故事草稿是 -1，`-1 ?? undefined` 不归一会让服务端
        // getStoryById(-1) 返 null 静默不写镜头（评审 P1）。草稿先不带 storyId。
        storyId: activeStoryId && activeStoryId > 0 ? activeStoryId : undefined,
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
        await utils.shot.list.invalidate(); // 按 storyId 后无差别失效（U5）
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
    setArtDirection(emptyStoryArtDirection());
    setActiveStoryId(-1);
    setSaveStatus('idle');
    setLastSavedAt(undefined);
    serverRevisionRef.current = 0;
    setServerRevision(0);
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
          serverRevisionRef.current = 0;
          setServerRevision(0);
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
    setArtDirection(emptyStoryArtDirection());
    setSaveStatus('idle');
    setLastSavedAt(undefined);
    serverRevisionRef.current = 0;
    setServerRevision(0);
    setReturningGreeting(null);
  }, []);

  const loadStory = useCallback(async (
    id: number,
    options?: { silent?: boolean },
  ) => {
    try {
      // staleTime:0 强制从服务器重拉最新 —— 否则命中缓存会显示旧快照，
      // 看不到另一端（手机）刚加的消息/卡片/图（跨端同步的关键）。
      const row = await utils.storyAgent.storyGet.fetch({ id }, { staleTime: 0 });
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
      const restoredArtDirection = normalizeStoryArtDirection(body.artDirection);

      setRemoteStoryId(id);
      setStoryTitle(row.title || undefined);
      setStoryLogline(row.logline || undefined);
      setStoryTheme(row.theme || undefined);
      setStoryArc(row.arc || undefined);
      setCards(restoredCards);
      setStoryShots(restoredShots);
      setCharacters(restoredCharacters);
      setMessages(restoredMessages);
      // 老卡兜底(云端 loadStory 路):云端早存 / 功能上线前生成的卡名下没有继承图视觉锚,
      // 这里和刷新时的 hydrate 走同一个 reconcileRestoredVisualItems 补挂,不再各写各的。
      setVisualCanvasItems(
        reconcileRestoredVisualItems(
          restoredVisualCanvasItems,
          restoredCards,
          restoredMessages,
        ),
      );
      setVisualPreference(restoredVisualPreference);
      setImageProvider(restoredImageProvider);
      setArtDirection(restoredArtDirection);

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
      const loadedRevision = typeof row.revision === 'number' ? row.revision : 0;
      serverRevisionRef.current = loadedRevision;
      setServerRevision(loadedRevision);

      // 第二步：用这篇真实留存的内容，让小酌说一句「我还记得上次……」把人接回来。
      // 只在这篇有过用户发言时才召回（只有开场白的空壳故事不硬造记忆）。
      const lastCard = restoredCards[restoredCards.length - 1];
      if (!options?.silent) {
        setReturningGreeting(
          buildReturningGreeting({
            hasPriorUserMessages: restoredMessages.some(
              (m) =>
                m.role === 'user' &&
                (m.content.trim().length > 0 || Boolean(m.photoUrl)),
            ),
            logline: row.logline,
            lastCardQuote: lastCard?.sourceQuote || lastCard?.content,
            title: row.title,
          }),
        );
      }
    } catch (error) {
      console.error('loadStory failed', error);
      toast.error('加载故事失败');
    }
  }, [utils.storyAgent.storyGet]);

  useEffect(() => {
    if (!activeStoryId || activeStoryId < 1) return;

    const syncActiveStory = () => {
      if (
        document.visibilityState !== 'visible' ||
        isReplying ||
        isGeneratingScript ||
        saveStatus === 'saving'
      ) {
        return;
      }
      void storySaveQueue.current.then(() =>
        loadStory(activeStoryId, { silent: true }),
      );
    };

    window.addEventListener('focus', syncActiveStory);
    document.addEventListener('visibilitychange', syncActiveStory);
    return () => {
      window.removeEventListener('focus', syncActiveStory);
      document.removeEventListener('visibilitychange', syncActiveStory);
    };
  }, [
    activeStoryId,
    isGeneratingScript,
    isReplying,
    loadStory,
    saveStatus,
  ]);

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
        const result = await analyzeReferenceMut.mutateAsync({
          imageBase64,
          mimeType: file.type || 'image/jpeg',
          fileName: file.name,
          instruction,
        });
        const offset = visualCanvasItems.length * 18;
        const item: VisualCanvasItem = {
          id: newId('visual'),
          title: file.name.replace(/\.[^.]+$/, '') || `视觉锚 ${visualCanvasItems.length + 1}`,
          imageUrl: result.originalImageUrl,
          originalImageUrl: result.originalImageUrl,
          source: 'reference',
          cardId,
          x: 18 + offset,
          y: 18 + offset,
          width: 170,
          height: 218,
          prompt: result.analysis.promptDraft,
          userInstruction: instruction,
          analysis: result.analysis,
          createdAt: Date.now(),
        };
        const nextItems = [...visualCanvasItems, item];
        persistVisualCanvas(nextItems);
        if (artDirection.phase !== 'empty') {
          const targetContent =
            artDirection.targetContent || artTargetFrom(cards, storyShots);
          const existing = new Map(
            artDirection.references.map(reference => [reference.id, reference]),
          );
          const references = buildStoryArtReferences({
            messages,
            cards,
            visualCanvasItems: nextItems,
            targetContent,
          }).map(reference => {
            const prior = existing.get(reference.id);
            return prior
              ? {
                  ...reference,
                  selected: prior.selected,
                  purpose: prior.purpose,
                }
              : reference;
          });
          setArtDirection(current => ({
            ...current,
            phase: current.phase === 'locked' ? 'locked' : 'references',
            targetContent,
            references,
            updatedAt: Date.now(),
          }));
        }
        toast.success(cardId ? '参考图已分析并加入这张卡' : '参考图已分析并加入材料');
      } catch (error) {
        console.error('artAgent.analyzeReference failed', error);
        toast.error(error instanceof Error ? error.message : '美术 Agent 暂时没接上');
      } finally {
        setIsArtWorking(false);
      }
    },
    [
      isArtWorking,
      analyzeReferenceMut,
      visualCanvasItems,
      persistVisualCanvas,
      artDirection,
      cards,
      storyShots,
      messages,
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

  const prepareArtDirection = useCallback(() => {
    const targetContent = artTargetFrom(cards, storyShots);
    if (!targetContent) {
      toast.error('先留下一张故事卡，系统才知道六张图要画同一个什么瞬间');
      return;
    }
    const existing = new Map(
      artDirection.references.map(reference => [reference.id, reference]),
    );
    const references = buildStoryArtReferences({
      messages,
      cards,
      visualCanvasItems,
      targetContent,
    }).map(reference => {
      const prior = existing.get(reference.id);
      return prior
        ? {
            ...reference,
            selected: prior.selected,
            purpose: prior.purpose,
          }
        : reference;
    });
    setArtDirection(current => ({
      ...current,
      phase: 'references',
      targetContent,
      references,
      candidates: [],
      updatedAt: Date.now(),
    }));
  }, [artDirection.references, cards, messages, storyShots, visualCanvasItems]);

  const toggleArtReference = useCallback((id: string) => {
    setArtDirection(current => ({
      ...current,
      references: current.references.map(reference =>
        reference.id === id
          ? { ...reference, selected: !reference.selected }
          : reference,
      ),
      updatedAt: Date.now(),
    }));
  }, []);

  const cycleArtReferencePurpose = useCallback((id: string) => {
    setArtDirection(current => ({
      ...current,
      references: current.references.map(reference =>
        reference.id === id
          ? { ...reference, purpose: nextReferencePurpose(reference.purpose) }
          : reference,
      ),
      updatedAt: Date.now(),
    }));
  }, []);

  const generateArtCandidates = useCallback(
    async (mode: 'explore' | 'converge' = 'explore') => {
      if (isArtWorking) return;
      const selectedReferences = artDirection.references.filter(
        reference => reference.selected,
      );
      if (selectedReferences.length === 0) {
        toast.error('至少保留一份故事材料作为出图依据');
        return;
      }
      const targetContent =
        artDirection.targetContent || artTargetFrom(cards, storyShots);
      if (!targetContent) {
        toast.error('还没有可以画的故事瞬间');
        return;
      }

      setIsArtWorking(true);
      const generatingState: StoryArtDirection = {
        ...artDirection,
        phase: 'generating',
        targetContent,
        updatedAt: Date.now(),
      };
      setArtDirection(generatingState);

      try {
        const storyId =
          remoteStoryId ??
          (await saveArchiveStory({
            messages,
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
            artDirection: generatingState,
          }));
        if (!storyId) {
          throw new Error('故事还没有保存成功，暂时不能记录候选图');
        }

        const nextRound = artDirection.round + 1;
        const likedRecipes =
          mode === 'converge'
            ? artDirection.candidates
                .filter(candidate => candidate.verdict === 'liked')
                .map(candidate => candidate.recipe)
            : undefined;
        const candidates = await artCandidatesMut.mutateAsync({
          storyId,
          targetContent,
          references: artDirection.references,
          round: nextRound,
          mode,
          likedRecipes,
          imageProvider: imageProviderForRequest(imageProvider),
        });
        const nextState: StoryArtDirection = {
          ...generatingState,
          phase: 'selecting',
          round: nextRound,
          candidates,
          updatedAt: Date.now(),
        };
        setArtDirection(nextState);
        void saveArchiveStory({
          messages,
          cards,
          scripts,
          storyShots,
          characters,
          remoteStoryId: storyId,
          title: storyTitle,
          logline: storyLogline,
          theme: storyTheme,
          arc: storyArc,
          visualCanvasItems,
          visualPreference,
          imageProvider,
          artDirection: nextState,
        });
        toast.success(
          mode === 'converge'
            ? '新的收敛候选已生成'
            : '六张独立视觉方向已生成',
        );
      } catch (error) {
        console.error('artAgent.generateCandidates failed', error);
        setArtDirection(current => ({
          ...current,
          phase: current.candidates.length ? 'selecting' : 'references',
          updatedAt: Date.now(),
        }));
        toast.error(error instanceof Error ? error.message : '视觉候选生成失败');
      } finally {
        setIsArtWorking(false);
      }
    },
    [
      isArtWorking,
      artDirection,
      cards,
      storyShots,
      remoteStoryId,
      saveArchiveStory,
      messages,
      scripts,
      characters,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      visualCanvasItems,
      visualPreference,
      imageProvider,
      artCandidatesMut,
    ],
  );

  const setArtCandidateVerdict = useCallback(
    async (id: string, verdict: ArtCandidateVerdict) => {
      const candidate = artDirection.candidates.find(item => item.id === id);
      if (!candidate) return;
      const nextCandidates = artDirection.candidates.map(item =>
        item.id === id ? { ...item, verdict } : item,
      );
      setArtDirection(current => {
        const next = { ...current, candidates: nextCandidates, updatedAt: Date.now() };
        if (current.phase !== 'locked') return next;
        const recipe = deriveStoryArtRecipe(
          nextCandidates,
          current.recipe?.version ?? 0,
        );
        return recipe
          ? {
              ...next,
              recipe,
              recipeVersions: current.recipe
                ? [...current.recipeVersions, current.recipe]
                : current.recipeVersions,
            }
          : next;
      });

      if (remoteStoryId && verdict !== 'pending') {
        try {
          await imageSignalMut.mutateAsync({
            storyId: remoteStoryId,
            imageId: candidate.imageId,
            action: verdict === 'liked' ? 'swipe_right' : 'swipe_left',
            metadata: {
              candidateId: candidate.id,
              candidateRole: candidate.role,
              round: artDirection.round,
              recipe: candidate.recipe,
            },
          });
        } catch (error) {
          console.warn('record art candidate signal failed', error);
        }
      }
    },
    [artDirection, imageSignalMut, remoteStoryId],
  );

  const reviewArtRecipe = useCallback(async () => {
    const liked = artDirection.candidates.filter(
      candidate => candidate.verdict === 'liked',
    );
    if (liked.length === 0) {
      toast.error('先至少喜欢一张，系统才知道该往哪里收');
      return;
    }
    if (artCandidatesNeedConvergence(artDirection.candidates)) {
      await generateArtCandidates('converge');
      return;
    }
    const recipe = deriveStoryArtRecipe(
      artDirection.candidates,
      artDirection.recipe?.version ?? 0,
    );
    if (!recipe) return;
    setArtDirection(current => ({
      ...current,
      phase: 'recipe-review',
      recipe,
      updatedAt: Date.now(),
    }));
  }, [artDirection, generateArtCandidates]);

  const lockArtRecipe = useCallback(() => {
    setArtDirection(current => {
      if (!current.recipe) return current;
      const alreadyStored = current.recipeVersions.some(
        recipe => recipe.version === current.recipe?.version,
      );
      return {
        ...current,
        phase: 'locked',
        recipeVersions: alreadyStored
          ? current.recipeVersions
          : [...current.recipeVersions, current.recipe],
        updatedAt: Date.now(),
      };
    });
    toast.success('故事视觉配方已锁定，后续镜头会默认继承');
  }, []);

  const updateArtRecipeField = useCallback(
    (field: keyof ArtRecipeDNA, values: string[]) => {
      setArtDirection(current =>
        current.recipe
          ? {
              ...current,
              recipe: {
                ...current.recipe,
                [field]: Array.from(
                  new Set(values.map(value => value.trim()).filter(Boolean)),
                ),
                updatedAt: Date.now(),
              },
              updatedAt: Date.now(),
            }
          : current,
      );
    },
    [],
  );

  const resetArtDirection = useCallback(() => {
    const targetContent = artTargetFrom(cards, storyShots);
    const references = buildStoryArtReferences({
      messages,
      cards,
      visualCanvasItems,
      targetContent,
    });
    setArtDirection(current => ({
      ...emptyStoryArtDirection(),
      phase: 'references',
      targetContent,
      references,
      recipeVersions: current.recipe
        ? [...current.recipeVersions, current.recipe]
        : current.recipeVersions,
      updatedAt: Date.now(),
    }));
  }, [cards, messages, storyShots, visualCanvasItems]);

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
      artDirection,
      setImageProvider,
      isArtWorking,
      addVisualReference,
      refineVisualItem,
      updateVisualCanvasItem,
      removeVisualCanvasItem,
      prepareArtDirection,
      toggleArtReference,
      cycleArtReferencePurpose,
      generateArtCandidates,
      setArtCandidateVerdict,
      reviewArtRecipe,
      updateArtRecipeField,
      lockArtRecipe,
      resetArtDirection,
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
      artDirection,
      isArtWorking,
      addVisualReference,
      refineVisualItem,
      updateVisualCanvasItem,
      removeVisualCanvasItem,
      prepareArtDirection,
      toggleArtReference,
      cycleArtReferencePurpose,
      generateArtCandidates,
      setArtCandidateVerdict,
      reviewArtRecipe,
      updateArtRecipeField,
      lockArtRecipe,
      resetArtDirection,
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
