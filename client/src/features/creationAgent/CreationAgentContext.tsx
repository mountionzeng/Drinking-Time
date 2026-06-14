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
  type ImageAsset,
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
  projectAssets: ImageAsset[];
  /** 单图循环（U2）：正在为哪个镜头出图（显示生成中骨架）；null 表示没有进行中的出图 */
  generatingShotNo: string | null;
  /** 单图循环失败信息，按镜头记，供 inline 错误+重试展示 */
  generateError: { shotNo: string; message: string } | null;
  /** 画出来 / 再来一张：确定性单图出图。rejectImageId 存在=先淘汰当前再出下一张 */
  generateNextImage: (args: { shotNo: string; prompt: string; rejectImageId?: number }) => Promise<void>;
  /** 最近一次小酌建议的提示词修改（用户需确认/可撤销） */
  pendingPromptUpdate: { shotNo: string; promptDraft: string } | null;
  clearPendingPromptUpdate: () => void;
  sendMessage: (text: string, shots?: ShotContext[], cards?: Array<{ content: string; emotion?: string }>, currentScript?: string) => Promise<void>;
  selectImage: (imageId: number) => Promise<void>;
  reassignImage: (imageId: number, newShotNo: string) => Promise<void>;
  refreshProjectAssets: () => void;
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
  const [projectAssets, setProjectAssets] = useState<ImageAsset[]>([]);
  const [pendingPromptUpdate, setPendingPromptUpdate] = useState<{ shotNo: string; promptDraft: string } | null>(null);
  const [generatingShotNo, setGeneratingShotNo] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<{ shotNo: string; message: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // tRPC hooks
  const utils = trpc.useUtils();
  const chatMut = trpc.creationAgent.chat.useMutation();
  const selectImageMut = trpc.creationAgent.selectImage.useMutation();
  const reassignMut = trpc.creationAgent.reassignImage.useMutation();
  const generateNextMut = trpc.creationAgent.generateNextImage.useMutation();

  // 图片按当前故事独立（故事为唯一单位）：按 storyId 取，故事间不共享图片。
  const assetsQuery = trpc.creationAgent.getProjectAssets.useQuery(
    { storyId: storyId! },
    { enabled: storyId != null },
  );

  useEffect(() => {
    if (assetsQuery.data) {
      setProjectAssets(assetsQuery.data as ImageAsset[]);
    }
  }, [assetsQuery.data]);

  const refreshProjectAssets = useCallback(() => {
    assetsQuery.refetch();
  }, [assetsQuery]);

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
      }
      if (result.assetsChanged || result.generatedImage) {
        refreshProjectAssets();
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
  }, [projectId, storyId, messages, focusShotNo, imageProvider, goal, chatMut, refreshProjectAssets]);

  const selectImage = useCallback(async (imageId: number) => {
    if (projectId == null) return;
    try {
      const result = await selectImageMut.mutateAsync({ projectId, imageId });
      if (!result.success) {
        // 刚出的图文件可能还没落地（availability missing）→ 收下会失败，提示稍后重试而非误判归属
        toast.error(
          result.reason === 'image_not_found'
            ? '这张图还在生成或暂不可用，稍后再收下'
            : '这张图片不属于当前项目',
        );
        return;
      }
      await assetsQuery.refetch();
      toast.success('已设为镜头主图');
    } catch {
      toast.error('设置主图失败');
    }
  }, [assetsQuery, projectId, selectImageMut]);

  // 单图循环（U2）：画出来 / 再来一张。rejectImageId 存在=先淘汰当前再出下一张。
  // 失败不清空：projectAssets 不动，只记 inline 错误；被划走的图（若已 reject）刷新后进历史。
  const generateNextImageFn = useCallback(async (args: { shotNo: string; prompt: string; rejectImageId?: number }) => {
    if (projectId == null || storyId == null) return;
    setGenerateError(null);
    setGeneratingShotNo(args.shotNo);
    try {
      const result = await generateNextMut.mutateAsync({
        projectId,
        storyId,
        shotNo: args.shotNo,
        prompt: args.prompt,
        rejectImageId: args.rejectImageId,
        imageProvider: imageProviderForRequest(imageProvider),
      });
      if (result.status === 'error') {
        setGenerateError({ shotNo: args.shotNo, message: result.message || '出图服务暂时不可用，稍后再试' });
        // 「再来一张」失败时被拒图已记 swipe_left → 刷新让它进历史（不回显被拒图）
        if (args.rejectImageId != null) await assetsQuery.refetch();
        return;
      }
      await assetsQuery.refetch();
    } catch {
      setGenerateError({ shotNo: args.shotNo, message: '出图服务暂时不可用，稍后再试' });
    } finally {
      setGeneratingShotNo(null);
    }
  }, [projectId, storyId, imageProvider, generateNextMut, assetsQuery]);

  // Reassign image
  const reassignImageFn = useCallback(async (imageId: number, newShotNo: string) => {
    if (projectId == null) return;
    try {
      await reassignMut.mutateAsync({ projectId, imageId, newShotNo });
      refreshProjectAssets();
      toast.success(`图片已移至 ${newShotNo}`);
    } catch {
      toast.error('图片重绑失败');
    }
  }, [projectId, reassignMut, refreshProjectAssets]);

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
    projectAssets,
    generatingShotNo,
    generateError,
    generateNextImage: generateNextImageFn,
    pendingPromptUpdate,
    clearPendingPromptUpdate,
    sendMessage,
    selectImage,
    reassignImage: reassignImageFn,
    refreshProjectAssets,
    resetConversation,
  }), [
    storyId,
    messages, focusShotNo, isReplying, isGenerating, imageProvider, goal, projectAssets,
    generatingShotNo, generateError, generateNextImageFn,
    pendingPromptUpdate, clearPendingPromptUpdate,
    sendMessage, selectImage, reassignImageFn, refreshProjectAssets, resetConversation,
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
