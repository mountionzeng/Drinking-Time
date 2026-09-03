/**
 * 用户文字的服务端捕获边界（U2）。
 *
 * 只有**服务端确认写入成功的用户文字**才在这里变成经历：普通聊天里用户敲下
 * 并成功提交的消息，以及每日回信里保存下来的留言。
 *
 * 不进来的东西同样重要，它们是产品承诺的一部分：
 *   - 未提交的草稿、键盘过程、流式调用刚开始；
 *   - 助手生成成功本身（那是模型说的话，不是用户说的）；
 *   - 失败的请求、重复重试（重试命中同一动作 ID，返回既有事件）。
 *
 * 两条持久化路径的原子边界不同，见 shared/personalMemory.ts 的说明：
 *   MySQL：事件与消息在同一个 SQL 事务里；
 *   本地：  outbox 与消息在 prompt-lineage 聚合的同一次 copy-on-write 里，
 *          统一足迹索引由 drainPersonalMemoryOutbox 幂等补齐。
 */
import {
  createEmptyPersonalMemoryEventSnapshot,
  type PersonalMemoryCapture,
  type PersonalMemoryEventSnapshot,
} from "../../shared/personalMemory";
import { chinaDateString } from "./emotionDailyReference302";
import {
  capturePersonalMemoryEvent,
  drainLocalPersonalMemoryOutbox,
  type PersonalMemoryTxScope,
} from "./personalMemoryPersistence";

/** 本地 prompt-lineage 聚合在投影水位表里的名字。 */
export const PROMPT_LINEAGE_AGGREGATE = "promptLineage";

/** 提炼器版本。换版本会产生新任务，而不是复用旧结果。 */
export const PERSONAL_MEMORY_EXTRACTOR_VERSION = "v1";

// ─── Phase 1 捕获门禁 ───────────────────────────────────────────────────

/**
 * Phase 1 只对**明确列入的内部测试账号**捕获。
 *
 * 这不是可选的谨慎，是计划里的硬门槛：向真实用户开启捕获之前，必须先有
 * 用户可见的记忆状态说明、暂停后续捕获的开关，以及清除已采集记录的入口。
 * 三者都还不存在，所以默认**谁都不捕获**——环境变量不填就是关。
 *
 * 故意不做成「默认全开、白名单为空即全部」：那种写法在部署时漏配一次，
 * 就等于对所有真实用户静默开启采集。
 */
function allowlistedUserIds(): Set<number> {
  const raw = process.env.PERSONAL_MEMORY_CAPTURE_USER_IDS ?? "";
  const ids = raw
    .split(",")
    .map(item => Number.parseInt(item.trim(), 10))
    .filter(id => Number.isInteger(id) && id > 0);
  return new Set(ids);
}

export function isPersonalMemoryCaptureEnabled(userId: number): boolean {
  return allowlistedUserIds().has(userId);
}

// ─── 来源身份构造 ───────────────────────────────────────────────────────

/**
 * 聊天消息的展示摘录上限。**只是展示用**——聊天有稳定的权威修订
 * （`story_conversation_messages` 那一行永不改写），所以完整正文永远可以
 * 回源解析。截断这里不会丢失任何东西。
 */
const CHAT_EXCERPT_MAX = 200;

function chatExcerptOf(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > CHAT_EXCERPT_MAX
    ? `${clean.slice(0, CHAT_EXCERPT_MAX)}…`
    : clean;
}

function chatSnapshotFor(content: string): PersonalMemoryEventSnapshot {
  if (!content.trim()) return createEmptyPersonalMemoryEventSnapshot();
  return {
    ...createEmptyPersonalMemoryEventSnapshot(),
    excerpt: chatExcerptOf(content),
  };
}

/**
 * 每日留言的事件快照必须存**完整原文**，不能截断。
 *
 * 这不是风格选择：日期级 `emotion_daily_letters` 行只保留当前修订，旧修订
 * 一旦被覆盖就不存在于任何别的表里。按 Source Contract Matrix，事件是
 * 「旧修订的历史权威」——截成 200 字等于默默丢掉这一条历史。
 * 上游 `cleanMessage`（emotionDailyLetters.ts）已经把留言收窄到 800 字，
 * 这里原样保留即可，不用再截一次。
 */
function dailyLetterSnapshotFor(content: string): PersonalMemoryEventSnapshot {
  if (!content.trim()) return createEmptyPersonalMemoryEventSnapshot();
  return { ...createEmptyPersonalMemoryEventSnapshot(), excerpt: content };
}

/**
 * 普通聊天用户消息的捕获输入。
 *
 * 稳定来源是**标准化消息行 ID**——不是 clientMessageId。客户端 ID 只用于
 * 幂等重试（它就是 actionId）；消息行 ID 才是这条原话在权威表里的身份，
 * 删除传播和来源解析都靠它回源。
 */
