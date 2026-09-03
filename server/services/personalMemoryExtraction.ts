/**
 * 从单条经历生成带证据的理解（U5）。
 *
 * 这是 U5 里唯一会花钱、会连模型的一层。它只做一件事：把一个 job 对应的
 * 一条经历，喂给结构化模型调用，产出结构校验过的 mutation 列表，交回给
 * job runner。**它自己不改数据库**——写入与状态机判定都在
 * `completePersonalMemoryExtractionJob`（server/db.ts）里，那里才是「旧任务
 * 不能覆盖新纠正」这条不变量真正生效的地方。
 *
 * 单次调用只尝试一次。跨进程的指数退避、最大次数和永久失败由 job runner
 * 决定——这里只负责回答「这一次到底发生了什么」。
 */
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "../../shared/canonicalJson";
import { ENV } from "../_core/env";
import { runInference } from "../_core/inferenceOrchestrator";
import { parseJsonLoose } from "../_core/llmJson";
import type { Message } from "../_core/llm";
import {
  resolveComputeCandidates,
  type TextComputeProvider,
  type TextComputeProviderId,
} from "../_core/textComputeProvider";
import { fromYuan } from "../../shared/computeMoney";
import { reserveForOperation, settleOperation } from "./computeLedger";
import {
  getChatMessageContentForPersonalMemory,
  getPersonalMemoryEventById,
  getUserByOpenId,
  listActivePersonalMemoryInsightCandidates,
  upsertUser,
} from "./personalMemoryPersistence";
import {
  STATEMENT_TYPES_WITHOUT_INSIGHTS,
  deriveInsightOrigin,
  type PersonalMemoryEventRecord,
  type PersonalMemoryInsightCategory,
  type PersonalMemoryInsightMutation,
  type PersonalMemoryInsightRecord,
  type PersonalMemoryStatementType,
} from "../../shared/personalMemory";

// ─── 平台预算账户（U5）───────────────────────────────────────────────────
//
// Phase 1-2 的提炼由平台预算承担，不扣用户余额（计划明确要求）。但「不扣
// 用户余额」不等于「不过账本」——每次调用仍然要走 reserveForOperation／
// settleOperation，只是预占的账号换成这个专用的平台系统账户，而不是真实
// 用户。这样报价、供应商 attempt、实际成本、失败与未知结果依然被完整记录，
// 只是账落在平台自己头上。
//
// 刻意不自动充值这个账户：账户建好之后余额是 0，`reserveForOperation`
// 会返回 insufficient_balance，job runner 把它当成「等待中」而不是失败，
// 任务安全地停在 pending。谁往这个账户充值、充多少，是运营侧要做的独立
// 决定——这里不替那个决定背书，也不应该由代码悄悄决定。

const PERSONAL_MEMORY_PLATFORM_OPEN_ID = "system:personal-memory-extraction";

let platformAccountIdPromise: Promise<number> | null = null;

export async function ensurePersonalMemoryPlatformAccount(): Promise<number> {
  if (!platformAccountIdPromise) {
    platformAccountIdPromise = (async () => {
      await upsertUser({
        openId: PERSONAL_MEMORY_PLATFORM_OPEN_ID,
        name: "个人记忆提炼平台账户",
        loginMethod: "system",
      });
      const user = await getUserByOpenId(PERSONAL_MEMORY_PLATFORM_OPEN_ID);
      if (!user) throw new Error("平台账户创建后读不回");
      return user.id;
    })();
    platformAccountIdPromise.catch(() => {
      platformAccountIdPromise = null; // 失败不缓存，下次调用重试
    });
  }
  return platformAccountIdPromise;
}

/** 仅测试用：清掉缓存，让下一次调用重新解析/创建平台账户。 */
export function resetPersonalMemoryPlatformAccountCacheForTesting(): void {
  platformAccountIdPromise = null;
}

