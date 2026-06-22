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
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import {
  buildMobileStoryBody,
  normalizeMobileCards,
  normalizeMobileImages,
  normalizeMobileMessages,
  resolveMobileImageShotNo,
  type MobileChatMessage,
  type GeneratedImageItem,
} from "./types";
import type { StoryCard } from "@/features/storyAgent/types";
import { FIRST_QUESTION } from "@/features/storyAgent/types";
import { storySpineStore } from "@/features/storyAgent/spine/storySpine";

// ── 持久化 ──
interface PersistedMobileState {
  messages: MobileChatMessage[];
  cards: StoryCard[];
  images: GeneratedImageItem[];
  remoteStoryId?: number;
  serverRevision?: number;
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
      serverRevision:
        typeof parsed.serverRevision === "number" ? parsed.serverRevision : 0,
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
  sendMessage: (text: string, photoBase64?: string, photoMimeType?: string) => Promise<void>;
  // 用户确认出图
  confirmGenerate: (messageId: string) => Promise<void>;
  // 手动「画出来」：不依赖小酌主动提议，把当前这段对话现编 prompt 生成一张图
  generateNow: () => Promise<void>;
  /** 确认草稿小样 → MJ 出正式版替换 */
  confirmFinal: (imageId: number) => Promise<void>;
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
  const hydratedStoryVersion = useRef<string | null>(null);
  const serverRevision = useRef(initial.serverRevision ?? 0);
  const storySaveQueue = useRef<Promise<void>>(Promise.resolve());

