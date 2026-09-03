/**
 * 历史经历回填（U4）。
 *
 * **默认 dry-run，且当前禁止 apply。** 原因写在 assertApplyAllowed 里：
 * apply 会一次性产生大量提炼任务，而 U5 的 runner、暂停开关和积压指标还没有，
 * 真跑下去就是无节制地轰击模型供应商并烧掉平台预算。
 *
 * 这个脚本的价值在 dry-run 本身：它把「哪些历史能证明、哪些证明不了」分门别类
 * 报出来。**报告里说不清楚的，就不写。** 宁可留一个可解释的历史缺口，也不拿
 * 当前状态倒推用户当年的选择。
 */
import {
  normalizePersonalMemoryEventIdentity,
  type PersonalMemoryCapture,
} from "../shared/personalMemory";

// ─── 分类结果 ───────────────────────────────────────────────────────────

export type BackfillClassification =
  /** 能证明来源、归属与时间，可以确定性写入。 */
  | "deterministic"
  /** 来源记录不完整（缺 userId／storyId／时间），无法证明归属。 */
  | "source_incomplete"
  /** 记录本身完整，但**无法区分是用户选择还是系统自动**。绝不猜。 */
  | "ambiguous"
  /** 能证明它**不是**用户采用（自动路径产生），明确排除。 */
  | "rejected_not_adoption";

export type BackfillCandidate = {
  classification: BackfillClassification;
  /** 定位用，不含用户原话。 */
  ref: string;
  reason: string;
  /** 仅 deterministic 时非空。 */
  capture: PersonalMemoryCapture | null;
};

export type BackfillReport = {
  schemaVersion: string;
  /** 各来源的高水位，apply 时必须仍然匹配，否则说明期间有新数据进来。 */
  highWatermarks: Record<string, number>;
  counts: Record<BackfillClassification, number>;
  candidates: BackfillCandidate[];
};

// ─── 输入形状 ───────────────────────────────────────────────────────────
//
// 刻意用最小的普通对象而不是 drizzle 行类型：分类逻辑要能在没有数据库的情况下
// 被测试，MySQL 与本地两条路径也各自把行读出来喂进同一套判定。

export type ChatMessageRow = {
  id: number;
  userId: number | null;
  storyId: number | null;
  role: string;
  content: string;
  clientMessageId: string | null;
  createdAt: string | null;
};

export type DailyLetterRow = {
  userId: number;
  letterDate: string;
  userMessage: string | null;
  revision: number;
  createdAt: string | null;
};

export type ImageSignalRow = {
  id: number;
  userId: number | null;
  storyId: number | null;
  imageId: number | null;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string | null;
  /** 该图片当前记录的归属 Story，用于核对 signal 是否自洽。 */
  imageStoryId?: number | null;
  /** 该 Story 的实际 owner，用于核对跨账号污染。 */
  storyOwnerUserId?: number | null;
};

export type PublishingReceiptRow = {
  userId: number;
  storyId: number;
  versionId: string;
  operationToken: string;
  title: string | null;
  contentHash: string | null;
  committedAt: string | null;
};

export type BackfillSources = {
  chatMessages: ChatMessageRow[];
  dailyLetters: DailyLetterRow[];
  imageSignals: ImageSignalRow[];
  publishingReceipts: PublishingReceiptRow[];
};

export const BACKFILL_SCHEMA_VERSION = "0017";
const EXTRACTOR_VERSION = "v1";

/**
 * 明确由**自动路径**写下的 signal。这些能证伪，直接排除。
 *
 * 注意这跟 U3 的「禁止从 metadata.source 反推采用」不矛盾：那条禁的是拿它当
 * **采用凭据**（把自动行为说成用户选择）；这里是拿它**排除**候选，方向相反，
 * 出错的后果也相反——多排除一条只是留个缺口，多写一条就是伪造历史。
 */
const AUTOMATIC_SIGNAL_SOURCES = new Set([
  "generate_for_mobile_auto_select",
]);

/**
 * 无法证明「用户确实点过」的入口。
 *
 * `director_advice` 是 Phase 0 复审点名的：这个入口今天还没有客户端调用点，
 * 所以历史上带这个 source 的 signal 到底怎么来的说不清，只能进歧义报告。
 */
const UNPROVABLE_SIGNAL_SOURCES = new Set(["director_advice"]);

