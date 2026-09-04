/**
 * 账号级足迹聚合与来源解析（U7）。
 *
 * 两条铁律，破一条这个模块就没有意义了：
 *
 * 1. **userId 只能来自认证上下文。** 这里每个导出函数都要求显式传入 userId，
 *    调用方（tRPC router、受保护媒体端点）负责从 ctx 取；任何一层都不接受
 *    客户端自称的用户身份。
 * 2. **列表不跨业务表 union，详情才回源。** 时间线只读统一事件索引——一次
 *    几十条，不可能每条都去业务表验一遍归属，而只要列表泄露了摘录，验不验
 *    归属就都晚了。所以列表只给事件自己那份最小摘录（捕获时已按展示裁剪，
 *    来源删除时会被 scrub 清空），正文一律走 resolver 逐条重新校验归属。
 */
import path from "node:path";
import fs from "node:fs";
import {
  decodePersonalMemoryTimelineCursor,
  encodePersonalMemoryTimelineCursor,
  insightLineageTip,
  parsePersonalMemorySourceRef,
  summarizePersonalMemoryDays,
  toPersonalMemoryTimelineItem,
  type PersonalMemoryEventRecord,
  type PersonalMemoryInsightRecord,
  type PersonalMemorySourceAvailability,
  type PersonalMemorySourceType,
  type PersonalMemorySummaryDay,
  type PersonalMemoryTimelineItem,
  type PersonalMemoryTimelinePage,
} from "@shared/personalMemory";
import {
  getChatMessageContentForPersonalMemory,
  getEmotionDailyLetter,
  getGeneratedImageById,
  getPersonalMemoryEventById,
  getStoryById,
  listEmotionDailyLetterVersions,
  listPersonalMemoryEventsByIds,
  listPersonalMemoryEventsForDay,
  listPersonalMemoryEventsPage,
  listPersonalMemoryEvidenceForInsight,
  listPersonalMemoryInsightLineage,
} from "./personalMemoryPersistence";
import { localImagePathForUrl } from "./imageAssets";

/** 摘要与时间线共用的默认页大小。 */
const DEFAULT_TIMELINE_LIMIT = 20;
/** 头像弹层里的摘要只取最近几个**有活动**的日期，不制造空自然日。 */
const SUMMARY_MAX_DAYS = 5;
/** 为了凑满 SUMMARY_MAX_DAYS 个日期，最多回看这么多条事件。 */
const SUMMARY_SCAN_LIMIT = 100;

export async function getPersonalMemoryTimelinePage(input: {
  userId: number;
  cursor?: string | null;
  limit?: number;
  sourceTypes?: readonly PersonalMemorySourceType[] | null;
}): Promise<PersonalMemoryTimelinePage> {
  const limit = Math.max(1, Math.min(100, input.limit ?? DEFAULT_TIMELINE_LIMIT));
  // 游标解析失败当作「从头开始」，不报错：伪造的游标最坏也只是在自己的
  // 数据里跳位置（服务端始终用认证 userId 过滤），没必要变成一个错误弹窗。
  const cursor = decodePersonalMemoryTimelineCursor(input.cursor);
  const { events, hasMore } = await listPersonalMemoryEventsPage({
    userId: input.userId,
    cursor,
    limit,
    sourceTypes: input.sourceTypes ?? null,
  });
  const items = events.map(toPersonalMemoryTimelineItem);
  const last = events[events.length - 1];
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodePersonalMemoryTimelineCursor({
            occurredAt: last.occurredAt,
            id: last.id,
          })
        : null,
  };
}

export type PersonalMemorySummary = {
  days: PersonalMemorySummaryDay[];
  /** 最近一次有记录的时间；没有任何足迹时为 null。 */
  lastActivityAt: string | null;
};

export async function getPersonalMemorySummary(input: {
  userId: number;
  maxDays?: number;
}): Promise<PersonalMemorySummary> {
  const { events } = await listPersonalMemoryEventsPage({
    userId: input.userId,
    limit: SUMMARY_SCAN_LIMIT,
  });
  const days = summarizePersonalMemoryDays(
    events,
    Math.max(1, Math.min(30, input.maxDays ?? SUMMARY_MAX_DAYS))
  );
  return { days, lastActivityAt: events[0]?.occurredAt ?? null };
}