// ─── 模型供应商 allowlist（U5）───────────────────────────────────────────
//
// 「个人记忆提炼使用专用模型供应商 allowlist：只有列入清单的供应商与模型
// 可以处理个人记忆内容...进入清单前必须书面确认该供应商的数据留存时长、
// 是否用于训练和数据地域」——这是产品/法务决定，不是工程可以单方面拍板的
// 事。默认**空**：没有任何供应商被批准处理个人记忆内容。留空不是「还没
// 写完」，是「还没有人做出那个决定」。空的时候提炼判 not_configured，
// 永远重试、不占永久失败名额——一旦运营侧走完批准流程、配置了这个变量，
// 积压的任务会在下一轮自然捞起来跑，不需要重新入队。
function providerAllowlist(): ReadonlySet<TextComputeProviderId> {
  const raw = process.env.PERSONAL_MEMORY_PROVIDER_ALLOWLIST ?? "";
  const ids = raw
    .split(",")
    .map(item => item.trim())
    .filter(
      (item): item is TextComputeProviderId =>
        item === "openai-next" || item === "302"
    );
  return new Set(ids);
}

function allowlistedCandidates(): TextComputeProvider[] {
  const allow = providerAllowlist();
  if (allow.size === 0) return [];
  const resolved = resolveComputeCandidates("text", {
    fallback302Model: ENV.llmModel,
  });
  return resolved.filter(candidate => allow.has(candidate.id));
}

// ─── 结构化输出契约 ──────────────────────────────────────────────────────

const EXTRACTOR_PROMPT_VERSION = "u5-v1";
const EXTRACTION_TIMEOUT_MS = 20_000;
/**
 * 每次提炼调用的可信费用上界（微元）。这不是按 token 精算的报价——这套
 * 代码库目前没有把逐模型单价接进 textComputeProvider，所以用一个保守的
 * 固定上界代替：单条经历 + 少量候选 + 有界输出，价格天然可控。运营侧可以
 * 通过环境变量收紧或放宽，但**不能没有上界**——那正是
 * `planReservation` 拒绝 `no_trusted_max_cost` 要挡住的情况。
 */
function maxCostMinorPerExtraction(): number {
  const override = Number(process.env.PERSONAL_MEMORY_EXTRACTION_MAX_COST_YUAN);
  const yuan = Number.isFinite(override) && override > 0 ? override : 0.05;
  return fromYuan(yuan);
}

/**
 * 按 token 用量粗略估算实际花费，微元。
 *
 * 这不是精算——这套代码库没有把逐模型单价接进 textComputeProvider，没有
 * 「这次调用真的花了多少钱」的可信数据源。但结算成本**不能因此永远是 0**：
 * 那样平台账本就看不见真实开销，跟没记账没区别。用一个保守、可配置的
 * 单价把 token 用量换算成成本，好过假装免费；供应商真实计费数据接入后，
 * 这里应该被替换成对账后的真实值，而不是继续估算。
 */
function estimateVerifiedCostMinor(usage: { total_tokens: number } | undefined): number {
  if (!usage) return 0;
  const override = Number(
    process.env.PERSONAL_MEMORY_EXTRACTION_COST_PER_1K_TOKENS_YUAN
  );
  const yuanPer1k = Number.isFinite(override) && override > 0 ? override : 0.01;
  const estimated = fromYuan((usage.total_tokens / 1000) * yuanPer1k);
  // 永远不能超过预占的上界——估算走偏也不能突破可信费用上界这条红线。
  return Math.min(estimated, maxCostMinorPerExtraction());
}

/** 候选列表里给模型看的最少必要信息——不带 userId、不带内部数据库 id。 */
type CandidateForPrompt = {
  ref: string; // "C1", "C2", ... 模型用这个引用候选，不接触真实 lineageKey
  lineageKey: string;
  revision: number;
  category: PersonalMemoryInsightCategory;
  text: string;
};

