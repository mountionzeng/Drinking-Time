/**
 * CreationAgentContext — shared store for Creation Agent chat, focus tracking, and images.
 *
 * State is keyed by projectId and persisted to localStorage so reloads preserve
 * conversation and generated images.
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
import { normalizeGoal, type CreationGoal } from '@shared/creationGoal';
import { trpc } from '@/lib/trpc';
import {
  CREATION_GREETING,
  type ChatMessage,
  type ShotImage,
  type ShotContext,
} from './types';
import {
  loadProjectState,
  saveProjectState,
} from '@/features/_agentKit/projectScopedStore';

// ── Persisted state ──

interface PersistedState {
  messages: ChatMessage[];
  focusShotNo: string | null;
  imageProvider?: ImageProviderSelection;
  goal?: CreationGoal;
}

export type ImageProviderSelection = 'default' | ImageProvider;

const STORAGE_PREFIX = 'dt:creationAgent';

function loadState(projectId: number | null): PersistedState {
  return loadProjectState<PersistedState>(
    STORAGE_PREFIX,
    projectId,
    raw => {
      const parsed = raw as Partial<PersistedState>;
      return {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        focusShotNo: typeof parsed.focusShotNo === 'string' ? parsed.focusShotNo : null,
        imageProvider: normalizeImageProviderSelection(parsed.imageProvider),
        goal: normalizeGoal(parsed.goal),
      };
    },
    emptyState,
  );
}

function emptyState(): PersistedState {
  return {
    messages: [
      {
        id: 'creation-greeting',
        role: 'assistant',
        content: CREATION_GREETING,
        timestamp: Date.now(),
      },
    ],
    focusShotNo: null,
    imageProvider: 'default',
    goal: 'unset',
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

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Context value ──

interface CreationAgentContextValue {
  /** 当前故事 id（U5）：inpaint 等按它取故事美术风格 */
  storyId: number | null;
  messages: ChatMessage[];
  focusShotNo: string | null;
  setFocusShotNo: (shotNo: string | null) => void;
  isReplying: boolean;
  isGenerating: boolean;
  imageProvider: ImageProviderSelection;
  setImageProvider: (provider: ImageProviderSelection) => void;
  goal: CreationGoal;
  setGoal: (goal: CreationGoal) => void;
  projectImages: ShotImage[];
  /** 最近一次小酌建议的提示词修改（用户需确认/可撤销） */
  pendingPromptUpdate: { shotNo: string; promptDraft: string } | null;
  clearPendingPromptUpdate: () => void;
  sendMessage: (text: string, shots?: ShotContext[], cards?: Array<{ content: string; emotion?: string }>, currentScript?: string) => Promise<void>;
  reassignImage: (imageId: number, newShotNo: string) => Promise<void>;
  refreshProjectImages: () => void;
  resetConversation: () => void;
}

const CreationAgentContext = createContext<CreationAgentContextValue | null>(null);

// ── Provider ──