// ─── 来源解析 ───────────────────────────────────────────────────────────

export type PersonalMemoryResolvedSource = {
  eventId: number;
  sourceType: PersonalMemorySourceType;
  availability: PersonalMemorySourceAvailability;
  /**
   * 可安全展示的正文。只有 availability === "accessible" 时才可能非空；
   * 其余状态一律 null——不返回正文、不返回缩略图地址、不返回可猜测标识。
   */
  content: string | null;
  /**
   * 深链目标。前端据此跳回来源入口；来源不可达时为 null，
   * 用户停留在时间线并看到可解释的状态。
   */
  deepLink: PersonalMemoryDeepLink | null;
  /**
   * 图片经历的受保护媒体地址。**只可能是本模块的受保护端点**，
   * 永远不是 `/api/images/...`、`/local-images/...` 或磁盘文件名。
   */
  mediaUrl: string | null;
};

export type PersonalMemoryDeepLink =
  | { kind: "story"; storyId: number }
  | { kind: "daily_letter"; letterDate: string }
  | { kind: "insight"; lineageKey: string };

/** 受保护足迹媒体端点。逐请求校验账号与图片归属，绝不走公开静态挂载。 */
export function personalMemoryMediaUrl(eventId: number): string {
  return `/api/personal-memory/media/${eventId}`;
}

function inaccessible(
  event: PersonalMemoryEventRecord,
  availability: PersonalMemorySourceAvailability
): PersonalMemoryResolvedSource {
  return {
    eventId: event.id,
    sourceType: event.sourceType,
    availability,
    content: null,
    deepLink: null,
    mediaUrl: null,
  };
}

/**
 * 解析一条经历当前还能不能回到来源。
 *
 * **失败关闭**：任何一步拿不到归属证明就当作不可访问，不猜、不降级成
 * 「大概是这条」。返回 null 表示这条经历根本不属于调用者——调用方应该
 * 当作 NOT_FOUND，而不是 FORBIDDEN：后者会把「这个 ID 存在」告诉猜 ID 的人。
 */
export async function resolvePersonalMemoryEventSource(input: {
  userId: number;
  eventId: number;
}): Promise<PersonalMemoryResolvedSource | null> {
  const event = await getPersonalMemoryEventById(input.eventId, input.userId);
  if (!event) return null;

  // 来源已被明确删除：事件只剩无内容 tombstone，不再解析回源。
  if (event.contentScrubbed) return inaccessible(event, "deleted");

  const ref = parsePersonalMemorySourceRef(event.sourceType, event.sourceKey);
  // 解析不出来源标识就停在这里。猜错的代价是把别人的资源当成这条经历展示。
  if (!ref) return inaccessible(event, "deleted");

  switch (ref.kind) {
    case "chat_message": {
      // 这个查询本身就带 userId 条件，越权消息拿不到内容。
      const content = await getChatMessageContentForPersonalMemory(
        ref.messageId,
        input.userId
      );
      if (content == null) return inaccessible(event, "deleted");
      return {
        eventId: event.id,
        sourceType: event.sourceType,
        availability: "accessible",
        content,
        deepLink: null,
        mediaUrl: null,
      };
    }
    case "daily_letter": {
      const letter = await getEmotionDailyLetter(input.userId, ref.letterDate);
      if (!letter) return inaccessible(event, "deleted");
      return {
        eventId: event.id,
        sourceType: event.sourceType,
        availability: "accessible",
        content: letter.userMessage ?? null,
        deepLink: { kind: "daily_letter", letterDate: ref.letterDate },
        mediaUrl: null,
      };
    }
    case "image": {
      const resolved = await resolvePersonalMemoryImage({
        userId: input.userId,
        imageId: ref.imageId,
      });
      if (resolved.availability !== "accessible") {
        return inaccessible(event, resolved.availability);
      }
      return {
        eventId: event.id,
        sourceType: event.sourceType,
        availability: "accessible",
        content: null,
        deepLink: resolved.storyId
          ? { kind: "story", storyId: resolved.storyId }
          : null,
        // 只给受保护端点地址。图片的 imageUrl／磁盘文件名到此为止，不出这个函数。
        mediaUrl: personalMemoryMediaUrl(event.id),
      };
    }
    case "publishing": {
      // 发布版本的归属由 Story 归属决定：拿不到 Story 就是当前无权访问。
      const story = await getStoryById(ref.storyId, input.userId);
      if (!story) return inaccessible(event, "forbidden");
      return {
        eventId: event.id,
        sourceType: event.sourceType,
        availability: "accessible",
        content: event.snapshot.excerpt,
        deepLink: { kind: "story", storyId: ref.storyId },
        mediaUrl: null,
      };
    }
    case "insight": {
      const revisions = await listPersonalMemoryInsightLineage(
        input.userId,
        ref.lineageKey
      );
      const tip = insightLineageTip({ revisions });
      if (!tip) return inaccessible(event, "deleted");
      // 已忘记：正文在 U5 就被整条 lineage 清除了，这里不复活。
      if (tip.state === "forgotten") return inaccessible(event, "deleted");
      return {
        eventId: event.id,
        sourceType: event.sourceType,
        availability: "accessible",
        content: tip.text,
        deepLink: { kind: "insight", lineageKey: ref.lineageKey },
        mediaUrl: null,
      };
    }
  }
}

