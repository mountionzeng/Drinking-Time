/**
 * 明确采用的经历映射（U3）。
 *
 * 这个模块存在的唯一理由是把一句话变成代码里挡得住的边界：
 * **「现在是什么状态」不等于「用户当时选了什么」。**
 *
 * `generated_images.isCurrent` 和 `publishing.activeVersionId` 都只是当前状态。
 * 它们会因为自动迁移、恢复、后台生成而变化，拿它们倒推「用户采用过」就是在
 * 伪造用户的选择。所以采用语义**只能由 router 边界显式传进来**，
 * 任何「从 metadata.source 猜」「从 isCurrent 反推」的写法都是被禁止的。
 *
 * 特别地，`promoteStoryImageToCurrent` 同时被用户点击和内部派生路径调用，
 * 它的 `metadata.source` 是给排查用的，**不是**采用凭据。
 */
import type { PersonalMemoryCapture } from "../../shared/personalMemory";
import { chinaDateString } from "./emotionDailyReference302";
import {
  isPersonalMemoryCaptureEnabled,
  PERSONAL_MEMORY_EXTRACTOR_VERSION,
} from "./personalMemoryEvents";

/**
 * 采用入口的稳定标识。每个值对应一个**用户能点到的**动作，
 * 用来解释「这条采用是从哪儿来的」，也方便日后按入口做质量分析。
 *
 * 这里刻意用闭合联合类型而不是自由字符串：新增采用入口必须来改这一行，
 * 顺带被迫回答「它到底算不算用户的明确选择」。
 */
export type ImageAdoptionEntry =
  /** 资产面板里点选某张图作为该镜头的当前首帧（含重新选回旧图）。 */
  | "select_image"
  /** 从四宫格候选里裁出单张并设为首帧。 */
  | "promote_frame_crop"
  /** 故事图片直接置为当前。 */
  | "promote_story_image"
  /** 采纳局部重绘候选。 */
  | "adopt_inpaint_candidate"
  /** 采纳发布封面候选。 */
  | "adopt_cover_candidate"
  /** 移动端右滑选中。 */
  | "swipe_right"
  /** 采纳导演建议：把这张图绑到目标镜头并成为首帧。 */
  | "director_advice";

export type ImageAdoptionContext = {
  entry: ImageAdoptionEntry;
  /** 采用发生的时刻；默认取当下。 */
  occurredAt?: Date;
  /** 安全展示元数据（镜头号等），不含图片字节与 prompt 原文。 */
  display?: Record<string, unknown> | null;
};

/**
 * 图片采用经历。
 *
 * 身份用**权威 signal 行 ID** 做修订与动作 ID：一次成功的采用对应一条
 * `imageSignals` 记录，所以经历与作品权威一一对应，不会各说各话。
 *
 * 已知边界：`promoteStoryImageToCurrent` 今天对同一次请求的重放并不去重
 * （每次都会新插一条 signal），所以网络重试会产生两条 signal、进而两条采用
 * 经历。记忆层刻意**不**在这里发明一套源头没有的去重——那会让足迹和作品
 * 历史对不上。真正的修法是让采用入口带上客户端幂等令牌，属于后续工作。
 */
export function buildImageAdoptionCapture(input: {
  userId: number;
  storyId: number;
  imageId: number;
  /** 权威 `imageSignals` 行 ID。 */
  signalId: number;
  context: ImageAdoptionContext;
}): PersonalMemoryCapture {
  const occurredAt = input.context.occurredAt ?? new Date();
  return {
    identity: {
      userId: input.userId,
      sourceType: "image_adoption",
      sourceKey: `image:${input.imageId}`,
      sourceRevision: `signal:${input.signalId}`,
      actionKind: "adopted",
      actionId: `image-adopt:${input.signalId}`,
    },
    occurredOn: chinaDateString(occurredAt),
    occurredAt: occurredAt.toISOString(),
    snapshot: {
      // 不复制图片字节，也不保存可猜测的磁盘路径——足迹展示走 U7 的受保护
      // 媒体端点，公开静态地址不得出现在这里。
      excerpt: null,
      contentHash: null,
      display: { entry: input.context.entry, ...(input.context.display ?? {}) },
    },
    storyId: input.storyId,
    job: {
      operationId: `pm-image-${input.userId}-${input.signalId}`,
      extractorVersion: PERSONAL_MEMORY_EXTRACTOR_VERSION,
    },
  };
}

/** 带 Phase 1 白名单门禁的构造器。所有调用点都应该用它。 */
export function imageAdoptionCaptureIfEnabled(
  input: Parameters<typeof buildImageAdoptionCapture>[0]
): PersonalMemoryCapture | null {
  if (!isPersonalMemoryCaptureEnabled(input.userId)) return null;
  return buildImageAdoptionCapture(input);
}

export type ArticleAdoptionEntry =
  /** 明确保存为新的发布版本。 */
  | "create_version"
  /** 采纳画册背景。 */
  | "adopt_album_background";

/**
 * 文章采用经历。
 *
 * 身份用**发布版本 ID + 操作令牌**：`writePublishingDraftState` 本来就带
 * `operationToken` 做幂等，所以这里能拿到真正的「同一次采用请求」身份——
 * 重试多少次都只产生一条经历。这一点比图片那条强，原因就是源头本身有令牌。
 *
 * 事件冻结采用时的版本身份与内容哈希；正文仍归 `stories.body.publishing`
 * 所有，这里不复制第二份可漂移的正文。
 */
export function buildArticleAdoptionCapture(input: {
  userId: number;
  storyId: number;
  versionId: string;
  operationToken: string;
  entry: ArticleAdoptionEntry;
  /** 采用时的标题／摘录，用于时间线上说明「当时采用了什么」。 */
  title: string | null;
  contentHash: string | null;
  occurredAt?: Date;
}): PersonalMemoryCapture {
  const occurredAt = input.occurredAt ?? new Date();
  return {
    identity: {
      userId: input.userId,
      sourceType: "publishing_adoption",
      sourceKey: `publishing:${input.storyId}:${input.versionId}`,
      sourceRevision: input.operationToken,
      actionKind: "adopted",
      actionId: `article-adopt:${input.operationToken}`,
    },
    occurredOn: chinaDateString(occurredAt),
    occurredAt: occurredAt.toISOString(),
    snapshot: {
      excerpt: input.title,
      contentHash: input.contentHash,
      display: { entry: input.entry, versionId: input.versionId },
    },
    storyId: input.storyId,
    job: {
      operationId: `pm-article-${input.userId}-${input.operationToken}`,
      extractorVersion: PERSONAL_MEMORY_EXTRACTOR_VERSION,
    },
  };
}

/** 带 Phase 1 白名单门禁的构造器。所有调用点都应该用它。 */
export function articleAdoptionCaptureIfEnabled(
  input: Parameters<typeof buildArticleAdoptionCapture>[0]
): PersonalMemoryCapture | null {
  if (!isPersonalMemoryCaptureEnabled(input.userId)) return null;
  return buildArticleAdoptionCapture(input);
}
