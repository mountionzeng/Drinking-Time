/**
 * 每日来信记忆选材的仓储装配层（U6）。
 *
 * `shared/personalMemory.ts` 里的 `selectPersonalMemoryForDailyLetter` 是纯函数，
 * 这里只负责把它需要的输入从仓储里攒出来：拉 active 候选、逐条查证据与最早
 * 证据日期、拉最近若干天的当前来信版本算冷却期，然后调纯函数拿到结果。
 *
 * **敏感主题过滤在这里做，不在纯函数里**：`allowProactiveMention === false`
 * 的理解在进入 `PersonalMemorySelectionCandidate` 之前就被过滤掉——纯函数
 * 的候选类型故意不携带这个字段，逼着以后任何新调用方都必须先经过这层
 * 硬性隐私默认值，不能绕过仓储装配直接拼一份候选喂给纯函数。
 */
import {
  collectRecentlyMentionedLineageKeys,
  selectPersonalMemoryForDailyLetter,
  toPersonalMemoryPromptContext,
  type PersonalMemoryPromptContextItem,
  type PersonalMemorySelectedInsight,
  type PersonalMemorySelectionCandidate,
} from "@shared/personalMemory";
import {
  listActivePersonalMemoryInsightCandidates,
  listEmotionDailyLetters,
  listPersonalMemoryEventsByIds,
  listPersonalMemoryEvidenceForInsight,
  listPersonalMemoryInsightsByIds,
  listPersonalMemoryLetterVersionsByIds,
} from "./personalMemoryPersistence";

/** 选材算法版本；写进 envelope，日后改选材策略时能在历史版本上看出用的是哪一版。 */
export const PERSONAL_MEMORY_SELECTOR_VERSION = "u6-v1";

/** 候选池上限，与 `listActivePersonalMemoryInsightCandidates` 自身的硬上限一致。 */
const CANDIDATE_POOL_LIMIT = 20;
/** 冷却期：多少天内提过的理解不重复主动提及。 */
const COOLDOWN_DAYS = 7;
/** 冷却期回看窗口最多扫多少天的来信记录（覆盖冷却期，留一点余量）。 */
const COOLDOWN_SCAN_DAYS = 30;

export type PersonalMemorySelectionResult = {
  selected: PersonalMemorySelectedInsight[];
  promptContext: PersonalMemoryPromptContextItem[];
};

function parseChinaDate(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysBetween(from: string, to: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((parseChinaDate(to) - parseChinaDate(from)) / MS_PER_DAY);
}

/**
 * 给定目标中国日期，选出这一封信可以使用的记忆子集。
 *
 * 只读，不修改任何状态；调用方（`emotionDailyLetters.ts`）负责把结果
 * 写进生成输入和 `selectedEvidence` payload。
 */
export async function selectPersonalMemoryContextForDailyLetter(input: {
  userId: number;
  targetDate: string;
}): Promise<PersonalMemorySelectionResult> {
  const activeInsights = await listActivePersonalMemoryInsightCandidates(
    input.userId,
    CANDIDATE_POOL_LIMIT
  );
  // 硬性隐私默认值：不允许主动提及的理解在这里就出局，不进入排序。
  const mentionable = activeInsights.filter(
    insight => insight.allowProactiveMention && insight.text
  );

  const candidates: PersonalMemorySelectionCandidate[] = [];
  for (const insight of mentionable) {
    const evidence = await listPersonalMemoryEvidenceForInsight(insight.id);
    // 防御性：DB 层保证 active 理解至少有一条证据，但选材器不信任这个假设。
    if (evidence.length === 0) continue;
    const events = await listPersonalMemoryEventsByIds(
      input.userId,
      evidence.map(item => item.eventId)
    );
    const earliestEvidenceOn = events.reduce<string | null>(
      (earliest, event) =>
        earliest == null || event.occurredOn < earliest
          ? event.occurredOn
          : earliest,
      null
    );
    candidates.push({
      insightId: insight.id,
      lineageKey: insight.lineageKey,
      revision: insight.revision,
      category: insight.category,
      origin: insight.origin,
      text: insight.text!,
      scope: insight.scope,
      confidence: insight.confidence,
      updatedAt: insight.updatedAt,
      evidenceEventIds: evidence.map(item => item.eventId),
      earliestEvidenceOn,
    });
  }

  const cooldownLineageKeys = await recentlyMentionedLineageKeys(input);

  const selected = selectPersonalMemoryForDailyLetter({
    candidates,
    targetDate: input.targetDate,
    cooldownLineageKeys,
  });
  return { selected, promptContext: toPersonalMemoryPromptContext(selected) };
}

async function recentlyMentionedLineageKeys(input: {
  userId: number;
  targetDate: string;
}): Promise<Set<string>> {
  const recentLetters = await listEmotionDailyLetters(
    input.userId,
    COOLDOWN_SCAN_DAYS
  );
  const withinCooldown = recentLetters.filter(letter => {
    if (letter.letterDate === input.targetDate) return false;
    if (letter.currentVersionId == null) return false;
    const age = daysBetween(letter.letterDate, input.targetDate);
    return age >= 0 && age <= COOLDOWN_DAYS;
  });
  if (withinCooldown.length === 0) return new Set();

  const versionIds = withinCooldown.map(letter => letter.currentVersionId!);
  const versions = await listPersonalMemoryLetterVersionsByIds(
    input.userId,
    versionIds
  );
  const payloads = versions.map(version => version.payload);

  const referencedInsightIds = new Set<number>();
  for (const payload of payloads) {
    if (!payload) continue;
    for (const evidence of payload.selectedEvidence) {
      referencedInsightIds.add(evidence.insightId);
    }
  }
  if (referencedInsightIds.size === 0) return new Set();

  // 冷却期要认出"同一件事"，而 payload 里存的是当时那个具体修订的 insightId——
  // 纠正之后旧修订可能已经不在当前 active 候选池里了，所以单独按 ID 查
  // 回它的 lineageKey，不依赖本次候选池是否还包含它。
  const referencedInsights = await listPersonalMemoryInsightsByIds(
    input.userId,
    [...referencedInsightIds]
  );
  const lineageKeyByInsightId = new Map(
    referencedInsights.map(insight => [insight.id, insight.lineageKey])
  );
  return collectRecentlyMentionedLineageKeys(payloads, lineageKeyByInsightId);
}