function buildCandidatePrompts(
  candidates: PersonalMemoryInsightRecord[]
): CandidateForPrompt[] {
  return candidates.map((candidate, index) => ({
    ref: `C${index + 1}`,
    lineageKey: candidate.lineageKey,
    revision: candidate.revision,
    category: candidate.category,
    text: candidate.text ?? "",
  }));
}

/**
 * 这条经历要不要提炼、喂给模型的是什么。
 *
 * - chat_message / daily_letter_message：用户自己的文字，回源取完整正文。
 * - image_adoption / publishing_adoption：**行为信号**，不是文字陈述——
 *   提示词里明确告诉模型这一点，产出的理解在下面统一被强制降级为
 *   inferred，不管模型自己怎么判 statementType。
 * - insight / daily_letter_version：理解状态变化和来信版本自身不提炼——
 *   它们是系统动作的记录，不是可以从中挖出「用户是什么样的人」的原始经历。
 */
async function resolveExtractionSubject(
  event: PersonalMemoryEventRecord
): Promise<{ content: string; isBehaviorSignal: boolean } | null> {
  if (event.contentScrubbed) return null;

  if (event.sourceType === "chat_message") {
    const messageId = Number(event.sourceKey.replace(/^message:/, ""));
    const full = Number.isInteger(messageId)
      ? await getChatMessageContentForPersonalMemory(messageId, event.userId)
      : null;
    const content = full ?? event.snapshot.excerpt;
    return content ? { content, isBehaviorSignal: false } : null;
  }

  if (event.sourceType === "daily_letter_message") {
    // U2 已经把这里改成存完整原文（不是展示摘录），见 personalMemoryEvents.ts
    // 的 dailyLetterSnapshotFor：日期级行只留当前修订，事件是旧修订唯一的
    // 历史权威，截断等于默默丢历史。
    const content = event.snapshot.excerpt;
    return content ? { content, isBehaviorSignal: false } : null;
  }

  if (event.sourceType === "image_adoption") {
    const display = event.snapshot.display as { entry?: unknown } | null;
    const entry = typeof display?.entry === "string" ? display.entry : "未知入口";
    return {
      content: `用户明确采用了一张图片（采用入口：${entry}）。`,
      isBehaviorSignal: true,
    };
  }

  if (event.sourceType === "publishing_adoption") {
    const excerpt = event.snapshot.excerpt;
    return {
      content: `用户明确采用了一篇文章作为发布版本${excerpt ? `，标题或摘录：「${excerpt}」` : ""}。`,
      isBehaviorSignal: true,
    };
  }

  return null; // insight / daily_letter_version：不提炼
}

const SYSTEM_PROMPT = `你在帮一个私密个人记忆系统从用户的一条经历里，判断能不能形成一条关于这个人的理解。

严格规则：
1. 只输出 JSON，不要输出任何 JSON 之外的文字。
2. statementType 必须是以下之一：direct_statement（用户直接陈述的事实/感受/偏好）、
   question（提问，不是陈述）、quotation（引用别人说的话，不是用户自己的话）、
   hypothesis（假设性的话，"如果""要是"之类）、
   project_scoped_instruction（只针对当前这个项目/作品的一次性要求，不是对本人的长期描述）、
   inferred_behavior（这是一次行为信号，不是文字陈述——比如采用了某个作品）。
3. question / quotation / hypothesis 这三类**永远不产生任何理解**，insights 必须是空数组。
4. project_scoped_instruction 产生的理解只能是项目内的临时要求，绝不能写成关于这个人长期是什么样的判断。
5. 允许 insights 是空数组——大多数经历本来就不该形成理解，不要为了有输出而牵强附会。
6. 涉及健康、心理状态、人际关系、隐私的内容要格外克制，不要下诊断性判断，不要断言因果。
7. 每条理解的 text 不超过 60 个汉字，用平实的第三人称陈述，不要引用原话，不要提具体日期。
8. 如果候选列表里已经有相似的理解，判断这条新证据是在**强化**它（内容一致，只是又一次证据）
   还是在**推翻/修正**它（内容与候选矛盾，应该用新理解替代旧理解）；如果都不像，就是全新理解。

只输出如下 JSON 结构：
{
  "statementType": "...",
  "insights": [
    {
      "matchLineage": "C1 这样的候选引用，或者 null 表示这是全新的理解",
      "isContradiction": true/false（只有 matchLineage 不是 null 时才有意义：强化=false，修正=true）,
      "category": "fact" | "preference" | "relationship" | "goal" | "concern" | "reflection",
      "text": "简体中文，不超过 60 字",
      "projectScoped": true/false,
      "confidence": 0 到 1 之间的数字,
      "sensitive": true/false
    }
  ]
}`;