type ResolvedImage = {
  availability: PersonalMemorySourceAvailability;
  storyId: number | null;
  /** 仅服务端使用的本地路径，**绝不**返回给客户端。 */
  localPath: string | null;
};

/**
 * 图片归属校验。
 *
 * 校验链是 image → storyId → `getStoryById(storyId, userId)`：以 Story 归属为准，
 * 而不是信 `generatedImages.userId`（该列可空，历史行大量为 null，用它判定
 * 等于给历史数据开后门）。
 */
async function resolvePersonalMemoryImage(input: {
  userId: number;
  imageId: number;
}): Promise<ResolvedImage> {
  const image = await getGeneratedImageById(input.imageId);
  if (!image) return { availability: "deleted", storyId: null, localPath: null };
  if (image.storyId == null) {
    // 无 Story 的图片无法证明归属，一律拒绝，不回退到 userId 列。
    return { availability: "forbidden", storyId: null, localPath: null };
  }
  const story = await getStoryById(image.storyId, input.userId);
  if (!story) {
    return { availability: "forbidden", storyId: null, localPath: null };
  }
  const localPath = localImagePathForUrl(image.imageUrl);
  if (!localPath) {
    // 还在远端／还没落盘：给「处理中」而不是「已删除」，两者对用户含义不同。
    return { availability: "processing", storyId: image.storyId, localPath: null };
  }
  if (!fs.existsSync(localPath)) {
    return { availability: "processing", storyId: image.storyId, localPath: null };
  }
  return { availability: "accessible", storyId: image.storyId, localPath };
}

/**
 * 受保护媒体端点的解析入口。
 *
 * 返回本地文件路径给 `server/_core/index.ts` 直接送字节——**不重定向到
 * `/api/images/...`**。重定向等于把公开静态地址交到浏览器手上，那条路由
 * 不鉴权，等于这一整套归属校验白做。
 */
export async function resolvePersonalMemoryMediaFile(input: {
  userId: number;
  eventId: number;
}): Promise<
  | { ok: true; localPath: string; contentType: string }
  | { ok: false; reason: "not_found" | "unavailable" }
> {
  const event = await getPersonalMemoryEventById(input.eventId, input.userId);
  if (!event) return { ok: false, reason: "not_found" };
  if (event.contentScrubbed) return { ok: false, reason: "unavailable" };
  const ref = parsePersonalMemorySourceRef(event.sourceType, event.sourceKey);
  if (!ref || ref.kind !== "image") return { ok: false, reason: "not_found" };
  const resolved = await resolvePersonalMemoryImage({
    userId: input.userId,
    imageId: ref.imageId,
  });
  if (resolved.availability !== "accessible" || !resolved.localPath) {
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    localPath: resolved.localPath,
    contentType: contentTypeForImagePath(resolved.localPath),
  };
}