function isoOrNull(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function chinaDate(iso: string): string {
  // 与 chinaDateString 同口径：UTC+8 后取日期部分。这里不引服务层，
  // 是为了让脚本能被单测直接加载而不牵进整条 server 依赖。
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

function safeCapture(capture: PersonalMemoryCapture): BackfillCandidate {
  // 身份不合法的候选一律降级，绝不带着坏身份写进去。
  try {
    normalizePersonalMemoryEventIdentity(capture.identity);
    return {
      classification: "deterministic",
      ref: `${capture.identity.sourceType}:${capture.identity.sourceKey}`,
      reason: "来源、归属与时间齐全",
      capture,
    };
  } catch (error) {
    return {
      classification: "source_incomplete",
      ref: `${capture.identity.sourceType}:${capture.identity.sourceKey}`,
      reason: `身份不合法：${error instanceof Error ? error.message : String(error)}`,
      capture: null,
    };
  }
}

/** 普通聊天：标准化消息行有稳定 ID、归属和时间，是最干净的一类。 */
export function classifyChatMessages(
  rows: readonly ChatMessageRow[]
): BackfillCandidate[] {
  return rows.flatMap(row => {
    if (row.role !== "user") return []; // 助手的话不是用户经历
    const ref = `message:${row.id}`;
    if (row.userId == null || row.storyId == null) {
      return [{
        classification: "source_incomplete" as const,
        ref,
        reason: "消息缺少 userId 或 storyId，无法证明归属",
        capture: null,
      }];
    }
    const createdAt = isoOrNull(row.createdAt);
    if (!createdAt) {
      return [{
        classification: "source_incomplete" as const,
        ref,
        reason: "消息缺少可解析的原始时间",
        capture: null,
      }];
    }
    // 历史消息可能没有 clientMessageId（早期写入）。动作 ID 退回消息行 ID：
    // 它同样稳定且唯一，重跑回填仍然幂等。
    const actionId = row.clientMessageId?.trim() || `message:${row.id}`;
    return [safeCapture({
      identity: {
        userId: row.userId,
        sourceType: "chat_message",
        sourceKey: ref,
        sourceRevision: "1",
        actionKind: "submitted",
        actionId,
      },
      occurredOn: chinaDate(createdAt),
      occurredAt: createdAt,
      snapshot: { excerpt: null, contentHash: null, display: null },
      storyId: row.storyId,
      job: {
        operationId: `pm-chat-${row.userId}-${row.id}`,
        extractorVersion: EXTRACTOR_VERSION,
      },
    })];
  });
}

/**
 * 每日留言：日期级行只保留**当前**修订，旧修订在 U1 之前根本没被保存过。
 * 所以这里只能回填「当前这一版」，并如实说明历史修订不可恢复。
 */
export function classifyDailyLetters(
  rows: readonly DailyLetterRow[]
): BackfillCandidate[] {
  return rows.flatMap(row => {
    const ref = `daily-letter:${row.letterDate}`;
    const message = row.userMessage?.trim() ?? "";
    if (!message) return []; // 没写过留言的日期没有经历可回填
    const createdAt = isoOrNull(row.createdAt) ?? `${row.letterDate}T00:00:00.000Z`;
    return [safeCapture({
      identity: {
        userId: row.userId,
        sourceType: "daily_letter_message",
        sourceKey: ref,
        sourceRevision: String(row.revision),
        // U1 之前没有修订轨迹，只能确认「这一版存在」，不能断言它是首次写下
        // 还是改过很多次之后的样子。用 submitted 会撒谎，所以用 revised。
        actionKind: row.revision > 1 ? "revised" : "submitted",
        actionId: `daily-letter:${row.letterDate}:${row.revision}`,
      },
      occurredOn: row.letterDate,
      occurredAt: createdAt,
      snapshot: { excerpt: null, contentHash: null, display: null },
      storyId: null,
      job: {
        operationId: `pm-letter-${row.userId}-${row.letterDate}-${row.revision}`,
        extractorVersion: EXTRACTOR_VERSION,
      },
    })];
  });
}

/**
 * 图片采用：**历史上基本无法证明**，这是这份报告最重要的结论。
 *
 * `promoteStoryImageToCurrent` 无论被用户点击还是被自动路径调用，写下的
 * signal 都是 `action: "swipe_right"`，行的形状完全一样。U3 之后新产生的采用
 * 有显式凭据，但**历史行没有**。所以除了能证伪的自动来源，其余一律进歧义报告
 * ——写进去就是在伪造用户当年的选择。
 */
export function classifyImageSignals(
  rows: readonly ImageSignalRow[]
): BackfillCandidate[] {
  return rows.flatMap(row => {
    if (row.action !== "swipe_right") return []; // 只有右滑语义可能是采用
    const ref = `image-signal:${row.id}`;
    if (row.userId == null || row.storyId == null || row.imageId == null) {
      return [{
        classification: "source_incomplete" as const,
        ref,
        reason: "signal 缺少 userId／storyId／imageId",
        capture: null,
      }];
    }
    if (
      row.imageStoryId != null &&
      row.imageStoryId !== row.storyId
    ) {
      return [{
        classification: "source_incomplete" as const,
        ref,
        reason: "signal 的 storyId 与图片自身归属不一致",
        capture: null,
      }];
    }
    if (
      row.storyOwnerUserId != null &&
      row.storyOwnerUserId !== row.userId
    ) {
      return [{
        classification: "source_incomplete" as const,
        ref,
        reason: "signal 的 userId 与 Story owner 不一致（疑似跨账号污染）",
        capture: null,
      }];
    }
    const source =
      typeof row.metadata?.source === "string" ? row.metadata.source : null;
    if (source && AUTOMATIC_SIGNAL_SOURCES.has(source)) {
      return [{
        classification: "rejected_not_adoption" as const,
        ref,
        reason: `由自动路径写入（source=${source}），确定不是用户采用`,
        capture: null,
      }];
    }
    return [{
      classification: "ambiguous" as const,
      ref,
      reason: source && UNPROVABLE_SIGNAL_SOURCES.has(source)
        ? `入口 ${source} 尚无客户端调用点，无法证明用户确实点过`
        : "swipe_right 由用户点击和内部提升共同写入，历史行无法区分",
      capture: null,
    }];
  });
}

/**
 * 文章采用：这一类**能**证明。
 *
 * 发布链路把 `versionOperationReceipts` 持久化下来了，一条收据 = 一次带令牌的
 * 明确 create_version 请求。这是历史里唯一自带「用户意图凭据」的采用来源。
 */
export function classifyPublishingReceipts(
  rows: readonly PublishingReceiptRow[]
): BackfillCandidate[] {
  return rows.map(row => {
    const ref = `publishing:${row.storyId}:${row.versionId}`;
    const committedAt = isoOrNull(row.committedAt);
    if (!committedAt) {
      return {
        classification: "source_incomplete" as const,
        ref,
        reason: "收据缺少可解析的提交时间",
        capture: null,
      };
    }
    return safeCapture({
      identity: {
        userId: row.userId,
        sourceType: "publishing_adoption",
        sourceKey: ref,
        sourceRevision: row.operationToken,
        actionKind: "adopted",
        actionId: `article-adopt:${row.operationToken}`,
      },
      occurredOn: chinaDate(committedAt),
      occurredAt: committedAt,
      snapshot: {
        excerpt: row.title,
        contentHash: row.contentHash,
        display: { entry: "create_version", versionId: row.versionId },
      },
      storyId: row.storyId,
      job: {
        operationId: `pm-article-${row.userId}-${row.operationToken}`,
        extractorVersion: EXTRACTOR_VERSION,
      },
    });
  });
}

/** 汇总成一份可审阅、可比对的 manifest。 */
export function buildBackfillReport(sources: BackfillSources): BackfillReport {
  const candidates = [
    ...classifyChatMessages(sources.chatMessages),
    ...classifyDailyLetters(sources.dailyLetters),
    ...classifyImageSignals(sources.imageSignals),
    ...classifyPublishingReceipts(sources.publishingReceipts),
  ];
  const counts: Record<BackfillClassification, number> = {
    deterministic: 0,
    source_incomplete: 0,
    ambiguous: 0,
    rejected_not_adoption: 0,
  };
  for (const candidate of candidates) counts[candidate.classification] += 1;

  const maxId = (rows: readonly { id: number }[]) =>
    rows.reduce((max, row) => Math.max(max, row.id), 0);

  return {
    schemaVersion: BACKFILL_SCHEMA_VERSION,
    highWatermarks: {
      chatMessages: maxId(sources.chatMessages),
      imageSignals: maxId(sources.imageSignals),
      dailyLetters: sources.dailyLetters.length,
      publishingReceipts: sources.publishingReceipts.length,
    },
    counts,
    candidates,
  };
}

export class BackfillApplyBlockedError extends Error {
  constructor(reason: string) {
    super(`回填 apply 被阻断：${reason}`);
    this.name = "BackfillApplyBlockedError";
  }
}

/**
 * apply 的门禁。
 *
 * 现在**永远拒绝**，而且这不是占位符——U4 的计划依赖写得很清楚：
 * 「dry-run 可先执行，apply 必须等 U5 的 runner、pause 开关和积压指标可用」。
 * 回填会一次性产生成千上万条提炼任务；没有暂停开关和积压预算就 apply，
 * 等于无节制地轰击模型供应商并烧掉平台预算，还没有办法叫停。
 *
 * 解除条件（U5 完成后逐条核对，不要只删掉这个函数）：
 *  1. runner 可显式 start／stop，且有独立 kill switch；
 *  2. 有 oldest-pending-age 与积压计数指标；
 *  3. 回填按 manifest 分块、每块短事务 + checkpoint；
 *  4. 平台预算与用户级频率上限已接入算力账本。
 */
export function assertApplyAllowed(): never {
  throw new BackfillApplyBlockedError(
    "U5 的 runner、暂停开关与积压指标尚未就绪；" +
      "现在 apply 会一次性产生大量提炼任务且无法叫停。请先完成 U5。"
  );
}