function buildExtractionMessages(input: {
  content: string;
  isBehaviorSignal: boolean;
  candidates: CandidateForPrompt[];
}): Message[] {
  const candidateLines = input.candidates.length
    ? input.candidates
        .map(c => `${c.ref}（${c.category}）：${c.text}`)
        .join("\n")
    : "（当前没有可能相关的既有理解）";
  const userText = [
    input.isBehaviorSignal
      ? "下面是一次用户的行为信号，不是用户说的话：\n"
      : "下面是用户自己写下的一段话：\n",
    `「${input.content}」`,
    "\n可能相关的既有理解候选：",
    candidateLines,
  ].join("");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userText },
  ];
}

// ─── 模型输出的结构校验 ──────────────────────────────────────────────────
//
// 「模型输出可以为空，也必须经过结构校验」——下面全是白名单式的防御性解析，
// 不信任模型给的任何一个字段；不认识的值一律丢弃这一条理解，而不是猜一个
// 默认值糊弄过去。

const VALID_STATEMENT_TYPES: ReadonlySet<PersonalMemoryStatementType> = new Set([
  "direct_statement",
  "question",
  "quotation",
  "hypothesis",
  "project_scoped_instruction",
  "inferred_behavior",
]);

const VALID_CATEGORIES: ReadonlySet<PersonalMemoryInsightCategory> = new Set([
  "fact",
  "preference",
  "relationship",
  "goal",
  "concern",
  "reflection",
]);

const INSIGHT_TEXT_MAX = 60;

type ParsedInsight = {
  matchLineage: string | null;
  isContradiction: boolean;
  category: PersonalMemoryInsightCategory;
  text: string;
  projectScoped: boolean;
  confidence: number;
  sensitive: boolean;
};

function parseStatementType(value: unknown): PersonalMemoryStatementType | null {
  return typeof value === "string" &&
    VALID_STATEMENT_TYPES.has(value as PersonalMemoryStatementType)
    ? (value as PersonalMemoryStatementType)
    : null;
}

function parseInsightEntry(raw: unknown): ParsedInsight | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const category =
    typeof value.category === "string" &&
    VALID_CATEGORIES.has(value.category as PersonalMemoryInsightCategory)
      ? (value.category as PersonalMemoryInsightCategory)
      : null;
  const text =
    typeof value.text === "string" ? value.text.trim().slice(0, INSIGHT_TEXT_MAX) : "";
  if (!category || !text) return null;
  const confidenceRaw = Number(value.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.3;
  return {
    matchLineage: typeof value.matchLineage === "string" ? value.matchLineage : null,
    isContradiction: value.isContradiction === true,
    category,
    text,
    projectScoped: value.projectScoped === true,
    confidence,
    sensitive: value.sensitive === true,
  };
}

/**
 * 把模型的原始 JSON 转成 mutation 列表。
 *
 * 这里做的过滤全部是**结构性、不可协商**的，不依赖模型自觉：
 *   - statementType 解析不出来 → 视为无法提炼，返回空数组（不是报错，也不是
 *     猜一个类型硬凑）；
 *   - question/quotation/hypothesis → 结果强制清空，即使模型自己在
 *     insights 里塞了东西；
 *   - project_scoped_instruction → 所有理解强制 scope=project，模型说
 *     projectScoped=false 也不作数；
 *   - 行为信号来源（图片/文章采用）→ origin 强制降到 inferred，
 *     不管 statementType 判成什么。
 */
