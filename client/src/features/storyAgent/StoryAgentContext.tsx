/**
 * StoryAgentContext — shared store for chat messages, cards, and generated scripts
 *
 * State is keyed by projectId and persisted to localStorage so reloads keep
 * the conversation in place.
 */
import {
  createContext,
  useContext,
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
import type { GeneratedImageItem } from '@/features/mobileChat/types';
// 拆「大脑」：以下逻辑已搬到独立文件，这里改为引入（逻辑完全不变）。
import { getSimilarCards } from './storyCardSimilarity';
import { removeStoryCardFromSnapshot } from './storyCardDeletion';
import { newId, cardTitle, normalizeVisualCanvasItem, fileToBase64 } from './storyAgentUtils';
import { buildStoryboardDraftPrompt, pickStoryboardDraftShots } from './storyboardDrafts';
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
  emptyStoryArtDirection,
  normalizeStoryArtDirection,
  type StoryArtDirection,
} from '@shared/artDirection';
import { buildStoryArtReferences } from './storyArtReferences';
import { normalizeStoryIntent, type StoryIntent } from './intentTypes';
import {
  storySpineStore,
  useStorySpine,
  type StoryListItem,
  type StorySaveStatus,
} from './spine/storySpine';
import { createActionFacade } from './spine/actionFacade';
import { selectPromptPool } from './spine/selectors';

// PersistedState、ImageProviderSelection 的定义与一众持久化/出图渠道助手已搬到上面两个模块。
// 对外仍从本文件导出 ImageProviderSelection（StoryCardsBoard 等组件在用，保持引用不变）。
export type { ImageProviderSelection };

export type { StoryListItem };

/** 意图确认关传给 generateScript 的确认意图（影响剧本取向）。 */
export type ScriptIntentArg = StoryIntent;

export type StoryChatIntentArg = Pick<
  StoryIntent,
  'purpose' | 'audience' | 'platform' | 'tone' | 'desiredEffect' | 'targetRole' | 'channel'
>;

export function buildChatIntentPayload(
  confirmedIntent: StoryIntent | null | undefined,
): StoryChatIntentArg | undefined {
  if (!confirmedIntent) return undefined;
  return {
    purpose: confirmedIntent.purpose,
    audience: confirmedIntent.audience,
    platform: confirmedIntent.platform,
    tone: confirmedIntent.tone,
    desiredEffect: confirmedIntent.desiredEffect,
    targetRole: confirmedIntent.targetRole,
    channel: confirmedIntent.channel,
  };
}

export function resolveScriptIntent(
  overrideIntent: ScriptIntentArg | null | undefined,
  confirmedIntent: StoryIntent | null,
): StoryIntent | undefined {
  return overrideIntent ?? confirmedIntent ?? undefined;
}

export const JOB_INTENT_CONFIDENCE_THRESHOLD = 0.6;

export function shouldTriggerIntentRecognition({
  messages,
  confirmedIntent,
  pendingIntentDraft,
}: {
  messages: ChatMessage[];
  confirmedIntent: StoryIntent | null;
  pendingIntentDraft: StoryIntent | null;
}): boolean {
  if (confirmedIntent || pendingIntentDraft) return false;
  return !messages.some(
    (message) => message.role === 'user' && (message.content.trim() || message.photoUrl),
  );
}

export function recognitionToPendingJobIntent(intent: StoryIntent): StoryIntent | null {
  if (intent.purpose !== 'linkedin_job_search') return null;
  if ((intent.confidence ?? 0) < JOB_INTENT_CONFIDENCE_THRESHOLD) return null;
  return intent;
}

export function warnIntentRecognitionError(error: unknown) {
  console.warn(
    '[storyAgent.intent] recognizeIntent failed:',
    error instanceof Error ? error.message : error,
  );
}

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
  confirmedIntent: StoryIntent | null;
  setConfirmedIntent: (intent: StoryIntent | null) => void;
  clearIntent: () => void;
  pendingIntentDraft: StoryIntent | null;
  confirmPendingIntent: () => void;
  dismissPendingIntent: () => void;
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
    field: 'subject' | 'action' | 'dialogue' | 'emotion',
    value: string,
  ) => void;
  generateScript: (intent?: ScriptIntentArg) => Promise<void>;
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
  /** 「把这一刻画出来」收下的故事画面（故事版 / Story Cards 读这个）。 */
  storyImages: GeneratedImageItem[];
  /** 收下一张故事画面：去重追加并持久化到 body.mobileImages。 */
  addStoryImage: (image: GeneratedImageItem) => void;
  /** 删除一张已选择故事画面：先从本地故事版移除，后端信号由调用方记录。 */
  removeStoryImage: (imageId: number) => void;
  imageProvider: ImageProviderSelection;
  artDirection: StoryArtDirection;
  setImageProvider: (provider: ImageProviderSelection) => void;
  isArtWorking: boolean;
  addVisualReference: (file: File, instruction?: string, cardId?: string) => Promise<void>;
  refineVisualItem: (id: string, instruction: string) => Promise<void>;
  updateVisualCanvasItem: (id: string, patch: Partial<Pick<VisualCanvasItem, 'x' | 'y' | 'width' | 'height' | 'title'>>) => void;
  removeVisualCanvasItem: (id: string) => void;
  setCharacterReferenceByUrl: (imageUrl: string, label?: string) => void;
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