export function CreationAgentProvider({
  projectId,
  storyId,
  children,
}: {
  projectId: number | null;
  // 当前故事（U5）：creation 聊天按它取故事上下文/写镜头
  storyId?: number | null;
  children: ReactNode;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadState(projectId).messages);
  const [focusShotNo, setFocusShotNo] = useState<string | null>(() => loadState(projectId).focusShotNo);
  const [imageProvider, setImageProvider] = useState<ImageProviderSelection>(() => loadState(projectId).imageProvider ?? 'default');
  const [goal, setGoal] = useState<CreationGoal>(() => loadState(projectId).goal ?? 'unset');
  const [isReplying, setIsReplying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [projectImages, setProjectImages] = useState<ShotImage[]>([]);
  const [pendingPromptUpdate, setPendingPromptUpdate] = useState<{ shotNo: string; promptDraft: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // tRPC hooks
  const utils = trpc.useUtils();
  const chatMut = trpc.creationAgent.chat.useMutation();
  const reassignMut = trpc.creationAgent.reassignImage.useMutation();

  // Fetch project images
  const imagesQuery = trpc.creationAgent.getProjectImages.useQuery(
    { projectId: projectId! },
    { enabled: projectId != null },
  );

  useEffect(() => {
    if (imagesQuery.data) {
      setProjectImages(imagesQuery.data as ShotImage[]);
    }
  }, [imagesQuery.data]);

  const refreshProjectImages = useCallback(() => {
    imagesQuery.refetch();
  }, [imagesQuery]);

  // Persist to localStorage（走共享的 projectScopedStore）
  useEffect(() => {
    saveProjectState<PersistedState>(STORAGE_PREFIX, projectId, {
      messages,
      focusShotNo,
      imageProvider,
      goal,
    });
  }, [messages, focusShotNo, imageProvider, goal, projectId]);

  // Reload state when projectId changes
  useEffect(() => {
    const state = loadState(projectId);
    setMessages(state.messages);
    setFocusShotNo(state.focusShotNo);
    setImageProvider(state.imageProvider ?? 'default');
    setGoal(state.goal ?? 'unset');
  }, [projectId]);

  // Send message
  const sendMessage = useCallback(async (
    text: string,
    shots?: ShotContext[],
    cards?: Array<{ content: string; emotion?: string }>,
    currentScript?: string,
  ) => {
    if (!projectId || !text.trim()) return;

    const userMsg: ChatMessage = {
      id: newId('msg'),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsReplying(true);

    // Build history from recent messages (skip system greeting)
    const history = messages
      .filter(m => m.id !== 'creation-greeting')
      .slice(-12)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const result = await chatMut.mutateAsync({
        message: text.trim(),
        projectId,
        history,
        cards,
        currentScript,
        shots,
        currentFocusShotNo: focusShotNo ?? undefined,
        imageProvider: imageProviderForRequest(imageProvider),
        goal: goal === 'unset' ? undefined : goal,
        storyId: storyId ?? undefined,
      });

      if (!result.configured) {
        toast.error('API 未配置，请检查 .env');
      }

      // Update focus
      if (result.focusShotNo) {
        setFocusShotNo(result.focusShotNo);
      }

      // Handle generated image
      if (result.generatedImage) {
        setIsGenerating(false);
        refreshProjectImages();
      }

      // Handle prompt update suggestion
      if (result.promptUpdate) {
        setPendingPromptUpdate(result.promptUpdate);
      }

      // buildShotList：小酌铺了整张镜头表 → 刷新镜头表查询，让 Shot Table 立即显示
      if (result.builtShotCount && result.builtShotCount > 0) {
        utils.shot.list.invalidate();
        toast.success(`已根据你说的铺了 ${result.builtShotCount} 个镜头到镜头表`);
      }

      const assistantMsg: ChatMessage = {
        id: newId('msg'),
        role: 'assistant',
        content: result.reply,
        timestamp: Date.now(),
        generatedImage: result.generatedImage ?? undefined,
        promptUpdate: result.promptUpdate ?? undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      toast.error('创作引擎回复失败');
      const errorMsg: ChatMessage = {
        id: newId('msg'),
        role: 'assistant',
        content: '抱歉，出了点问题。请稍后再试。',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsReplying(false);
      setIsGenerating(false);
    }
  }, [projectId, storyId, messages, focusShotNo, imageProvider, goal, chatMut, refreshProjectImages]);

  // Reassign image
  const reassignImageFn = useCallback(async (imageId: number, newShotNo: string) => {
    try {
      await reassignMut.mutateAsync({ imageId, newShotNo });
      refreshProjectImages();
      toast.success(`图片已移至 ${newShotNo}`);
    } catch {
      toast.error('图片重绑失败');
    }
  }, [reassignMut, refreshProjectImages]);

  const clearPendingPromptUpdate = useCallback(() => {
    setPendingPromptUpdate(null);
  }, []);

  // Reset conversation
  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    const state = emptyState();
    setMessages(state.messages);
    setFocusShotNo(null);
    setImageProvider('default');
    setIsReplying(false);
    setIsGenerating(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const value = useMemo<CreationAgentContextValue>(() => ({
    storyId: storyId ?? null,
    messages,
    focusShotNo,
    setFocusShotNo,
    isReplying,
    isGenerating,
    imageProvider,
    setImageProvider,
    goal,
    setGoal,
    projectImages,
    pendingPromptUpdate,
    clearPendingPromptUpdate,
    sendMessage,
    reassignImage: reassignImageFn,
    refreshProjectImages,
    resetConversation,
  }), [
    storyId,
    messages, focusShotNo, isReplying, isGenerating, imageProvider, goal, projectImages,
    pendingPromptUpdate, clearPendingPromptUpdate,
    sendMessage, reassignImageFn, refreshProjectImages, resetConversation,
  ]);

  return (
    <CreationAgentContext.Provider value={value}>
      {children}
    </CreationAgentContext.Provider>
  );
}

export function useCreationAgent() {
  const ctx = useContext(CreationAgentContext);
  if (!ctx) {
    throw new Error('useCreationAgent must be used within CreationAgentProvider');
  }
  return ctx;
}