  const utils = trpc.useUtils();
  const storyListQuery = trpc.storyAgent.storyList.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
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
        serverRevision: serverRevision.current,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // localStorage 满了就跳过
      }
    },
    []
  );

  // 进入页面 / 切回标签时，从服务器恢复对话。
  //
  // 三条关键约束（修复「聊天消失 + 故事碎片化」）：
  //   1. 绑定单一故事：本地已记住 remoteStoryId 时只认这个故事，不再无脑抓「最新的 stories[0]」，
  //      避免切个标签 / 重开就被另一个故事顶替。本地还没绑定（首次进入、换浏览器）才采纳服务器最新故事。
  //   2. 同版本不重复水合（hydratedStoryVersion 守卫）。
  //   3. 非破坏性：本地消息比服务器版本更长（有 fire-and-forget 还没存上的尾部）时，保留本地、
  //      不拿陈旧的服务器版本覆盖，等下一次发送 / 关页补存把尾部同步上去。
  useEffect(() => {
    if (isReplying || isGenerating) return;
    const stories = storyListQuery.data?.stories;
    if (!stories || stories.length === 0) return;

    // 绑定目标：优先认本地记住的故事，没有才用服务器最新故事兜底
    const boundId = remoteStoryId ?? stories[0].id;
    const target = stories.find((s) => s.id === boundId) ?? stories[0];

    const version = `${target.id}:${String(target.updatedAt)}`;
    if (hydratedStoryVersion.current === version) return;

    let cancelled = false;
    void utils.storyAgent.storyGet
      .fetch({ id: target.id })
      .then((story) => {
        if (cancelled || !story) return;
        const body =
          story.body && typeof story.body === "object"
            ? (story.body as Record<string, unknown>)
            : {};
        const nextMessages = normalizeMobileMessages(body.messages);
        const nextCards = normalizeMobileCards(body.cards);
        const nextImages = normalizeMobileImages(
          body.mobileImages ?? body.images
        );

        // 非破坏性守卫：同一个故事、且本地比服务器「更长」时，保留本地未保存的尾部，不覆盖
        const localRealCount = messages.filter((m) => m.id !== "first-q").length;
        const serverRealCount = nextMessages.filter(
          (m) => m.id !== "first-q"
        ).length;
        const isSameStory = remoteStoryId != null && story.id === remoteStoryId;
        if (isSameStory && localRealCount > serverRealCount) {
          hydratedStoryVersion.current = version; // 记下版本，避免反复触发
          setRemoteStoryId(story.id);
          return;
        }

        const hydratedMessages =
          nextMessages.length > 0 ? nextMessages : emptyState().messages;

        serverRevision.current =
          typeof story.revision === "number" ? story.revision : 0;
        hydratedStoryVersion.current = version;
        setRemoteStoryId(story.id);
        setMessages(hydratedMessages);
        setCards(nextCards);
        setImages(nextImages);
        persist(hydratedMessages, nextCards, nextImages, story.id);
      })
      .catch((err) => {
        console.error("[mobileChat] 服务器对话恢复失败:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [
    isGenerating,
    isReplying,
    messages,
    persist,
    remoteStoryId,
    storyListQuery.data?.stories,
    utils.storyAgent.storyGet,
  ]);

  const ensureStoryId = useCallback(
    async (seed?: PersistedMobileState, createNew = false): Promise<number> => {
      if (!createNew) {
        // 优先复用当前已绑定的故事，保证同一段对话始终写进同一个 story（杜绝碎片化）
        if (remoteStoryId) {
          const existing = await utils.storyAgent.storyGet
            .fetch({ id: remoteStoryId })
            .catch(() => null);
          if (existing) {
            if (hydratedStoryVersion.current === null) {
              const remoteRevision =
                typeof existing.revision === "number" ? existing.revision : 0;
              // 尚未完成服务器水合时故意制造版本不一致，让首次保存走安全合并。
              serverRevision.current = remoteRevision + 1;
            }
            return remoteStoryId;
          }
          serverRevision.current = 0;
          setRemoteStoryId(null); // 绑定的故事在服务器没了（如重启清空内存态），继续往下兜底
        }
        // 本地还没绑定故事时，才采纳服务器里最新的那个
        const listed =
          storyListQuery.data ??
          (await utils.storyAgent.storyList.fetch());
        const latestStory = listed.stories[0];
        if (latestStory) {
          const existing = await utils.storyAgent.storyGet
            .fetch({ id: latestStory.id })
            .catch(() => null);
          const remoteRevision =
            existing && typeof existing.revision === "number"
              ? existing.revision
              : 0;
          // 新设备还没水合正文，不能把“最新版本号”当成覆盖许可。
          serverRevision.current = remoteRevision + 1;
          setRemoteStoryId(latestStory.id);
          return latestStory.id;
        }
      }

      const seedMessages = seed?.messages ?? messages;
      const seedCards = seed?.cards ?? cards;
      const seedImages = seed?.images ?? images;
      const result = await upsertStoryMut.mutateAsync({
        title: "手机端回忆",
        body: buildMobileStoryBody(seedMessages, seedCards, seedImages),
      });
      const id = result?.id;
      if (!id) throw new Error("创建 story 失败");
      serverRevision.current =
        typeof result.revision === "number" ? result.revision : 0;
      setRemoteStoryId(id);
      return id;
    },
    [
      cards,
      images,
      messages,
      remoteStoryId,
      storyListQuery.data,
      upsertStoryMut,
      utils.storyAgent.storyGet,
      utils.storyAgent.storyList,
    ]
  );

  const saveStoryState = useCallback(
    (
      msgs: MobileChatMessage[],
      crds: StoryCard[],
      imgs: GeneratedImageItem[],
      storyId?: number | null
    ) => {
      const save = async () => {
        const seed: PersistedMobileState = {
          messages: msgs,
          cards: crds,
          images: imgs,
          remoteStoryId: storyId ?? undefined,
        };
        try {
          const id = storyId ?? (await ensureStoryId(seed));
          const saved = await upsertStoryMut.mutateAsync({
            id,
            baseRevision: serverRevision.current,
            body: buildMobileStoryBody(msgs, crds, imgs),
          });
          const savedId = saved?.id ?? id;
          const savedRevision =
            typeof saved?.revision === "number"
              ? saved.revision
              : serverRevision.current;
          serverRevision.current = savedRevision;
          setRemoteStoryId(savedId);
          if (saved?.updatedAt) {
            hydratedStoryVersion.current = `${savedId}:${String(saved.updatedAt)}`;
          }
          if (saved?.syncConflict && saved.body && typeof saved.body === "object") {
            const body = saved.body as Record<string, unknown>;
            const mergedMessages = normalizeMobileMessages(body.messages);
            const mergedCards = normalizeMobileCards(body.cards);
            const mergedImages = normalizeMobileImages(
              body.mobileImages ?? body.images
            );
            const hydratedMessages =
              mergedMessages.length > 0 ? mergedMessages : emptyState().messages;
            setMessages(hydratedMessages);
            setCards(mergedCards);
            setImages(mergedImages);
            persist(
              hydratedMessages,
              mergedCards,
              mergedImages,
              savedId
            );
          } else {
            persist(msgs, crds, imgs, savedId);
          }
          await utils.storyAgent.storyList.invalidate();
          return savedId;
        } catch (err) {
          persist(msgs, crds, imgs, storyId ?? remoteStoryId);
          console.error("[mobileChat] 服务器保存失败，已保留本地缓存:", err);
          return storyId ?? remoteStoryId;
        }
      };
      const queued = storySaveQueue.current.then(save, save);
      storySaveQueue.current = queued.then(
        () => undefined,
        () => undefined
      );
      return queued;
    },
    [
      ensureStoryId,
      persist,
      remoteStoryId,
      upsertStoryMut,
      utils.storyAgent.storyList,
    ]
  );

  // 关页 / 切到后台前补存一次，堵住 fire-and-forget 还没上传完就被关掉而丢失的尾部。
  // 用 ref 持有最新状态，避免事件回调闭包拿到旧值。
  const latestStateRef = useRef({ messages, cards, images, remoteStoryId });
  latestStateRef.current = { messages, cards, images, remoteStoryId };
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "hidden") return;
      const s = latestStateRef.current;
      const hasReal = s.messages.some((m) => m.id !== "first-q");
      if (hasReal) {
        void saveStoryState(s.messages, s.cards, s.images, s.remoteStoryId);
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [saveStoryState]);

  // 发送消息（可附带照片 base64）
  const sendMessage = useCallback(
    async (text: string, photoBase64?: string, photoMimeType = "image/jpeg") => {
      const trimmed = text.trim();
      if ((!trimmed && !photoBase64) || isReplying) return;
      const messageText = trimmed || "帮我看看这张照片";

      // 如果有照片，先上传到 storage
      let photoUrl: string | undefined;
      if (photoBase64) {
        try {
          const uploadResult = await uploadPhotoMut.mutateAsync({
            base64: photoBase64,
            mimeType: photoMimeType,
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
        content: messageText,
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
          message: messageText,
          history: history.slice(0, -1), // 最后一条是当前消息，不放 history
          existingCardCount: cards.length,
          photoUrl, // 上传后的照片 URL，传给 LLM 做多模态理解
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
        void saveStoryState(finalMsgs, newCards, images, remoteStoryId);
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
        void saveStoryState(finalMsgs, cards, images, remoteStoryId);
        console.error("[mobileChat] 发送失败:", err);
      } finally {
        setIsReplying(false);
      }
    },
    [
      messages,
      cards,
      images,
      isReplying,
      mobileChatMut,
      uploadPhotoMut,
      persist,
      remoteStoryId,
      saveStoryState,
    ]
  );

  // 用户确认出图
  const confirmGenerate = useCallback(
    async (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg?.imagePrompt || isGenerating) return;

      setIsGenerating(true);
      try {
        const storyId = await ensureStoryId();
        const shotNo = resolveMobileImageShotNo(cards, msg.imageShotNo);

        // 先添加 generating 状态的图片占位
        const placeholderId = Date.now();
        const placeholder: GeneratedImageItem = {
          id: placeholderId,
          imageUrl: "",
          prompt: msg.imagePrompt,
          shotNo,
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

        // 从当前镜头读取美术风格锁，确保所有面板生成的图风格一致
        const shotStyleHint = storySpineStore.getState().storyShots
          .find(s => s.shotNo === shotNo)?.styleRef || undefined;

        // 调用生成（如果有用户照片，传入作为 image-to-image 基底）
        const result = await generateMut.mutateAsync({
          prompt: msg.imagePrompt,
          storyId,
          shotNo,
          originalImageUrl: photoUrl,
          styleHint: shotStyleHint,
        });

        if (result.status === "ok" && result.imageUrl) {
          const readyImage: GeneratedImageItem = {
            id: result.imageId!,
            imageUrl: result.imageUrl,
            prompt: msg.imagePrompt,
            shotNo,
            storyId,
            status: "ready",
            messageId,
          };
          const finalImages = newImages
            .filter((img) => img.id !== placeholderId)
            .concat(readyImage);
          setImages((prev) =>
            prev.filter((img) => img.id !== placeholderId).concat(readyImage),
          );
          persist(messages, cards, finalImages, storyId);
          void saveStoryState(messages, cards, finalImages, storyId);
        } else {
          // 出错：更新占位为 error 状态
          const errorImages = newImages.map((img) =>
            img.id === placeholderId ? { ...img, status: "error" as const } : img
          );
          setImages(errorImages);
          persist(messages, cards, errorImages, storyId);
          void saveStoryState(messages, cards, errorImages, storyId);
        }
      } catch (err) {
        console.error("[confirmGenerate] 图片生成失败:", err);
      } finally {
        setIsGenerating(false);
      }
    },
    [
      messages,
      images,
      cards,
      isGenerating,
      generateMut,
      ensureStoryId,
      persist,
      saveStoryState,
    ]
  );

  // 手动「画出来」：不依赖小酌主动提议，用户随时把当前这段对话变成一张图。
  // 没有 agent 给的 imagePrompt，让服务端从最近对话现编（generateForMobile 不传 prompt）。
  const generateNow = useCallback(async () => {
    if (isGenerating || isReplying) return;
    const realMsgs = messages.filter((m) => m.id !== "first-q");
    if (realMsgs.length === 0) return; // 还没聊，没东西可画

    setIsGenerating(true);
    try {
      const storyId = await ensureStoryId();
      const shotNo = resolveMobileImageShotNo(cards);

      // 新增一条 assistant 消息承载这次出图的生命周期（生成中 → 画好 / 失败）
      const genMsgId = newId("a");
      const genMsg: MobileChatMessage = {
        id: genMsgId,
        role: "assistant",
        content: "🎨 正在把这一刻画出来…",
        timestamp: Date.now(),
      };
      const placeholderId = Date.now();
      const placeholder: GeneratedImageItem = {
        id: placeholderId,
        imageUrl: "",
        prompt: "",
        shotNo,
        storyId,
        status: "generating",
        messageId: genMsgId,
      };
      const baseMsgs = [...messages, genMsg];
      setMessages(baseMsgs);
      setImages([...images, placeholder]);

      // 往回找最近一张用户照片，作为 image-to-image 基底
      let photoUrl: string | undefined;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user" && messages[i].photoUrl) {
          photoUrl = messages[i].photoUrl;
          break;
        }
      }
      // 把最近对话传给服务端现编出图 prompt（不传 prompt）
      const history = realMsgs
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content }));

      // 从当前镜头读取美术风格锁，确保所有面板生成的图风格一致
      const shotStyleHint = storySpineStore.getState().storyShots
        .find(s => s.shotNo === shotNo)?.styleRef || undefined;

      // 双轨：先要秒级草稿小样（服务端草稿轨不可用时会自动回落 MJ 正式版）
      const result = await generateMut.mutateAsync({
        storyId,
        shotNo,
        history,
        originalImageUrl: photoUrl,
        mode: "draft",
        styleHint: shotStyleHint,
      });

      if (result.status === "ok" && result.imageUrl) {
        const isDraft = result.mode === "draft";
        const readyImage: GeneratedImageItem = {
          id: result.imageId!,
          imageUrl: result.imageUrl,
          prompt: result.prompt ?? "",
          shotNo,
          storyId,
          status: isDraft ? "draft" : "ready",
          messageId: genMsgId,
        };
        const finalMsgs = baseMsgs.map((m) =>
          m.id === genMsgId
            ? {
                ...m,
                content: isDraft
                  ? "🎨 草稿小样好了 —— 是这个瞬间的话，点「出正式版」让 Midjourney 精画；不是就左划换一张。"
                  : "🎨 画好了 —— 喜欢就右划收下，不满意左划再来一张。",
              }
            : m
        );
        setMessages(finalMsgs);
        // 函数式更新：基于最新 state 去掉占位、再加成图，避免陈旧闭包把图丢掉
        const finalImages = [
          ...images.filter((img) => img.id !== placeholderId),
          readyImage,
        ];
        setImages((prev) => [
          ...prev.filter((img) => img.id !== placeholderId),
          readyImage,
        ]);
        persist(finalMsgs, cards, finalImages, storyId);
        void saveStoryState(finalMsgs, cards, finalImages, storyId);
      } else {
        // 失败：把这条消息改成提示，并撤掉占位图
        const finalMsgs = baseMsgs.map((m) =>
          m.id === genMsgId
            ? { ...m, content: `这张没画成：${result.error ?? "再试一次？"}` }
            : m
        );
        setMessages(finalMsgs);
        setImages(images); // 回到不含 placeholder 的状态
        persist(finalMsgs, cards, images, storyId);
        void saveStoryState(finalMsgs, cards, images, storyId);
      }
    } catch (err) {
      console.error("[generateNow] 手动出图失败:", err);
      setImages(images); // 撤掉占位图
    } finally {
      setIsGenerating(false);
    }
  }, [
    messages,
    images,
    cards,
    isGenerating,
    isReplying,
    generateMut,
    ensureStoryId,
    persist,
    saveStoryState,
  ]);

  // 双轨确认：用户认可草稿小样后，用同一条 prompt 让 MJ 出正式版替换它
  const confirmFinal = useCallback(
    async (imageId: number) => {
      const draft = images.find((img) => img.id === imageId);
      if (!draft || draft.status !== "draft" || isGenerating) return;

      setIsGenerating(true);
      // 草稿卡片进入「正在出正式版」状态
      setImages((prev) =>
        prev.map((img) =>
          img.id === imageId ? { ...img, status: "finalizing" as const } : img
        )
      );
      const noteMsgs = draft.messageId
        ? messages.map((m) =>
            m.id === draft.messageId
              ? { ...m, content: "🎨 正在出 Midjourney 正式版…（约一分钟，画好自动替换）" }
              : m
          )
        : messages;
      setMessages(noteMsgs);

      try {
        // 与草稿同源的基底照片逻辑：往回找最近一张用户照片
        let photoUrl: string | undefined;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "user" && messages[i].photoUrl) {
            photoUrl = messages[i].photoUrl;
            break;
          }
        }
        const result = await generateMut.mutateAsync({
          storyId: draft.storyId,
          shotNo: draft.shotNo,
          prompt: draft.prompt, // 直接用草稿的最终 prompt，不再现编
          originalImageUrl: photoUrl,
          draftImageId: draft.id,
          mode: "final",
        });

        if (result.status === "ok" && result.imageUrl) {
          const finalImage: GeneratedImageItem = {
            id: result.imageId!,
            imageUrl: result.imageUrl,
            prompt: result.prompt ?? draft.prompt,
            shotNo: draft.shotNo,
            storyId: draft.storyId,
            status: "ready",
            messageId: draft.messageId,
          };
          const finalMsgs = noteMsgs.map((m) =>
            m.id === draft.messageId
              ? { ...m, content: "🎨 正式版画好了 —— 喜欢就右划收下，不满意左划再来一张。" }
              : m
          );
          const nextImages = [
            ...images.filter((img) => img.id !== imageId),
            finalImage,
          ];
          setMessages(finalMsgs);
          setImages((prev) => [
            ...prev.filter((img) => img.id !== imageId),
            finalImage,
          ]);
          persist(finalMsgs, cards, nextImages, draft.storyId);
          void saveStoryState(finalMsgs, cards, nextImages, draft.storyId);
        } else {
          // 失败：退回草稿态，用户可重试
          setImages((prev) =>
            prev.map((img) =>
              img.id === imageId ? { ...img, status: "draft" as const } : img
            )
          );
          const failMsgs = noteMsgs.map((m) =>
            m.id === draft.messageId
              ? { ...m, content: `正式版没画成：${result.error ?? "再点一次试试？"}` }
              : m
          );
          setMessages(failMsgs);
        }
      } catch (err) {
        console.error("[confirmFinal] 出正式版失败:", err);
        setImages((prev) =>
          prev.map((img) =>
            img.id === imageId ? { ...img, status: "draft" as const } : img
          )
        );
      } finally {
        setIsGenerating(false);
      }
    },
    [images, messages, cards, isGenerating, generateMut, persist, saveStoryState]
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
    serverRevision.current = 0;
    persist(fresh.messages, [], [], null);
    void (async () => {
      try {
        const created = await upsertStoryMut.mutateAsync({
          title: "手机端回忆",
          body: buildMobileStoryBody(fresh.messages, [], []),
        });
        if (created?.id) {
          serverRevision.current =
            typeof created.revision === "number" ? created.revision : 0;
          setRemoteStoryId(created.id);
          hydratedStoryVersion.current = created.updatedAt
            ? `${created.id}:${String(created.updatedAt)}`
            : null;
          persist(fresh.messages, [], [], created.id);
          await utils.storyAgent.storyList.invalidate();
        }
      } catch (err) {
        console.error("[mobileChat] 新故事创建失败，已保留本地缓存:", err);
      }
    })();
  }, [persist, upsertStoryMut, utils.storyAgent.storyList]);

  const value: MobileChatContextValue = {
    messages,
    cards,
    images,
    isReplying,
    isGenerating,
    remoteStoryId,
    sendMessage,
    confirmGenerate,
    generateNow,
    confirmFinal,
    swipeRight,
    swipeLeft,
    resetConversation,
  };

  return (
    <MobileChatCtx.Provider value={value}>{children}</MobileChatCtx.Provider>
  );
}