type StoryAgentActionKey =
  | 'setConfirmedIntent'
  | 'clearIntent'
  | 'confirmPendingIntent'
  | 'dismissPendingIntent'
  | 'sendMessage'
  | 'reorderCards'
  | 'removeCard'
  | 'updateCardContent'
  | 'updateScriptMeta'
  | 'updateScriptScene'
  | 'updateStoryShotField'
  | 'generateScript'
  | 'resetConversation'
  | 'loadStory'
  | 'createNewStory'
  | 'backToList'
  | 'deleteStory'
  | 'refreshStoryList'
  | 'setImageProvider'
  | 'addVisualReference'
  | 'refineVisualItem'
  | 'updateVisualCanvasItem'
  | 'removeVisualCanvasItem'
  | 'setCharacterReferenceByUrl'
  | 'setActiveSelection'
  | 'clearSelection'
  | 'sendSelectionEdit'
  | 'addStoryImage'
  | 'removeStoryImage'
  | 'updateShotFragmentRefs';

export type StoryAgentActions = Pick<StoryAgentContextValue, StoryAgentActionKey>;

const storyAgentActionKeys = [
  'setConfirmedIntent',
  'clearIntent',
  'confirmPendingIntent',
  'dismissPendingIntent',
  'sendMessage',
  'reorderCards',
  'removeCard',
  'updateCardContent',
  'updateScriptMeta',
  'updateScriptScene',
  'updateStoryShotField',
  'generateScript',
  'resetConversation',
  'loadStory',
  'createNewStory',
  'backToList',
  'deleteStory',
  'refreshStoryList',
  'setImageProvider',
  'addVisualReference',
  'refineVisualItem',
  'updateVisualCanvasItem',
  'removeVisualCanvasItem',
  'setCharacterReferenceByUrl',
  'setActiveSelection',
  'clearSelection',
  'sendSelectionEdit',
  'addStoryImage',
  'removeStoryImage',
  'updateShotFragmentRefs',
] as const satisfies readonly StoryAgentActionKey[];