export function mapExtractionOutputToMutations(
  raw: unknown,
  context: { candidates: CandidateForPrompt[]; isBehaviorSignal: boolean }
): PersonalMemoryInsightMutation[] {
  if (!raw || typeof raw !== "object") return [];
  const value = raw as Record<string, unknown>;
  const statementType = parseStatementType(value.statementType);
  if (!statementType) return []; // 判不出类型，宁可什么都不提炼

  if (STATEMENT_TYPES_WITHOUT_INSIGHTS.has(statementType)) return [];

  const insightsRaw = Array.isArray(value.insights) ? value.insights : [];
  const candidateByRef = new Map(context.candidates.map(c => [c.ref, c]));

  const mutations: PersonalMemoryInsightMutation[] = [];
  for (const entry of insightsRaw) {
    const parsed = parseInsightEntry(entry);
    if (!parsed) continue;

    const projectScoped =
      statementType === "project_scoped_instruction" ? true : parsed.projectScoped;
    const origin = context.isBehaviorSignal
      ? "inferred"
      : deriveInsightOrigin(
          statementType,
          parsed.matchLineage && parsed.isContradiction ? "supersede" : "new"
        );
    const allowProactiveMention = !parsed.sensitive;
    // 已知范围限制：这一版的 scope 只是「是否项目限定」的粗粒度标记，不带
    // 精确 storyId——个人记忆事件当前不持有 storyId（本地模式的经历本身
    // 就是来源，没有单独的 sources 注册表可以回查）。按 Story 精确过滤是
    // U6 记忆选择器要解决的问题，不在这次范围内。
    const scope = projectScoped ? { projectScoped: true } : null;

    const matched = parsed.matchLineage
      ? candidateByRef.get(parsed.matchLineage)
      : null;

    if (!matched) {
      mutations.push({
        action: "new",
        origin,
        category: parsed.category,
        text: parsed.text,
        scope,
        confidence: parsed.confidence,
        allowProactiveMention,
      });
      continue;
    }

    if (parsed.isContradiction) {
      mutations.push({
        action: "supersede",
        lineageKey: matched.lineageKey,
        expectedRevision: matched.revision,
        origin,
        category: parsed.category,
        text: parsed.text,
        scope,
        confidence: parsed.confidence,
        allowProactiveMention,
      });
    } else {
      mutations.push({
        action: "reinforce",
        lineageKey: matched.lineageKey,
        expectedRevision: matched.revision,
      });
    }
  }
  return mutations;
}

// ─── 编排：一次完整的提炼尝试 ────────────────────────────────────────────

export type PersonalMemoryExtractionOutcome =
  | { kind: "completed"; mutations: PersonalMemoryInsightMutation[] }
  | { kind: "skipped"; reason: "content_scrubbed" | "event_missing" | "nothing_to_extract" }
  | { kind: "not_configured"; reason: string }
  | { kind: "billing_rejected"; reason: string }
  | { kind: "model_failed"; errorKind: string; message: string };

const MAX_CANDIDATE_COUNT = 6;

/**
 * 单次提炼尝试。不写数据库，不管重试——那些是 job runner 的事。
 *
 * 调用方（job runner）负责把这里的结果映射成
 * `completePersonalMemoryExtractionJob` 或 `failPersonalMemoryJob` 的调用。
 */
