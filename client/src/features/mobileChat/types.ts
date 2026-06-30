/**
 * 手机端聊天出图体验的类型定义。
 * 复用 storyAgent 的基础类型，新增图片相关类型。
 */
import type { StoryCard } from "@/features/storyAgent/types";

// 聊天消息类型（扩展，支持图片）
export type MobileChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  // 用户附带的照片 URL（上传后的远程地址）
  photoUrl?: string;
  // 图片相关字段（assistant 消息才有）
  suggestImage?: boolean;           // 小酌是否建议出图
  imagePrompt?: string;             // 图片生成 prompt
  imageShotNo?: number;             // 对应的镜头编号
};

// 生成的图片
export type GeneratedImageItem = {
  id: number;
  imageUrl: string;
  prompt: string;
  shotNo?: number;
  shotIdentity?: string;
  storyId: number;
  // draft = 快轨小样（待确认）；finalizing = 已确认、MJ 正式版生成中
  status: "generating" | "ready" | "error" | "draft" | "finalizing";
  // 关联的聊天消息 id
  messageId?: string;
};

// 手机端 tab 类型
export type MobileTab = "chat" | "storyboard";

// 故事版场景（台词+图片）
export type StoryboardScene = {
  shotNo: number;
  dialogue: string;
  subject: string;
  mood: string;
  imageUrl?: string;
  imageId?: number;
};

export type SerializedMobileMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  photoUrl?: string;
  suggestImage?: boolean;
  imagePrompt?: string;
  imageShotNo?: number;
};

export type MobileStoryBody = {
  cards: StoryCard[];
  characters: [];
  shots: [];
  messages: SerializedMobileMessage[];
  mobileImages: GeneratedImageItem[];
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * 解析镜号到纯数字，兼容三种格式：数字 2、字符串 "2"、带前缀的 "SH02"/"sh2"。
 * 不同出图路径存的 shotNo 格式不一致（generateForMobile 存 "2"、director/swipe 存 "SH02"），
 * 而场景按纯数字 shotNo 配对——不统一就会导致生成图绑不回对应卡片（掉进兜底跑到别的卡）。
 * 非数字镜号（如 studio 的 "ART-R1-1"）返回 undefined，保持「未归位」语义。
 */
export function parseShotNo(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const match = /^(?:SH)?0*(\d+)$/i.exec(value.trim());
    return match ? Number(match[1]) : undefined;
  }
  return undefined;
}

export function serializeMobileMessages(
  messages: MobileChatMessage[]
): SerializedMobileMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    ...(message.photoUrl ? { photoUrl: message.photoUrl } : {}),
    ...(message.suggestImage !== undefined
      ? { suggestImage: message.suggestImage }
      : {}),
    ...(message.imagePrompt ? { imagePrompt: message.imagePrompt } : {}),
    ...(message.imageShotNo !== undefined
      ? { imageShotNo: message.imageShotNo }
      : {}),
  }));
}

export function normalizeMobileMessages(rawMessages: unknown): MobileChatMessage[] {
  if (!Array.isArray(rawMessages)) return [];
  return rawMessages
    .map((raw, index): MobileChatMessage | null => {
      if (!isRecord(raw)) return null;
      const role =
        raw.role === "user" || raw.who === "u"
          ? "user"
          : raw.role === "assistant" || raw.who === "s"
            ? "assistant"
            : null;
      const content = stringValue(raw.content) ?? stringValue(raw.text) ?? "";
      const photoUrl = stringValue(raw.photoUrl);
      if (!role || (!content.trim() && !photoUrl)) return null;

      return {
        id: stringValue(raw.id) ?? `m-${index}-${Date.now()}`,
        role,
        content,
        timestamp: numberValue(raw.timestamp) ?? Date.now() + index,
        ...(photoUrl ? { photoUrl } : {}),
        ...(typeof raw.suggestImage === "boolean"
          ? { suggestImage: raw.suggestImage }
          : {}),
        ...(stringValue(raw.imagePrompt)
          ? { imagePrompt: stringValue(raw.imagePrompt) }
          : {}),
        ...(numberValue(raw.imageShotNo) !== undefined
          ? { imageShotNo: numberValue(raw.imageShotNo) }
          : {}),
      };
    })
    .filter((message): message is MobileChatMessage => Boolean(message));
}

