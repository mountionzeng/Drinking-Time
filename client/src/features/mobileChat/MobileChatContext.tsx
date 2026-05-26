/**
 * MobileChatContext — 手机端聊天+图片状态管理。
 *
 * 职责：
 * - 管理聊天消息列表（支持图片建议标记）
 * - 管理生成的图片列表（generating/ready/error 状态）
 * - 调用 storyAgent.mobileChat（带出图能力）
 * - 调用 storyAgent.generateForMobile（用户确认后出图）
 * - 调用 storyAgent.recordSignal（记录用户交互）
 * - localStorage 持久化
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import type { MobileChatMessage, GeneratedImageItem } from "./types";
import type { StoryCard } from "@/features/storyAgent/types";
import { FIRST_QUESTION } from "@/features/storyAgent/types";

// ── 持久化 ──
interface PersistedMobileState {
  messages: MobileChatMessage[];
  cards: StoryCard[];
  images: GeneratedImageItem[];
  remoteStoryId?: number;
}

const STORAGE_KEY = "dt:mobileChat";

function loadState(): PersistedMobileState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as PersistedMobileState;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      images: Array.isArray(parsed.images) ? parsed.images : [],
      remoteStoryId: parsed.remoteStoryId,
    };
  } catch {
    return emptyState();
  }
}

function emptyState(): PersistedMobileState {
  return {
    messages: [
      {
        id: "first-q",
        role: "assistant",
        content: FIRST_QUESTION,
        timestamp: Date.now(),
      },
    ],
    cards: [],
    images: [],
  };
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Context 类型 ──
interface MobileChatContextValue {
  messages: MobileChatMessage[];
  cards: StoryCard[];
  images: GeneratedImageItem[];
  isReplying: boolean;
  isGenerating: boolean;
  remoteStoryId: number | null;
  // 发送消息（调用 mobileChat 端点，可附带照片 base64）
  sendMessage: (text: string, photoBase64?: string) => Promise<void>;
  // 用户确认出图
  confirmGenerate: (messageId: string) => Promise<void>;
  // 滑动操作
  swipeRight: (imageId: number) => Promise<void>;
  swipeLeft: (imageId: number, reason?: string) => Promise<void>;
  // 重置对话
  resetConversation: () => void;
}

const MobileChatCtx = createContext<MobileChatContextValue | null>(null);

export function useMobileChat(): MobileChatContextValue {
  const ctx = useContext(MobileChatCtx);
  if (!ctx) throw new Error("useMobileChat 必须在 MobileChatProvider 内使用");
  return ctx;
}

// ── Provider ──
export function MobileChatProvider({ children }: { children: ReactNode }) {
  const initial = useRef(loadState()).current;
  const [messages, setMessages] = useState<MobileChatMessage[]>(initial.messages);
  const [cards, setCards] = useState<StoryCard[]>(initial.cards);
  const [images, setImages] = useState<GeneratedImageItem[]>(initial.images);
  const [remoteStoryId, setRemoteStoryId] = useState<number | null>(
    initial.remoteStoryId ?? null
  );
  const [isReplying, setIsReplying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // tRPC mutations
  const mobileChatMut = trpc.storyAgent.mobileChat.useMutation();
  const generateMut = trpc.storyAgent.generateForMobile.useMutation();
  const signalMut = trpc.storyAgent.recordSignal.useMutation();
  const upsertStoryMut = trpc.storyAgent.storyUpsert.useMutation();
  const uploadPhotoMut = trpc.storyAgent.uploadPhoto.useMutation();

  // 持久化到 localStorage
  const persist = useCallback(
    (
      msgs: MobileChatMessage[],
      crds: StoryCard[],
      imgs: GeneratedImageItem[],
      storyId?: number | null
    ) => {
      const state: PersistedMobileState = {
        messages: msgs,
        cards: crds,
        images: imgs,
        remoteStoryId: storyId ?? undefined,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // localStorage 满了就跳过
      }
    },
    []
  );

  // 确保有 remoteStoryId（自动创建 story）
  const ensureStoryId = useCallback(async (): Promise<number> => {
    if (remoteStoryId) return remoteStoryId;
    const result = await upsertStoryMut.mutateAsync({
      title: "手机端回忆",
      body: { cards: [], characters: [], shots: [] },
    });
    const id = result?.id;
    if (!id) throw new Error("创建 story 失败");
    setRemoteStoryId(id);
    return id;
  }, [remoteStoryId, upsertStoryMut]);

  // 发送消息（可附带照片 base64）
  const sendMessage = useCallback(
    async (text: string, photoBase64?: string) => {
      if (!text.trim() || isReplying) return;

      // 如果有照片，先上传到 storage
      let photoUrl: string | undefined;
      if (photoBase64) {
        try {
          const uploadResult = await uploadPhotoMut.mutateAsync({
            base64: photoBase64,
          });
          if (uploadResult.status === "ok") {
            photoUrl = uploadResult.url;
          }
        } catch (err) {
          console.error("[sendMessage] 照片上传失败:", err);
        }
      }

      const userMsg: MobileChatMessage = {
        id: newId("u"),
        role: "user",
        content: text.trim(),
        timestamp: Date.now(),
        photoUrl,
      };

      const newMsgs = [...messages, userMsg];
      setMessages(newMsgs);
      setIsReplying(true);

      try {
        // 构建 history（只传最近 16 轮的 role+content）
        const history = newMsgs
          .filter((m) => m.id !== "first-q")
          .slice(-16)
          .map((m) => ({ role: m.role, content: m.content }));

        const result = await mobileChatMut.mutateAsync({
          message: text.trim(),
          history: history.slice(0, -1), // 最后一条是当前消息，不放 history
          existingCardCount: cards.length,
        });

        // 处理 card
        let newCards = cards;
        if (result.card) {
          const card: StoryCard = {
            id: newId("c"),
            title:
              result.card.sourceQuote ||
              result.card.content?.slice(0, 14) ||
              "素材",
            content: result.card.content || "",
            rawText: result.card.rawText,
            sourceQuote: result.card.sourceQuote,
            emotion: result.card.emotion || "",
            emotionOptions: result.card.emotionOptions,
            emotionBlend: result.card.emotionBlend,
            sensoryDetails: [],
            intensity: result.card.intensity,
            direction: result.card.direction,
            complexity: result.card.complexity,
            trigger: result.card.trigger,
            dramaticFunction: result.card.dramaticFunction,
            personalTrace: result.card.personalTrace,
            retrievalQuery: result.card.retrievalQuery,
            themeHints: result.card.themeHints,
            outlierSignal: result.card.outlierSignal,
            softMembership: result.card.softMembership,
            createdAt: Date.now(),
          };
          newCards = [...cards, card];
          setCards(newCards);
        }

        // 处理 assistant 回复
        const assistantMsg: MobileChatMessage = {
          id: newId("a"),
          role: "assistant",
          content: result.reply || "嗯。",
          timestamp: Date.now(),
          suggestImage: result.suggestImage,
          imagePrompt: result.toolCalls?.[0]?.prompt,
          imageShotNo: result.toolCalls?.[0]?.shotNo,
        };

        const finalMsgs = [...newMsgs, assistantMsg];
        setMessages(finalMsgs);
        persist(finalMsgs, newCards, images, remoteStoryId);
      } catch (err) {
        // 错误时也加一条提示
        const errorMsg: MobileChatMessage = {
          id: newId("e"),
          role: "assistant",
          content: "抱歉，我这边出了点问题，你再说一次？",
          timestamp: Date.now(),
        };
        const finalMsgs = [...newMsgs, errorMsg];
        setMessages(finalMsgs);
        persist(finalMsgs, cards, images, remoteStoryId);
        console.error("[mobileChat] 发送失败:", err);
      } finally {
        setIsReplying(false);
      }
    },
    [messages, cards, images, isReplying, mobileChatMut, uploadPhotoMut, persist, remoteStoryId]
  );

  // 用户确认出图
  const confirmGenerate = useCallback(
    async (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg?.imagePrompt || isGenerating) return;

      setIsGenerating(true);
      try {
        const storyId = await ensureStoryId();

        // 先添加 generating 状态的图片占位
        const placeholderId = Date.now();
        const placeholder: GeneratedImageItem = {
          id: placeholderId,
          imageUrl: "",
          prompt: msg.imagePrompt,
          shotNo: msg.imageShotNo,
          storyId,
          status: "generating",
          messageId,
        };
        const newImages = [...images, placeholder];
        setImages(newImages);

        // 查找消息上下文中最近的用户照片（作为生成基底）
        const msgIndex = messages.findIndex((m) => m.id === messageId);
        let photoUrl: string | undefined;
        if (msgIndex > 0) {
          // 往回找最近一条带照片的用户消息
          for (let i = msgIndex - 1; i >= 0; i--) {
            if (messages[i].role === "user" && messages[i].photoUrl) {
              photoUrl = messages[i].photoUrl;
              break;
            }
          }
        }

        // 调用生成（如果有用户照片，传入作为 image-to-image 基底）
        const result = await generateMut.mutateAsync({
          prompt: msg.imagePrompt,
          storyId,
          shotNo: msg.imageShotNo,
          originalImageUrl: photoUrl,
        });

        if (result.status === "ok" && result.imageUrl) {
          const readyImage: GeneratedImageItem = {
            id: result.imageId!,
            imageUrl: result.imageUrl,
            prompt: msg.imagePrompt,
            shotNo: msg.imageShotNo,
            storyId,
            status: "ready",
            messageId,
          };
          const finalImages = images
            .filter((img) => img.id !== placeholderId)
            .concat(readyImage);
          setImages(finalImages);
          persist(messages, cards, finalImages, storyId);
        } else {
          // 出错：更新占位为 error 状态
          const errorImages = newImages.map((img) =>
            img.id === placeholderId ? { ...img, status: "error" as const } : img
          );
          setImages(errorImages);
          persist(messages, cards, errorImages, storyId);
        }
      } catch (err) {
        console.error("[confirmGenerate] 图片生成失败:", err);
      } finally {
        setIsGenerating(false);
      }
    },
    [messages, images, cards, isGenerating, generateMut, ensureStoryId, persist, remoteStoryId]
  );

  // 右划收下
  const swipeRight = useCallback(
    async (imageId: number) => {
      if (!remoteStoryId) return;
      try {
        await signalMut.mutateAsync({
          storyId: remoteStoryId,
          imageId,
          action: "swipe_right",
        });
      } catch (err) {
        console.error("[swipeRight] 记录信号失败:", err);
      }
    },
    [remoteStoryId, signalMut]
  );

  // 左划丢弃
  const swipeLeft = useCallback(
    async (imageId: number, reason?: string) => {
      if (!remoteStoryId) return;
      try {
        await signalMut.mutateAsync({
          storyId: remoteStoryId,
          imageId,
          action: "swipe_left",
          metadata: reason ? { reason } : undefined,
        });
        // 把图片标记为非当前
        setImages((prev) =>
          prev.filter((img) => img.id !== imageId)
        );
      } catch (err) {
        console.error("[swipeLeft] 记录信号失败:", err);
      }
    },
    [remoteStoryId, signalMut]
  );

  // 重置
  const resetConversation = useCallback(() => {
    const fresh = emptyState();
    setMessages(fresh.messages);
    setCards([]);
    setImages([]);
    setRemoteStoryId(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value: MobileChatContextValue = {
    messages,
    cards,
    images,
    isReplying,
    isGenerating,
    remoteStoryId,
    sendMessage,
    confirmGenerate,
    swipeRight,
    swipeLeft,
    resetConversation,
  };

  return (
    <MobileChatCtx.Provider value={value}>{children}</MobileChatCtx.Provider>
  );
}