export async function attemptPersonalMemoryExtraction(
  eventId: number,
  userId: number,
  operationId: string
): Promise<PersonalMemoryExtractionOutcome> {
  const event = await getPersonalMemoryEventById(eventId, userId);
  if (!event) return { kind: "skipped", reason: "event_missing" };
  if (event.contentScrubbed) return { kind: "skipped", reason: "content_scrubbed" };

  const subject = await resolveExtractionSubject(event);
  if (!subject) return { kind: "skipped", reason: "nothing_to_extract" };

  const candidatesRaw = await listActivePersonalMemoryInsightCandidates(
    userId,
    MAX_CANDIDATE_COUNT
  );
  const candidates = buildCandidatePrompts(candidatesRaw);

  const candidateProviders = allowlistedCandidates();
  if (candidateProviders.length === 0) {
    return {
      kind: "not_configured",
      reason: "没有已批准的模型供应商（PERSONAL_MEMORY_PROVIDER_ALLOWLIST 为空）",
    };
  }

  const platformUserId = await ensurePersonalMemoryPlatformAccount();
  const requestHash = createHash("sha256")
    .update(
      canonicalJsonStringify({
        eventId,
        extractorVersion: EXTRACTOR_PROMPT_VERSION,
        candidateLineageKeys: candidates.map(c => c.lineageKey).sort(),
      })
    )
    .digest("hex");

  const reservation = await reserveForOperation({
    userId: platformUserId,
    operationId,
    operationType: "personal_memory_extraction",
    requestHash,
    maxCostMinor: maxCostMinorPerExtraction(),
    quoteExpiresAt: null,
  });
  if (reservation.outcome === "insufficient_balance") {
    return {
      kind: "billing_rejected",
      reason: `平台账户余额不足（可用 ${reservation.availableMinor} 微元，需要 ${reservation.requiredMinor} 微元）——请运营侧充值后自动重试`,
    };
  }
  if (reservation.outcome === "no_trusted_max_cost" || reservation.outcome === "quote_expired") {
    return { kind: "billing_rejected", reason: reservation.outcome };
  }
  if (reservation.outcome === "conflict") {
    return { kind: "model_failed", errorKind: "billing_conflict", message: reservation.reason };
  }
  // reserved 或 replayed 都继续往下走：replayed 说明这个 operationId 之前
  // 已经预占过（同一个任务重试），复用同一笔预占重新尝试调用。

  const messages = buildExtractionMessages({
    content: subject.content,
    isBehaviorSignal: subject.isBehaviorSignal,
    candidates,
  });

  try {
    const outcome = await runInference({
      useCase: "text",
      messages,
      candidates: { fallback302Model: ENV.llmModel },
      explicitCandidates: candidateProviders,
      responseFormat: { type: "json_object" },
      maxTokens: 800,
      temperature: 0.2,
      // 个人记忆内容不得跨供应商重放——即使传了多个候选，这里也不允许失败后
      // 换一家供应商重发同一份用户原话。
      replaySafe: false,
      deadlineMs: EXTRACTION_TIMEOUT_MS,
    });

    await settleOperation({
      operationId,
      outcome: {
        kind: "succeeded",
        verifiedCostMinor: estimateVerifiedCostMinor(outcome.result.usage),
      },
    });

    const text = outcome.result.choices[0]?.message.content;
    const rawText = typeof text === "string" ? text : "";
    let parsed: unknown;
    try {
      parsed = parseJsonLoose<Record<string, unknown>>(rawText);
    } catch {
      return {
        kind: "model_failed",
        errorKind: "invalid_json",
        message: "模型没有返回可解析的 JSON",
      };
    }

    const mutations = mapExtractionOutputToMutations(parsed, {
      candidates,
      isBehaviorSignal: subject.isBehaviorSignal,
    });
    return { kind: "completed", mutations };
  } catch (error) {
    await settleOperation({
      operationId,
      outcome: { kind: "not_charged_failure" },
    });
    return {
      kind: "model_failed",
      errorKind:
        error instanceof Error && "category" in error
          ? String((error as { category: unknown }).category)
          : "unknown",
      message: error instanceof Error ? error.message.slice(0, 200) : "调用失败",
    };
  }
}
