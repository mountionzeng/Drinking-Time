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
import { trpc } from '@/lib/trpc';
import {
  FIRST_QUESTION,
  type ChatMessage,
  type StoryCard,
  type GeneratedScript,
  type StoryShot,
} from './types';

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
}

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
  sendMessage: (text: string) => Promise<void>;
  reorderCards: (newOrder: StoryCard[]) => void;
  removeCard: (id: string) => void;
  generateScript: () => Promise<void>;
  resetConversation: () => void;
  /** Story list management */
  activeStoryId: number | null;
  storyList: StoryListItem[];
  isLoadingStories: boolean;
  loadStory: (id: number) => Promise<void>;
  createNewStory: () => void;
  backToList: () => void;
  deleteStory: (id: number) => Promise<void>;
  refreshStoryList: () => void;
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

function loadState(projectId: number | null): PersistedState {
  const key = storageKey(projectId);
  if (!key) return emptyState();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as PersistedState;
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
    };
  } catch {
    return emptyState();
  }
}

function emptyState(): PersistedState {
  return {
    messages: [
      {
        id: 'first-question',
        role: 'assistant',
        content: FIRST_QUESTION,
        timestamp: Date.now(),
      },
    ],
    cards: [],
    scripts: [],
    storyShots: [],
    characters: [],
  };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function cardTitle(card: Partial<StoryCard>): string {
  const source = card.sourceQuote || card.content || card.rawText || '故事素材';
  const compact = source.replace(/\s+/g, ' ').trim();
  return compact.length > 14 ? `${compact.slice(0, 14)}…` : compact || '故事素材';
}

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

function tokenizeForSimilarity(input: string): Set<string> {
  const lower = input.toLowerCase();
  const tokens = lower.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) ?? [];
  const chineseChars = Array.from(lower.replace(/[^\u4e00-\u9fff]/g, ''));
  const chineseBigrams: string[] = [];
  for (let i = 0; i < chineseChars.length - 1; i += 1) {
    chineseBigrams.push(`${chineseChars[i]}${chineseChars[i + 1]}`);
  }
  return new Set([...tokens, ...chineseBigrams]);
}

function storyCardSearchText(card: StoryCard): string {
  return [
    card.content,
    card.rawText,
    card.sourceQuote,
    card.emotion,
    ...(card.emotionBlend ?? []),
    card.trigger,
    card.dramaticFunction,
    card.personalTrace,
    card.retrievalQuery,
    ...(card.themeHints ?? []),
    card.outlierSignal,
    ...(card.softMembership ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

function getSimilarCards(query: string, sourceCards: StoryCard[]) {
  const queryTokens = tokenizeForSimilarity(query);
  if (queryTokens.size === 0) return [];

  return sourceCards
    .map((card) => {
      const cardTokens = tokenizeForSimilarity(storyCardSearchText(card));
      let overlap = 0;
      queryTokens.forEach((token) => {
        if (cardTokens.has(token)) overlap += 1;
      });
      const score =
        cardTokens.size > 0 ? overlap / Math.sqrt(queryTokens.size * cardTokens.size) : 0;
      return {
        content: card.content,
        rawText: card.rawText,
        emotion: card.emotion,
        emotionBlend: card.emotionBlend,
        retrievalQuery: card.retrievalQuery,
        themeHints: card.themeHints,
        personalTrace: card.personalTrace,
        score,
      };
    })
    .filter((card) => card.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

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
  const [isReplying, setIsReplying] = useState(false);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [activeStoryId, setActiveStoryId] = useState<number | null>(null);
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [storyList, setStoryList] = useState<StoryListItem[]>([]);
  const hydratedFor = useRef<number | null>(null);

  // ── Auto-save refs ──────────────────────────────────────────────────
  // Stable session ID for this browser session
  const sessionIdRef = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  // Hash of cards/scripts/shots at the time of last snapshot (explicit or auto)
  const lastSnapshotHashRef = useRef('');
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
    const persisted = loadState(projectId);
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
  ]);

  // ── Auto-save: keep refs in sync ───────────────────────────────────
  useEffect(() => { isReplyingRef.current = isReplying; }, [isReplying]);
  useEffect(() => { isGeneratingScriptRef.current = isGeneratingScript; }, [isGeneratingScript]);

  // Track the last time the editable state changed (for the 2-second inactivity guard)
  useEffect(() => {
    lastStateChangeTimeRef.current = Date.now();
  }, [cards, scripts, storyShots]);

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
    }) => {
      if (projectId === null) return;
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

      try {
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
            variants: latest?.variants ?? [],
            boringCheck: latest?.boringCheck ?? null,
            messages: archiveMessagesFrom(snapshot.messages, snapshot.cards),
          },
        });
        if (saved && typeof saved.id === 'number') {
          setRemoteStoryId(saved.id);
        }
      } catch (error) {
        console.warn('save archive story failed', error);
      }
    },
    [projectId, remoteStoryId, storyTitle, storyLogline, storyTheme, storyArc],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isReplying) return;

      const userMsg: ChatMessage = {
        id: newId('msg'),
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      };
      const nextMessages = [...messages, userMsg];
      setMessages(nextMessages);
      setIsReplying(true);

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
            },
          });
          lastSnapshotIdRef.current = snapshotResult.snapshotId;
          // Sync hash so the auto-save timer doesn't duplicate this snapshot
          lastSnapshotHashRef.current = JSON.stringify({
            cardIds: cards.map((c) => c.id),
            scriptIds: scripts.map((s) => s.id),
            shotNos: storyShots.map((s) => s.shotNo),
            cardContents: cards.map((c) => c.content),
          });
        } catch (err) {
          console.warn('[snapshot] captureSnapshot failed, proceeding without context:', err);
        }
      }

      try {
        const result = await chatMut.mutateAsync({
          message: trimmed,
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
      saveArchiveStory,
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
    isGeneratingScript,
    messages,
    scripts,
    remoteStoryId,
    storyTitle,
    saveArchiveStory,
  ]);

  const resetConversation = useCallback(() => {
    const fresh = emptyState();
    const storyIdToDelete = remoteStoryId;
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
    if (storyIdToDelete) {
      void storyDeleteMut.mutateAsync({ id: storyIdToDelete }).catch(
        (error) => console.warn('delete archive story failed', error),
      );
    }
  }, [remoteStoryId]);

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

      setRemoteStoryId(id);
      setStoryTitle(row.title || undefined);
      setStoryLogline(row.logline || undefined);
      setStoryTheme(row.theme || undefined);
      setStoryArc(row.arc || undefined);
      setCards(restoredCards);
      setStoryShots(restoredShots);
      setCharacters(restoredCharacters);
      setMessages(restoredMessages);

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
    } catch (error) {
      console.error('loadStory failed', error);
      toast.error('加载故事失败');
    }
  }, [utils.storyAgent.storyGet]);

  const createNewStory = useCallback(() => {
    clearCurrentStory();
    setActiveStoryId(-1); // -1 = new unsaved story, will get real ID on first save
  }, [clearCurrentStory]);

  const backToList = useCallback(() => {
    setActiveStoryId(null);
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
      generateScript,
      resetConversation,
      activeStoryId,
      storyList,
      isLoadingStories,
      loadStory,
      createNewStory,
      backToList,
      deleteStory: handleDeleteStory,
      refreshStoryList,
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
      generateScript,
      resetConversation,
      activeStoryId,
      storyList,
      isLoadingStories,
      loadStory,
      createNewStory,
      backToList,
      handleDeleteStory,
      refreshStoryList,
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