export function normalizeMobileCards(rawCards: unknown): StoryCard[] {
  if (!Array.isArray(rawCards)) return [];
  return rawCards
    .map((raw, index): StoryCard | null => {
      if (!isRecord(raw)) return null;
      const content = stringValue(raw.content);
      if (!content) return null;
      const title = stringValue(raw.title) ?? content.slice(0, 14);
      return {
        id: stringValue(raw.id) ?? `card-${index}-${Date.now()}`,
        title: title || "素材",
        content,
        rawText: stringValue(raw.rawText),
        sourceQuote: stringValue(raw.sourceQuote),
        emotion: stringValue(raw.emotion) ?? "",
        emotionOptions: Array.isArray(raw.emotionOptions)
          ? raw.emotionOptions.filter((item): item is string => typeof item === "string")
          : undefined,
        emotionBlend: Array.isArray(raw.emotionBlend)
          ? raw.emotionBlend.filter((item): item is string => typeof item === "string")
          : undefined,
        sensoryDetails: Array.isArray(raw.sensoryDetails)
          ? raw.sensoryDetails.filter((item): item is string => typeof item === "string")
          : [],
        intensity: numberValue(raw.intensity),
        direction: stringValue(raw.direction),
        complexity: stringValue(raw.complexity),
        trigger: stringValue(raw.trigger),
        dramaticFunction: stringValue(raw.dramaticFunction),
        personalTrace: stringValue(raw.personalTrace),
        retrievalQuery: stringValue(raw.retrievalQuery),
        themeHints: Array.isArray(raw.themeHints)
          ? raw.themeHints.filter((item): item is string => typeof item === "string")
          : undefined,
        outlierSignal: stringValue(raw.outlierSignal),
        softMembership: Array.isArray(raw.softMembership)
          ? raw.softMembership.filter((item): item is string => typeof item === "string")
          : undefined,
        createdAt: numberValue(raw.createdAt) ?? Date.now() + index,
      };
    })
    .filter((card): card is StoryCard => Boolean(card));
}

export function normalizeMobileImages(rawImages: unknown): GeneratedImageItem[] {
  if (!Array.isArray(rawImages)) return [];
  return rawImages
    .map((raw): GeneratedImageItem | null => {
      if (!isRecord(raw)) return null;
      const id = numberValue(raw.id);
      const storyId = numberValue(raw.storyId);
      const prompt = stringValue(raw.prompt);
      const imageUrl = stringValue(raw.imageUrl);
      if (id === undefined || storyId === undefined || !prompt || !imageUrl) {
        return null;
      }
      const status =
        raw.status === "ready" || raw.status === "generating" || raw.status === "error"
          ? raw.status
          : raw.status === "draft" || raw.status === "finalizing"
            ? "draft" // finalizing 重载后回到 draft：让用户重新确认，而不是悬在生成中
            : "ready";
      return {
        id,
        imageUrl,
        prompt,
        shotNo: parseShotNo(raw.shotNo),
        storyId,
        status,
        messageId: stringValue(raw.messageId),
      };
    })
    .filter((image): image is GeneratedImageItem => Boolean(image));
}

export function buildMobileStoryBody(
  messages: MobileChatMessage[],
  cards: StoryCard[],
  images: GeneratedImageItem[]
): MobileStoryBody {
  return {
    cards,
    characters: [],
    shots: [],
    messages: serializeMobileMessages(messages),
    mobileImages: images,
  };
}

export function resolveCurrentMobileShotNo(cards: StoryCard[]): number {
  return Math.max(1, cards.length);
}

export function resolveMobileImageShotNo(
  cards: StoryCard[],
  suggestedShotNo?: number
): number {
  const currentShotNo = resolveCurrentMobileShotNo(cards);
  return suggestedShotNo &&
    Number.isInteger(suggestedShotNo) &&
    suggestedShotNo >= 1 &&
    suggestedShotNo <= currentShotNo
    ? suggestedShotNo
    : currentShotNo;
}

export function buildMobileStoryboardScenes(
  cards: StoryCard[],
  images: GeneratedImageItem[],
  previousScenes: StoryboardScene[] = []
): StoryboardScene[] {
  const readyImages = images
    .filter((image) => image.status === "ready")
    .sort((left, right) => left.id - right.id);
  const usedImageIds = new Set<number>();
  const scenes = cards.map((card, index): StoryboardScene => {
    const shotNo = index + 1;
    const previous = previousScenes.find((scene) => scene.shotNo === shotNo);
    return {
      shotNo,
      dialogue: previous?.dialogue ?? card.content,
      subject: card.title,
      mood: card.emotion,
    };
  });

  for (const scene of scenes) {
    const matchedImages = readyImages.filter(
      // parseShotNo：兜住任何漏网的字符串镜号（如 "SH02"），统一成数字再和场景配对。
      (image) =>
        parseShotNo(image.shotNo) === scene.shotNo && !usedImageIds.has(image.id)
    );
    // 微信旧 WebView 不支持 Array.prototype.at，使用传统下标保持兼容。
    const matched = matchedImages[matchedImages.length - 1];
    if (matched) {
      scene.imageUrl = matched.imageUrl;
      scene.imageId = matched.id;
      usedImageIds.add(matched.id);
    }
  }

  const emptyScenes = scenes.filter((scene) => !scene.imageUrl);
  const unplacedImages = readyImages.filter(
    (image) => !usedImageIds.has(image.id)
  );
  const fallbackImages = unplacedImages.slice(-emptyScenes.length);

  emptyScenes.forEach((scene, index) => {
    const image = fallbackImages[index];
    if (!image) return;
    scene.imageUrl = image.imageUrl;
    scene.imageId = image.id;
  });

  return scenes;
}