export function buildChatMessageCapture(input: {
  userId: number;
  storyId: number;
  messageId: number;
  content: string;
  clientMessageId: string;
  occurredAt: Date;
}): PersonalMemoryCapture {
  return {
    identity: {
      userId: input.userId,
      sourceType: "chat_message",
      sourceKey: `message:${input.messageId}`,
      // 聊天消息一旦写入就不再改动，所以只有一个修订。
      sourceRevision: "1",
      actionKind: "submitted",
      actionId: input.clientMessageId.trim(),
    },
    occurredOn: chinaDateString(input.occurredAt),
    occurredAt: input.occurredAt.toISOString(),
    snapshot: chatSnapshotFor(input.content),
    storyId: input.storyId,
    job: {
      operationId: `pm-chat-${input.userId}-${input.messageId}`,
      extractorVersion: PERSONAL_MEMORY_EXTRACTOR_VERSION,
    },
  };
}

/**
 * 每日回信留言的捕获输入。
 *
 * 与聊天不同，这里同一个来源会被反复改写，所以 `sourceRevision` 带修订号：
 * 每次编辑都是**新的一条经历**，旧修订仍然留在时间线上，不被改写。
 *
 * 清空留言记录为 `cleared`——那是明确的编辑／删除语义，不是一条新感悟。
 */
export function buildDailyLetterMessageCapture(input: {
  userId: number;
  letterDate: string;
  revision: number;
  message: string;
  previousMessage: string | null;
  occurredAt: Date;
}): PersonalMemoryCapture {
  const message = input.message.trim();
  const hadPrevious = Boolean(input.previousMessage?.trim());
  const actionKind = !message
    ? ("cleared" as const)
    : hadPrevious
      ? ("revised" as const)
      : ("submitted" as const);
  return {
    identity: {
      userId: input.userId,
      sourceType: "daily_letter_message",
      sourceKey: `daily-letter:${input.letterDate}`,
      sourceRevision: String(input.revision),
      actionKind,
      actionId: `daily-letter:${input.letterDate}:${input.revision}`,
    },
    // 留言属于它那一天，不是写下它的那一天——跨日补写不改写旧日期。
    occurredOn: input.letterDate,
    occurredAt: input.occurredAt.toISOString(),
    snapshot: dailyLetterSnapshotFor(message),
    storyId: null,
    // 清空不产生提炼任务：没有内容可提炼，只有删除传播要处理。
    job: message
      ? {
          operationId: `pm-letter-${input.userId}-${input.letterDate}-${input.revision}`,
          extractorVersion: PERSONAL_MEMORY_EXTRACTOR_VERSION,
        }
      : null,
  };
}

/**
 * 带门禁的捕获构造器。
 *
 * 本地路径不经过 capturePersonalMemoryInTx（它把 outbox 直接挂进聚合 draft），
 * 所以门禁必须在这一层生效——否则未列入白名单的账号会从本地路径被静默采集。
 * 这不是假设：U2 的端到端测试第一次跑就抓到了这个漏洞。
 *
 * 所有构造捕获的调用点都应该用这两个函数，而不是直接用 buildXxxCapture。
 */
export function chatMessageCaptureIfEnabled(
  input: Parameters<typeof buildChatMessageCapture>[0]
): PersonalMemoryCapture | null {
  if (!isPersonalMemoryCaptureEnabled(input.userId)) return null;
  return buildChatMessageCapture(input);
}

export function dailyLetterMessageCaptureIfEnabled(
  input: Parameters<typeof buildDailyLetterMessageCapture>[0]
): PersonalMemoryCapture | null {
  if (!isPersonalMemoryCaptureEnabled(input.userId)) return null;
  return buildDailyLetterMessageCapture(input);
}

// ─── 捕获执行 ───────────────────────────────────────────────────────────

/**
 * 在调用方的领域事务里捕获。捕获失败会让整个领域事务失败——这是有意的：
 * 「消息保存成功但经历丢了」会静默制造历史缺口，而调用方凭原 client ID
 * 重试是安全的。
 *
 * 账号不在 Phase 1 白名单内时直接跳过，不写任何行。
 */
export async function capturePersonalMemoryInTx(
  scope: PersonalMemoryTxScope,
  capture: PersonalMemoryCapture | null
): Promise<void> {
  if (!capture) return;
  // 门禁在构造器里已经生效过一次；这里再挡一次是纵深防御——
  // 捕获入口只会越来越多，而漏掉门禁的后果是对真实用户静默采集。
  if (!isPersonalMemoryCaptureEnabled(capture.identity.userId)) return;
  await capturePersonalMemoryEvent(scope, capture);
}

/**
 * 把 prompt-lineage 聚合里积压的 outbox 投影进统一足迹索引。
 *
 * 幂等且可重复调用：崩在投影中间、水位被坏写抹掉、同一条被重复投递，
 * 结果都和只投一次一样（见 projectPersonalMemoryOutbox 的两道保险）。
 *
 * 投影失败**不应该**让用户的聊天保存失败——消息和 outbox 已经安全落盘了，
 * 补投是后台的事。所以这里吞掉错误并如实返回 `projected: false`，
 * 由调用方决定要不要记一笔。
 */
export async function drainPersonalMemoryOutbox(): Promise<{
  projected: boolean;
  applied: number;
}> {
  try {
    const result = await drainLocalPersonalMemoryOutbox();
    return { projected: true, applied: result.applied };
  } catch (error) {
    console.warn(
      "[PersonalMemory] 足迹投影失败，outbox 保留待补投：",
      error instanceof Error ? error.message : error
    );
    return { projected: false, applied: 0 };
  }
}