const StoryAgentActionsContext = createContext<StoryAgentActions | null>(null);

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
  const nullableStr = (v: unknown) => (typeof v === 'string' ? v : null);
  const promptRun =
    obj.promptRun && typeof obj.promptRun === 'object' && !Array.isArray(obj.promptRun)
      ? obj.promptRun as StoryShot['promptRun']
      : undefined;
  const narrativeJob =
    obj.narrativeJob && typeof obj.narrativeJob === 'object' && !Array.isArray(obj.narrativeJob)
      ? obj.narrativeJob as StoryShot['narrativeJob']
      : undefined;
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
    intent: nullableStr(obj.intent),
    rationale: nullableStr(obj.rationale),
    videoStart: str(obj.videoStart),
    videoEnd: str(obj.videoEnd),
    transitionIn: str(obj.transitionIn),
    transitionOut: str(obj.transitionOut),
    videoPrompt: str(obj.videoPrompt),
    emotionCharge: str(obj.emotionCharge),
    emotionDelta: str(obj.emotionDelta),
    visualAnchorText: str(obj.visualAnchorText),
    promptDraft: str(obj.promptDraft),
    negativePrompt: str(obj.negativePrompt),
    narrativeJob,
    promptRun,
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
  const classifyMut = trpc.storyAgent.classify.useMutation();
  const storyboardImageMut = trpc.storyAgent.generateForMobile.useMutation();
  const recognizeIntentMut = trpc.storyAgent.recognizeIntent.useMutation();
  const storyUpsertMut = trpc.storyAgent.storyUpsert.useMutation();
  const storyDeleteMut = trpc.storyAgent.storyDelete.useMutation();
  const saveSnapshotMut = trpc.editContext.saveSnapshot.useMutation();

  const messages = useStorySpine((state) => state.messages);
  const cards = useStorySpine((state) => state.cards);
  const scripts = useStorySpine((state) => state.scripts);
  const storyShots = useStorySpine((state) => state.storyShots);
  const characters = useStorySpine((state) => state.characters);
  const remoteStoryId = useStorySpine((state) => state.remoteStoryId);
  const storyTitle = useStorySpine((state) => state.storyTitle);
  const storyLogline = useStorySpine((state) => state.storyLogline);
  const storyTheme = useStorySpine((state) => state.storyTheme);
  const storyArc = useStorySpine((state) => state.storyArc);
  const visualCanvasItems = useStorySpine((state) => state.visualCanvasItems);
  const visualPreference = useStorySpine((state) => state.visualPreference);
  const storyImages = useStorySpine((state) => state.storyImages);
  const imageProvider = useStorySpine((state) => state.imageProvider);
  const artDirection = useStorySpine((state) => state.artDirection);
  const isArtWorking = useStorySpine((state) => state.isArtWorking);
  const isReplying = useStorySpine((state) => state.isReplying);
  const isGeneratingScript = useStorySpine((state) => state.isGeneratingScript);
  const confirmedIntent = useStorySpine((state) => state.confirmedIntent);
  const pendingIntentDraft = useStorySpine((state) => state.pendingIntentDraft);
  const activeStoryId = useStorySpine((state) => state.activeStoryId);
  const saveStatus = useStorySpine((state) => state.saveStatus);
  const lastSavedAt = useStorySpine((state) => state.lastSavedAt);
  const serverRevision = useStorySpine((state) => state.serverRevision);
  const isLoadingStories = useStorySpine((state) => state.isLoadingStories);
  const storyList = useStorySpine((state) => state.storyList);
  const returningGreeting = useStorySpine((state) => state.returningGreeting);
  const activeSelection = useStorySpine((state) => state.activeSelection);
  const hydratedFor = useStorySpine((state) => state.hydratedFor);

  const setMessages = useStorySpine((state) => state.setMessages);
  const setCards = useStorySpine((state) => state.setCards);
  const setScripts = useStorySpine((state) => state.setScripts);
  const setStoryShots = useStorySpine((state) => state.setStoryShots);
  const setCharacters = useStorySpine((state) => state.setCharacters);
  const setRemoteStoryId = useStorySpine((state) => state.setRemoteStoryId);
  const setStoryTitle = useStorySpine((state) => state.setStoryTitle);
  const setStoryLogline = useStorySpine((state) => state.setStoryLogline);
  const setStoryTheme = useStorySpine((state) => state.setStoryTheme);
  const setStoryArc = useStorySpine((state) => state.setStoryArc);
  const setVisualCanvasItems = useStorySpine((state) => state.setVisualCanvasItems);
  const setVisualPreference = useStorySpine((state) => state.setVisualPreference);
  const setStoryImages = useStorySpine((state) => state.setStoryImages);
  const setImageProvider = useStorySpine((state) => state.setImageProvider);
  const setArtDirection = useStorySpine((state) => state.setArtDirection);
  const setIsArtWorking = useStorySpine((state) => state.setIsArtWorking);
  const setIsReplying = useStorySpine((state) => state.setIsReplying);
  const setIsGeneratingScript = useStorySpine((state) => state.setIsGeneratingScript);
  const setConfirmedIntent = useStorySpine((state) => state.setConfirmedIntent);
  const setPendingIntentDraft = useStorySpine((state) => state.setPendingIntentDraft);
  const setActiveStoryId = useStorySpine((state) => state.setActiveStoryId);
  const setSaveStatus = useStorySpine((state) => state.setSaveStatus);
  const setLastSavedAt = useStorySpine((state) => state.setLastSavedAt);
  const setServerRevision = useStorySpine((state) => state.setServerRevision);
  const setIsLoadingStories = useStorySpine((state) => state.setIsLoadingStories);
  const setStoryList = useStorySpine((state) => state.setStoryList);
  const setReturningGreeting = useStorySpine((state) => state.setReturningGreeting);
  const setActiveSelection = useStorySpine((state) => state.setActiveSelection);
  const setHydratedFor = useStorySpine((state) => state.setHydratedFor);
  const setLastSnapshotHash = useStorySpine((state) => state.setLastSnapshotHash);
  const setLastArchiveSaveHash = useStorySpine((state) => state.setLastArchiveSaveHash);
  const setLastStateChangeTime = useStorySpine((state) => state.setLastStateChangeTime);
  const setLastSnapshotId = useStorySpine((state) => state.setLastSnapshotId);

  // 向上同步当前故事到共享真相源（U4）。仅同步"真实故事 id"（>0）；新故事草稿(-1)/无故事(null)
  // 对 Creation 侧无意义，归一为 null，让 Shot Table 落空状态而非查无效 id。
  useEffect(() => {
    if (!onActiveStoryChange) return;
    onActiveStoryChange(activeStoryId && activeStoryId > 0 ? activeStoryId : null);
  }, [activeStoryId, onActiveStoryChange]);
  const storySaveQueue = useRef<Promise<void>>(Promise.resolve());

  // Hydrate from localStorage when projectId becomes available / changes
  useEffect(() => {
    if (projectId === null) return;
    if (hydratedFor === projectId) return;
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
    setStoryImages(persisted.mobileImages ?? []);
    setImageProvider(persisted.imageProvider ?? 'default');
    setArtDirection(normalizeStoryArtDirection(persisted.artDirection));
    setConfirmedIntent(persisted.confirmedIntent ?? null);
    setPendingIntentDraft(null);
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
    setServerRevision(restoredRevision);
    setHydratedFor(projectId);
  }, [
    hydratedFor,
    projectId,
    setActiveStoryId,
    setArtDirection,
    setCards,
    setCharacters,
    setConfirmedIntent,
    setHydratedFor,
    setImageProvider,
    setLastSavedAt,
    setMessages,
    setPendingIntentDraft,
    setRemoteStoryId,
    setSaveStatus,
    setScripts,
    setServerRevision,
    setStoryArc,
    setStoryImages,
    setStoryLogline,
    setStoryShots,
    setStoryTheme,
    setStoryTitle,
    setVisualCanvasItems,
    setVisualPreference,
  ]);

  // Story loading is now handled explicitly via loadStory() from the story list.

  // Persist on change
  useEffect(() => {
    const key = storageKey(projectId);
    if (!key || hydratedFor !== projectId) return;
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
      mobileImages: storyImages,
      imageProvider,
      artDirection,
      confirmedIntent,
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
    storyImages,
    imageProvider,
    artDirection,
    confirmedIntent,
    activeStoryId,
    hydratedFor,
    serverRevision,
  ]);

  // Track the last time the editable state changed (for the 2-second inactivity guard)
  useEffect(() => {
    setLastStateChangeTime(Date.now());
  }, [
    artDirection,
    cards,
    scripts,
    setLastStateChangeTime,
    storyShots,
    visualCanvasItems,
    visualPreference,
  ]);

  // ── Auto-save: 5-minute timer ───────────────────────────────────────
  useEffect(() => {
    if (projectId === null) return;

    const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000;
    const INACTIVITY_THRESHOLD_MS = 2_000;

    const timerId = setInterval(() => {
      const current = storySpineStore.getState();
      // Skip while Agent is actively generating
      if (current.isReplying || current.isGeneratingScript) return;

      // Lightweight hash: card/script/shot IDs + card count
      const currentHash = JSON.stringify({
        cardIds: current.cards.map((c) => c.id),
        scriptIds: current.scripts.map((s) => s.id),
        shotNos: current.storyShots.map((s) => s.shotNo),
        cardContents: current.cards.map((c) => c.content),
        visualIds: current.visualCanvasItems.map((item) => item.id),
        visualPreference: current.visualPreference,
        artDirection: current.artDirection,
      });

      // Skip if nothing changed since last snapshot
      if (currentHash === current.lastSnapshotHash) return;

      // Skip if the user has been active within the last 2 seconds
      if (Date.now() - current.lastStateChangeTime < INACTIVITY_THRESHOLD_MS) return;

      current.setLastSnapshotHash(currentHash);

      saveSnapshotMut.mutate(
        {
          projectId,
          sessionId: current.sessionId,
          state: {
            cards: current.cards as unknown as Record<string, unknown>[],
            script: current.scripts as unknown as Record<string, unknown>[],
            shots: current.storyShots as unknown as Record<string, unknown>[],
            visualCanvasItems: current.visualCanvasItems as unknown as Record<string, unknown>[],
            visualPreference: current.visualPreference,
            artDirection: current.artDirection as unknown as Record<string, unknown>,
          },
          autoSave: true,
        },
        {
          onError: (err) => {
            console.warn('[autoSave] snapshot failed, will retry next interval:', err);
            // Revert hash so the next timer tick retries
            storySpineStore.getState().setLastSnapshotHash('');
          },
        },
      );
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearInterval(timerId);
  }, [projectId, saveSnapshotMut]);

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
      const current = storySpineStore.getState();
      const latest =
        snapshot.scripts.length > 0
          ? snapshot.scripts[snapshot.scripts.length - 1]
          : null;
      const title =
        snapshot.title ||
        current.storyTitle ||
        latest?.title ||
        snapshot.cards[0]?.title ||
        '未命名故事';
      const logline = snapshot.logline ?? current.storyLogline ?? latest?.logline ?? '';
      const theme = snapshot.theme ?? current.storyTheme ?? latest?.theme ?? '';
      const arc = snapshot.arc ?? current.storyArc ?? latest?.arcSummary ?? '';
      const canvasItems = snapshot.visualCanvasItems ?? current.visualCanvasItems;
      const preference = snapshot.visualPreference ?? current.visualPreference;
      const selectedProvider = snapshot.imageProvider ?? current.imageProvider;
      const selectedArtDirection = snapshot.artDirection ?? current.artDirection;

      const save = async () => {
        try {
          const latestState = storySpineStore.getState();
          const storyId = snapshot.remoteStoryId ?? latestState.remoteStoryId;
          setSaveStatus('saving');
          const saved = await storyUpsertMut.mutateAsync({
            id: storyId,
            baseRevision: storyId ? latestState.serverRevision : undefined,
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
              mobileImages: latestState.storyImages,
              imageProvider: selectedProvider,
              artDirection: selectedArtDirection,
              confirmedIntent: latestState.confirmedIntent,
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
              setServerRevision(saved.revision);
            }
            // 美术工作台等调用方需要拿到保存后的故事 id（新故事 -1 → 真 id）
            return saved.id;
          }
        } catch (error) {
          console.warn('save archive story failed', error);
          // 保存失败后清掉失效的远端 ID，让下次保存可以重新创建故事。
          setRemoteStoryId(undefined);
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
      setActiveStoryId,
      setLastSavedAt,
      setRemoteStoryId,
      setSaveStatus,
      setServerRevision,
      storyUpsertMut,
    ],
  );

  useEffect(() => {
    if (projectId !== null && hydratedFor !== projectId) return;
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
      mobileImageIds: storyImages.map((image) => image.id),
      imageProvider,
      artDirection,
    });
    if (currentHash === storySpineStore.getState().lastArchiveSaveHash) return;

    const timerId = window.setTimeout(() => {
      setLastArchiveSaveHash(currentHash);
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
    storyImages,
    imageProvider,
    artDirection,
    isReplying,
    isGeneratingScript,
    projectId,
    saveArchiveStory,
    hydratedFor,
    setLastArchiveSaveHash,
  ]);

  const recognizeJobIntentFromHistory = useCallback(
    async (history: ChatMessage[]) => {
      try {
        const result = await recognizeIntentMut.mutateAsync({
          history: history
            .filter((message) => message.content.trim())
            .map((message) => ({
              role: message.role as 'user' | 'assistant',
              content: message.content,
            })),
        });
        const pending = recognitionToPendingJobIntent(result as StoryIntent);
        if (!pending) return;
        const { confirmedIntent, pendingIntentDraft } = storySpineStore.getState();
        if (confirmedIntent || pendingIntentDraft) return;
        setPendingIntentDraft(pending);
      } catch (error) {
        warnIntentRecognitionError(error);
      }
    },
    [recognizeIntentMut, setPendingIntentDraft],
  );

  const sendMessage = useCallback(
    async (text: string, photoBase64?: string, photoMimeType = "image/jpeg") => {
      const trimmed = text.trim();
      if ((!trimmed && !photoBase64) || isReplying) return;
      const shouldRecognizeIntent = shouldTriggerIntentRecognition({
        messages,
        confirmedIntent,
        pendingIntentDraft,
      });
      if (
        confirmedIntent?.purpose === 'linkedin_job_search' &&
        !confirmedIntent.jobMaterialsPrompted &&
        confirmedIntent.targetRole !== undefined &&
        confirmedIntent.channel !== undefined
      ) {
        setConfirmedIntent({ ...confirmedIntent, jobMaterialsPrompted: true });
      }

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
              sessionId: storySpineStore.getState().sessionId,
              state: {
                cards: cards as unknown as Record<string, unknown>[],
                script: scripts as unknown as Record<string, unknown>[],
                shots: storyShots as unknown as Record<string, unknown>[],
                visualCanvasItems: visualCanvasItems as unknown as Record<string, unknown>[],
                visualPreference,
                artDirection: artDirection as unknown as Record<string, unknown>,
              },
            });
            setLastSnapshotId(snapshotResult.snapshotId);
            // Sync hash so the auto-save timer doesn't duplicate this snapshot
            setLastSnapshotHash(JSON.stringify({
              cardIds: cards.map((c) => c.id),
              scriptIds: scripts.map((s) => s.id),
              shotNos: storyShots.map((s) => s.shotNo),
              cardContents: cards.map((c) => c.content),
              visualIds: visualCanvasItems.map((item) => item.id),
              visualPreference,
              artDirection,
            }));
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
          storyCards: cards.map((card) => ({
            title: card.title,
            content: card.content,
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
          similarCards: getSimilarCards(userContent, cards),
          projectId: projectId ?? undefined,
          photoUrl: photoUrlForLLM, // 传给 LLM 做多模态理解（data URL 最稳）
          confirmedIntent: buildChatIntentPayload(confirmedIntent),
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
        if (shouldRecognizeIntent) {
          void recognizeJobIntentFromHistory(nextMessages);
        }

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
      confirmedIntent,
      pendingIntentDraft,
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
      recognizeJobIntentFromHistory,
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
      const {
        cards: nextCards,
        storyShots: nextStoryShots,
        visualCanvasItems: nextVisualCanvasItems,
        removedCard,
      } = removeStoryCardFromSnapshot(
        { cards, storyShots, visualCanvasItems },
        id,
      );
      if (!removedCard) return;
      setCards(nextCards);
      setStoryShots(nextStoryShots);
      setVisualCanvasItems(nextVisualCanvasItems);
      void saveArchiveStory({
        messages,
        cards: nextCards,
        scripts,
        storyShots: nextStoryShots,
        characters,
        remoteStoryId,
        visualCanvasItems: nextVisualCanvasItems,
        title: storyTitle,
        logline: storyLogline,
        theme: storyTheme,
        arc: storyArc,
      });
    },
    [
      cards,
      storyShots,
      visualCanvasItems,
      messages,
      scripts,
      characters,
      remoteStoryId,
      storyTitle,
      storyLogline,
      storyTheme,
      storyArc,
      setVisualCanvasItems,
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
    (index: number, field: 'subject' | 'action' | 'dialogue' | 'emotion', value: string) => {
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

  const generateScript = useCallback(async (intent?: ScriptIntentArg) => {
    if (cards.length === 0) {
      toast.error('先生成卡片再合成剧本');
      return;
    }
    if (isGeneratingScript) return;
    setIsGeneratingScript(true);

    try {
      const effectiveIntent = resolveScriptIntent(intent, confirmedIntent);
      const result = await classifyMut.mutateAsync({
        cards: cards.map((card) => ({
          title: card.title,
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
        // 意图确认关确认过的意图（缺省时与接入前完全一致）。
        confirmedIntent: effectiveIntent
          ? {
              purpose: effectiveIntent.purpose,
              audience: effectiveIntent.audience,
              platform: effectiveIntent.platform,
              tone: effectiveIntent.tone ?? '',
              desiredEffect: effectiveIntent.desiredEffect ?? '',
              targetRole: effectiveIntent.targetRole,
              channel: effectiveIntent.channel,
            }
          : undefined,
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

      const savedStoryId = await saveArchiveStory({
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
      const storyboardStoryId =
        activeStoryId && activeStoryId > 0 ? activeStoryId : savedStoryId;
      let generatedDraftCount = 0;
      let failedDraftCount = 0;
      if (storyboardStoryId) {
        const draftShots = pickStoryboardDraftShots(nextShots);
        const generatedDrafts: GeneratedImageItem[] = [];
        for (const shot of draftShots) {
          try {
            const imageResult = await storyboardImageMut.mutateAsync({
              storyId: storyboardStoryId,
              shotNo: shot.shotNo,
              prompt: buildStoryboardDraftPrompt(shot),
              mode: 'draft',
              sceneWeight: 0.5,
            });
            if (
              imageResult.status === 'ok' &&
              imageResult.imageUrl &&
              typeof imageResult.imageId === 'number'
            ) {
              generatedDraftCount += 1;
              generatedDrafts.push({
                id: imageResult.imageId,
                imageUrl: imageResult.imageUrl,
                prompt: imageResult.prompt ?? buildStoryboardDraftPrompt(shot),
                shotNo: shot.shotNo,
                storyId: storyboardStoryId,
                status: imageResult.mode === 'draft' ? 'draft' : 'ready',
              });
            } else {
              failedDraftCount += 1;
            }
          } catch (error) {
            failedDraftCount += 1;
            console.warn('[storyboard] draft frame generation failed', error);
          }
        }
        if (generatedDrafts.length > 0) {
          setStoryImages((prev) => {
            const byId = new Map(prev.map((image) => [image.id, image]));
            for (const image of generatedDrafts) byId.set(image.id, image);
            return Array.from(byId.values());
          });
          await utils.storyAgent.storyImages.invalidate({ storyId: storyboardStoryId });
          await utils.storyAgent.storyGet.invalidate({ id: storyboardStoryId });
        }
      }
      if (projectId !== null) {
        await utils.shot.list.invalidate(); // 按 storyId 后无差别失效（U5）
      }
      if (generatedDraftCount > 0) {
        toast.success(`故事版已生成：${script.title} · ${generatedDraftCount} 张关键帧草稿`);
      } else {
        toast.success(`故事版已生成：${script.title}`);
      }
      // Auto-open animatic & storyboard panels so the user sees the result.
      const currentPanels = storySpineStore.getState().visibleStoryPanels;
      const panelsToAdd: Array<'animatic' | 'storyboard'> = [];
      if (!currentPanels.includes('animatic')) panelsToAdd.push('animatic');
      if (!currentPanels.includes('storyboard')) panelsToAdd.push('storyboard');
      if (panelsToAdd.length > 0) {
        storySpineStore.getState().setVisibleStoryPanels([
          ...currentPanels,
          ...panelsToAdd,
        ]);
      }
      if (failedDraftCount > 0) {
        toast.error(`${failedDraftCount} 张关键帧草稿没画成，剧本和提示词已保留`);
      }
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
    confirmedIntent,
    isGeneratingScript,
    messages,
    projectId,
    scripts,
    activeStoryId,
    remoteStoryId,
    storyTitle,
    storyboardImageMut,
    setStoryImages,
    utils.storyAgent.storyImages,
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
    setStoryImages([]);
    setArtDirection(emptyStoryArtDirection());
    setActiveStoryId(-1);
    setSaveStatus('idle');
    setLastSavedAt(undefined);
    setServerRevision(0);
    setReturningGreeting(null);
    setConfirmedIntent(null);
    setPendingIntentDraft(null);
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
    setStoryImages([]);
    setImageProvider('default');
    setArtDirection(emptyStoryArtDirection());
    setSaveStatus('idle');
    setLastSavedAt(undefined);
    setServerRevision(0);
    setReturningGreeting(null);
    setConfirmedIntent(null);
    setPendingIntentDraft(null);
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
      const restoredMobileImages = Array.isArray(body.mobileImages)
        ? (body.mobileImages as GeneratedImageItem[])
        : [];
      const restoredImageProvider = normalizeImageProviderSelection(body.imageProvider);
      const restoredArtDirection = normalizeStoryArtDirection(body.artDirection);
      const restoredConfirmedIntent = normalizeStoryIntent(body.confirmedIntent);

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
      setStoryImages(restoredMobileImages);
      setImageProvider(restoredImageProvider);
      setArtDirection(restoredArtDirection);
      setConfirmedIntent(restoredConfirmedIntent);
      setPendingIntentDraft(null);

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

      // Auto-open panels if the loaded story has shots (previously generated storyboard).
      if (restoredShots.length > 0) {
        const currentPanels = storySpineStore.getState().visibleStoryPanels;
        const panelsToAdd: Array<'animatic' | 'storyboard'> = [];
        if (!currentPanels.includes('storyboard')) panelsToAdd.push('storyboard');
        if (!currentPanels.includes('animatic')) panelsToAdd.push('animatic');
        if (panelsToAdd.length > 0) {
          storySpineStore.getState().setVisibleStoryPanels([
            ...currentPanels,
            ...panelsToAdd,
          ]);
        }
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
    setConfirmedIntent(null);
    setPendingIntentDraft(null);
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

  // 把某张参考图设为「主角参照」（单选）—— 跨镜头锁人物长相的依据。
  // 桥接：镜头照片(visualCanvasItems)的 imageUrl 若已在 references 则升级它、否则新建一条，
  // 并清掉其他主角标记。后端 characterReferenceOf 读取 role:'character' 注入 MJ --cref。
  const setCharacterReferenceByUrl = useCallback((imageUrl: string, label?: string) => {
    setArtDirection(current => {
      const cleared = current.references.map(reference =>
        reference.role === 'character' && reference.imageUrl !== imageUrl
          ? { ...reference, role: undefined }
          : reference,
      );
      const existingIdx = cleared.findIndex(reference => reference.imageUrl === imageUrl);
      const references =
        existingIdx >= 0
          ? cleared.map((reference, i) =>
              i === existingIdx
                ? {
                    ...reference,
                    role: 'character' as const,
                    selected: true,
                    purpose:
                      reference.purpose === 'aesthetic' ? ('both' as const) : reference.purpose,
                  }
                : reference,
            )
          : [
              {
                id: newId('charref'),
                label: label || '主角参照',
                source: 'visual-anchor' as const,
                purpose: 'fact' as const,
                selected: true,
                role: 'character' as const,
                imageUrl,
              },
              ...cleared,
            ];
      return { ...current, references, updatedAt: Date.now() };
    });
  }, []);

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
              sessionId: storySpineStore.getState().sessionId,
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
  const promptPool = selectPromptPool(storySpineStore.getState());

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

  // 收下一张故事画面：去重追加（同 id 覆盖）。state 变更经 autosave 落 body.mobileImages，
  // 故事版 / Story Cards 直接读 context.storyImages，即时可见。
  const addStoryImage = useCallback((image: GeneratedImageItem) => {
    setStoryImages((prev) => {
      const without = prev.filter((item) => item.id !== image.id);
      return [...without, image];
    });
  }, []);

  const removeStoryImage = useCallback((imageId: number) => {
    setStoryImages((prev) => prev.filter((item) => item.id !== imageId));
  }, []);

  const clearIntent = useCallback(() => {
    setConfirmedIntent(null);
  }, []);

  const confirmPendingIntent = useCallback(() => {
    if (pendingIntentDraft) setConfirmedIntent(pendingIntentDraft);
    setPendingIntentDraft(null);
  }, [pendingIntentDraft]);

  const dismissPendingIntent = useCallback(() => {
    setPendingIntentDraft(null);
  }, []);

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
      confirmedIntent,
      setConfirmedIntent,
      clearIntent,
      pendingIntentDraft,
      confirmPendingIntent,
      dismissPendingIntent,
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
      storyImages,
      addStoryImage,
      removeStoryImage,
      imageProvider,
      artDirection,
      setImageProvider,
      isArtWorking,
      addVisualReference,
      refineVisualItem,
      updateVisualCanvasItem,
      removeVisualCanvasItem,
      setCharacterReferenceByUrl,
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
      confirmedIntent,
      clearIntent,
      pendingIntentDraft,
      confirmPendingIntent,
      dismissPendingIntent,
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
      storyImages,
      addStoryImage,
      removeStoryImage,
      imageProvider,
      artDirection,
      isArtWorking,
      addVisualReference,
      refineVisualItem,
      updateVisualCanvasItem,
      removeVisualCanvasItem,
      setCharacterReferenceByUrl,
      activeSelection,
      setActiveSelection,
      clearSelection,
      sendSelectionEdit,
      promptPool,
      updateShotFragmentRefs,
    ],
  );

  const currentActions: StoryAgentActions = {
    setConfirmedIntent,
    clearIntent,
    confirmPendingIntent,
    dismissPendingIntent,
    sendMessage,
    reorderCards,
    removeCard,
    updateCardContent,
    updateScriptMeta,
    updateScriptScene,
    updateStoryShotField,
    generateScript,
    resetConversation,
    loadStory,
    createNewStory,
    backToList,
    deleteStory: handleDeleteStory,
    refreshStoryList,
    setImageProvider,
    addVisualReference,
    refineVisualItem,
    updateVisualCanvasItem,
    removeVisualCanvasItem,
    setCharacterReferenceByUrl,
    setActiveSelection,
    clearSelection,
    sendSelectionEdit,
    addStoryImage,
    removeStoryImage,
    updateShotFragmentRefs,
  };
  const actionsRef = useRef<StoryAgentActions | null>(currentActions);
  actionsRef.current = currentActions;
  const stableActions = useMemo(
    () => createActionFacade<StoryAgentActions>(actionsRef, storyAgentActionKeys),
    [],
  );

  return (
    <StoryAgentActionsContext.Provider value={stableActions}>
      <StoryAgentContext.Provider value={value}>
        {children}
      </StoryAgentContext.Provider>
    </StoryAgentActionsContext.Provider>
  );
}

export function useStoryAgent() {
  const ctx = useContext(StoryAgentContext);
  if (!ctx) throw new Error('useStoryAgent must be used within StoryAgentProvider');
  return ctx;
}

export function useStoryAgentActions() {
  const ctx = useContext(StoryAgentActionsContext);
  if (!ctx) throw new Error('useStoryAgentActions must be used within StoryAgentProvider');
  return ctx;
}