function contentTypeForImagePath(localPath: string): string {
  switch (path.extname(localPath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

// ─── 按日期的详情 ────────────────────────────────────────────────────────

export type PersonalMemoryDayLetter = {
  letterDate: string;
  /** 当天有几版。legacy 数据可能只有一版。 */
  versionCount: number;
  currentVersionNumber: number | null;
};

export type PersonalMemoryDayDetail = {
  occurredOn: string;
  items: PersonalMemoryTimelineItem[];
  /**
   * 当天的来信（只读）。
   *
   * 这是详情 resolver 直接回源来信权威，不是把来信 union 进事件索引——
   * Phase 2 只需要「这天有一封信」并跳回既有来信入口。版本号语义、使用资料
   * 说明与重读导航属于 U6：在 U6 决定「哪些写入才算一个版本」之前，往
   * append-only 事件账本里写 `daily_letter_version` 行会固化一个还没定的语义，
   * 而账本是最难回滚的地方。
   */
  letter: PersonalMemoryDayLetter | null;
};

export async function getPersonalMemoryDayDetail(input: {
  userId: number;
  occurredOn: string;
}): Promise<PersonalMemoryDayDetail> {
  const events = await listPersonalMemoryEventsForDay(
    input.userId,
    input.occurredOn
  );
  const items = events.map(toPersonalMemoryTimelineItem);
  const versions = await listEmotionDailyLetterVersions(
    input.userId,
    input.occurredOn
  );
  const letter = await getEmotionDailyLetter(input.userId, input.occurredOn);
  return {
    occurredOn: input.occurredOn,
    items,
    letter:
      versions.length > 0 || letter
        ? {
            letterDate: input.occurredOn,
            versionCount: versions.length,
            currentVersionNumber:
              versions.length > 0
                ? Math.max(
                    ...versions.map(version => version.envelope.versionNumber)
                  )
                : null,
          }
        : null,
  };
}

// ─── 理解卡 ─────────────────────────────────────────────────────────────

export type PersonalMemoryInsightCard = {
  lineageKey: string;
  revision: number;
  text: string | null;
  category: PersonalMemoryInsightRecord["category"];
  origin: PersonalMemoryInsightRecord["origin"];
  state: PersonalMemoryInsightRecord["state"];
  confidence: number;
  /** 依据的来源数量。数量本身不泄露内容，用于让用户判断这条理解有多站得住。 */
  evidenceCount: number;
  /** 最早一条依据的日期，用于「依据 X 月 X 日起的 N 条记录」。 */
  earliestEvidenceOn: string | null;
  updatedAt: string;
};

export async function listPersonalMemoryInsightCards(input: {
  userId: number;
  lineageKeys: readonly string[];
}): Promise<PersonalMemoryInsightCard[]> {
  const cards: PersonalMemoryInsightCard[] = [];
  for (const lineageKey of input.lineageKeys) {
    const revisions = await listPersonalMemoryInsightLineage(
      input.userId,
      lineageKey
    );
    const tip = insightLineageTip({ revisions });
    if (!tip) continue;
    const evidence = await listPersonalMemoryEvidenceForInsight(tip.id);
    // 「依据 X 月 X 日起的 N 条记录」里的日期。证据行只存 eventId，
    // 日期在事件上，所以一次批量取回而不是逐条往返。
    const evidenceEvents = await listPersonalMemoryEventsByIds(
      input.userId,
      evidence.map(item => item.eventId)
    );
    const earliestEvidenceOn = evidenceEvents.reduce<string | null>(
      (earliest, event) =>
        earliest == null || event.occurredOn < earliest
          ? event.occurredOn
          : earliest,
      null
    );
    cards.push({
      lineageKey,
      revision: tip.revision,
      text: tip.text,
      category: tip.category,
      origin: tip.origin,
      state: tip.state,
      confidence: tip.confidence,
      evidenceCount: evidence.length,
      earliestEvidenceOn,
      updatedAt: tip.updatedAt,
    });
  }
  return cards;
}
