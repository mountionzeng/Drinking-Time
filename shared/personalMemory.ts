/**
 * 个人记忆数据合同（U1）。
 *
 * 这里只放**纯合同**：来源身份、动作语义、状态机、本地聚合形状和归一化。
 * 没有持久化、没有 I/O、没有模型调用——MySQL（drizzle/schema.ts）和本地模式
 * （server/db.ts）都从这里取同一份语义，避免两条路径各写一套定义后漂移。
 *
 * 两个必须一直成立的边界：
 *
 * 1. **经历事件的身份由六段组成且全部非空**（见 PersonalMemoryEventIdentity）。
 *    MySQL 靠复合唯一索引保证幂等；本地模式靠同一段 fingerprint 保证幂等。
 *    任何一段缺失都必须在写入前被拒绝——不能用 NULL 绕过唯一性，因为 MySQL
 *    的唯一索引放过任意多行 NULL，那会静默制造重复经历。
 *
 * 2. **本地模式不假装跨文件事务**。outbox 写在来源自己所属的聚合里，
 *    统一足迹索引由幂等 projector 按水位补齐。见 PersonalMemoryOutboxEntry。
 */

// ─── 来源与动作 ─────────────────────────────────────────────────────────

/** 经历来源类别。每一类在 U1 的 source contract matrix 里有独立的删除策略。 */
export type PersonalMemorySourceType =
  /** 普通聊天里用户自己敲下并成功提交的消息（来源：story_conversation_messages）。 */
  | "chat_message"
  /** 每日回信里用户写下的留言（来源：日期级当前投影 + 修订号）。 */
  | "daily_letter_message"
  /** 明确采用的发布稿版本。 */
  | "publishing_adoption"
  /** 明确采用的图片。 */
  | "image_adoption"
  /** 派生理解自身的状态变化（纠正／归档／恢复／忘记）。 */
  | "insight"
  /** 不可变每日来信版本（首次生成与显式重读）。 */
  | "daily_letter_version";

export const PERSONAL_MEMORY_SOURCE_TYPES: readonly PersonalMemorySourceType[] =
  [
    "chat_message",
    "daily_letter_message",
    "publishing_adoption",
    "image_adoption",
    "insight",
    "daily_letter_version",
  ];

/**
 * 动作语义。这是「用户当时做了什么」，不是「现在是什么状态」——
 * 撤销采用不删除历史采用事件，而是追加一条 unadopted。
 */
export type PersonalMemoryActionKind =
  /** 首次提交文字。 */
  | "submitted"
  /** 修改已提交的文字（保留旧修订）。 */
  | "revised"
  /** 清空已提交的文字（明确编辑／删除语义，不是新感悟）。 */
  | "cleared"
  /** 明确采用。 */
  | "adopted"
  /** 撤销采用。 */
  | "unadopted"
  /** 派生理解的状态变化。 */
  | "insight_created"
  | "insight_corrected"
  | "insight_superseded"
  | "insight_archived"
  | "insight_restored"
  | "insight_forgotten"
  /** 每日来信当日首版。 */
  | "letter_generated"
  /** 用户显式「再读一遍」产生的同日新版本。 */
  | "letter_reread";

export const PERSONAL_MEMORY_ACTION_KINDS: readonly PersonalMemoryActionKind[] =
  [
    "submitted",
    "revised",
    "cleared",
    "adopted",
    "unadopted",
    "insight_created",
    "insight_corrected",
    "insight_superseded",
    "insight_archived",
    "insight_restored",
    "insight_forgotten",
    "letter_generated",
    "letter_reread",
  ];

/** 每种来源允许出现的动作。捕获前校验，防止把图片采用写成 letter_reread 之类。 */
const ACTIONS_BY_SOURCE: Record<
  PersonalMemorySourceType,
  readonly PersonalMemoryActionKind[]
> = {
  chat_message: ["submitted"],
  daily_letter_message: ["submitted", "revised", "cleared"],
  publishing_adoption: ["adopted", "unadopted"],
  image_adoption: ["adopted", "unadopted"],
  insight: [
    "insight_created",
    "insight_corrected",
    "insight_superseded",
    "insight_archived",
    "insight_restored",
    "insight_forgotten",
  ],
  daily_letter_version: ["letter_generated", "letter_reread"],
};

// ─── 事件身份 ───────────────────────────────────────────────────────────

/**
 * 经历事件的规范身份。六段全部参与唯一性，全部非空。
 *
 * - sourceKey：来源在其权威表里的稳定标识（如 `message:1287`）。不是显示名。
 * - sourceRevision：同一来源的第几次修订。没有天然修订的来源用 `"1"`，
 *   **不能用空串**——空串和 NULL 一样会让「改了又改」塌成一条。
 * - actionId：调用方持有的幂等令牌。同一次用户动作重试多少次都用同一个值。
 */
export type PersonalMemoryEventIdentity = {
  userId: number;
  sourceType: PersonalMemorySourceType;
  sourceKey: string;
  sourceRevision: string;
  actionKind: PersonalMemoryActionKind;
  actionId: string;
};

export const PERSONAL_MEMORY_SOURCE_KEY_MAX = 191;
export const PERSONAL_MEMORY_SOURCE_REVISION_MAX = 64;
export const PERSONAL_MEMORY_ACTION_ID_MAX = 191;

export class PersonalMemoryIdentityError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string
  ) {
    super(`个人记忆事件身份非法：${field} ${reason}`);
    this.name = "PersonalMemoryIdentityError";
  }
}

function requireIdentitySegment(
  field: string,
  value: unknown,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new PersonalMemoryIdentityError(field, "必须是字符串");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new PersonalMemoryIdentityError(
      field,
      "不能为空（空串与 NULL 一样会绕过唯一性）"
    );
  }
  if (trimmed.length > maxLength) {
    throw new PersonalMemoryIdentityError(
      field,
      `超过 ${maxLength} 字符上限（实际 ${trimmed.length}）`
    );
  }
  return trimmed;
}

/**
 * 校验并归一化事件身份。写入前必须调用——MySQL 的唯一索引和本地模式的
 * fingerprint 都假设这一步已经做过。
 */
export function normalizePersonalMemoryEventIdentity(
  input: PersonalMemoryEventIdentity
): PersonalMemoryEventIdentity {
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    throw new PersonalMemoryIdentityError("userId", "必须是正整数");
  }
  if (!PERSONAL_MEMORY_SOURCE_TYPES.includes(input.sourceType)) {
    throw new PersonalMemoryIdentityError("sourceType", "不是已登记的来源类别");
  }
  if (!PERSONAL_MEMORY_ACTION_KINDS.includes(input.actionKind)) {
    throw new PersonalMemoryIdentityError("actionKind", "不是已登记的动作");
  }
  if (!ACTIONS_BY_SOURCE[input.sourceType].includes(input.actionKind)) {
    throw new PersonalMemoryIdentityError(
      "actionKind",
      `不属于来源 ${input.sourceType} 允许的动作`
    );
  }
  return {
    userId: input.userId,
    sourceType: input.sourceType,
    sourceKey: requireIdentitySegment(
      "sourceKey",
      input.sourceKey,
      PERSONAL_MEMORY_SOURCE_KEY_MAX
    ),
    sourceRevision: requireIdentitySegment(
      "sourceRevision",
      input.sourceRevision,
      PERSONAL_MEMORY_SOURCE_REVISION_MAX
    ),
    actionKind: input.actionKind,
    actionId: requireIdentitySegment(
      "actionId",
      input.actionId,
      PERSONAL_MEMORY_ACTION_ID_MAX
    ),
  };
}

/**
 * 本地模式的幂等键。与 MySQL 复合唯一索引覆盖的列一一对应，顺序一致。
 * 用 U+001F（Unit Separator）分隔，因为任何一段都不允许包含它。
 */
export function personalMemoryEventFingerprint(
  identity: PersonalMemoryEventIdentity
): string {
  const normalized = normalizePersonalMemoryEventIdentity(identity);
  return [
    String(normalized.userId),
    normalized.sourceType,
    normalized.sourceKey,
    normalized.sourceRevision,
    normalized.actionKind,
    normalized.actionId,
  ].join("\u001f");
}

// ─── 经历事件 ───────────────────────────────────────────────────────────

/**
 * 事件自有的历史材料。来源有不可变修订时只留引用与哈希；
 * 缺少不可变修订时才保存**最小必要**摘录。
 *
 * contentHash 只用于一致性与变化检测，**不得**当作可恢复正文，
 * 也不得在删除后当作语义匹配材料。
 */
export type PersonalMemoryEventSnapshot = {
  /** 展示所需的最小摘录；来源被删除时清空。 */
  excerpt: string | null;
  /** 内容哈希，仅供一致性校验。 */
  contentHash: string | null;
  /** 安全展示元数据（标题、镜头号等），不含图片字节与 prompt 原文。 */
  display: Record<string, unknown> | null;
};

export function createEmptyPersonalMemoryEventSnapshot(): PersonalMemoryEventSnapshot {
  return { excerpt: null, contentHash: null, display: null };
}

export type PersonalMemoryEventRecord = PersonalMemoryEventIdentity & {
  id: number;
  /** 中国时区日期，YYYY-MM-DD。跨日修改不重写旧日期。 */
  occurredOn: string;
  /** 精确发生时间（ISO）。 */
  occurredAt: string;
  snapshot: PersonalMemoryEventSnapshot;
  /**
   * 明确删除来源后置为 true：正文、哈希、摘录全部清除，只留无内容 tombstone
   * 用于审计与防复活。这是经历账本 append-only 的唯一破例。
   */
  contentScrubbed: boolean;
  createdAt: string;
};

// ─── 派生理解 ───────────────────────────────────────────────────────────

/**
 * 派生理解的状态机。与计划里的 stateDiagram 一一对应。
 *
 * - active：当前有效，可进入来信召回。
 * - superseded：被更新且证据更强的表达替代，保留变化轨迹。
 * - archived：用户归档或时效规则退出个性化，**可恢复**。
 * - unsupported：最后一个有效来源被删除，退出召回。
 * - forgotten：用户明确忘记，正文已清除，只留抑制 tombstone。
 */
export type PersonalMemoryInsightState =
  | "active"
  | "superseded"
  | "archived"
  | "unsupported"
  | "forgotten";

export const PERSONAL_MEMORY_INSIGHT_STATES: readonly PersonalMemoryInsightState[] =
  ["active", "superseded", "archived", "unsupported", "forgotten"];

/** 允许的状态迁移。恢复只能回到 active，且调用方还需检查有没有更新的冲突理解。 */
const INSIGHT_TRANSITIONS: Record<
  PersonalMemoryInsightState,
  readonly PersonalMemoryInsightState[]
> = {
  active: ["superseded", "archived", "unsupported", "forgotten"],
  superseded: ["forgotten"],
  archived: ["active", "forgotten"],
  unsupported: ["forgotten"],
  forgotten: [],
};

export function canTransitionInsightState(
  from: PersonalMemoryInsightState,
  to: PersonalMemoryInsightState
): boolean {
  return INSIGHT_TRANSITIONS[from].includes(to);
}

/**
 * 可信级别。用户明确陈述与纠正**永远高于**系统推断——
 * 一次性项目指令、提问、引用别人的话都不能变成永久人格。
 */
export type PersonalMemoryInsightOrigin =
  | "user_stated"
  | "user_corrected"
  | "inferred";

export type PersonalMemoryInsightCategory =
  | "fact"
  | "preference"
  | "relationship"
  | "goal"
  | "concern"
  | "reflection";

export type PersonalMemoryInsightRecord = {
  id: number;
  userId: number;
  /** 同一条理解跨版本的稳定身份；忘记时的抑制绑定在它上面。 */
  lineageKey: string;
  /** 同一 lineage 内自增；纠正产生新版本而不是改写旧版本。 */
  revision: number;
  state: PersonalMemoryInsightState;
  origin: PersonalMemoryInsightOrigin;
  category: PersonalMemoryInsightCategory;
  /** 理解正文；forgotten 后为 null。 */
  text: string | null;
  /** 适用范围：全局，还是限定在某个 Story／项目内。 */
  scope: Record<string, unknown> | null;
  confidence: number;
  /** 是否允许来信主动提及。敏感主题默认 false。 */
  allowProactiveMention: boolean;
  /** 被哪个版本替代（superseded 时非空）。 */
  supersededByInsightId: number | null;
  createdAt: string;
  updatedAt: string;
};

/** 理解与经历之间的多对多证据边。 */
export type PersonalMemoryEvidenceRecord = {
  id: number;
  userId: number;
  insightId: number;
  eventId: number;
  /** 记录建边时看到的来源修订，旧任务不能用过期修订复活理解。 */
  sourceRevision: string;
  createdAt: string;
};

/**
 * 忘记 tombstone。绑定 `userId + lineageKey + 被禁止的证据`，
 * 阻止**旧证据**重新生成同一理解。
 *
 * 它不承诺对未来的新表达做语义级永久封禁——那需要另一个用户可见的选择，
 * 不能靠悄悄扩大本次忘记的语义来实现。
 */
export type PersonalMemorySuppressionRecord = {
  id: number;
  userId: number;
  lineageKey: string;
  /** 被禁止再次成为证据的事件 ID。 */
  suppressedEventIds: number[];
  createdAt: string;
};

// ─── 耐久提炼任务 ───────────────────────────────────────────────────────

export type PersonalMemoryJobState =
  | "pending"
  | "claimed"
  | "succeeded"
  | "failed"
  | "permanently_failed"
  | "cancelled";

export const PERSONAL_MEMORY_JOB_STATES: readonly PersonalMemoryJobState[] = [
  "pending",
  "claimed",
  "succeeded",
  "failed",
  "permanently_failed",
  "cancelled",
];

export type PersonalMemoryJobRecord = {
  id: number;
  userId: number;
  eventId: number;
  /**
   * 任务幂等身份 = 算力账本的 operation ID。提炼是计费动作，
   * 预占／结算／对账都用它，重复不得重复扣费。
   */
  operationId: string;
  /** 提炼器版本；换版本产生新任务而不是复用旧结果。 */
  extractorVersion: string;
  state: PersonalMemoryJobState;
  attempts: number;
  /** claim 令牌；完成时按它做条件提交，防止过期 lease 覆盖新状态。 */
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  availableAt: string;
  lastErrorKind: string | null;
  createdAt: string;
  updatedAt: string;
};

// ─── 隐私 epoch ─────────────────────────────────────────────────────────

/**
 * 用户级隐私 epoch。忘记或删除来源时在同一短事务里递增，
 * 使在途的来信生成即使已经拿到模型结果也无法提交旧输入。
 */
export type PersonalMemoryPrivacyEpochRecord = {
  userId: number;
  epoch: number;
  updatedAt: string;
};

// ─── 不可变每日来信版本 ─────────────────────────────────────────────────

/**
 * 版本 envelope：稳定、不含隐私内容、永不清除。
 * 即使正文因删除请求被隐去，envelope 仍然存在，用户仍能知道「那天有一封信」。
 */
export type PersonalMemoryLetterEnvelope = {
  versionNumber: number;
  generatedAt: string;
  /** 触发方式：当日首版还是显式重读。 */
  trigger: "generated" | "reread";
  selectorVersion: string;
  promptVersion: string;
  modelVersion: string;
};

/**
 * 可清除的隐私 payload：正文、八字修订、黄历事实、所选理解／证据修订、
 * 段落级证据关联。明确删除来源时 scrub 这里，envelope 不动。
 */
export type PersonalMemoryLetterPayload = {
  dailyReference: unknown;
  analysisSeed: unknown;
  userMessage: string | null;
  /** 生成时固定的八字修订。 */
  profileRevision: string | null;
  /** 黄历事实与来源；失败降级时为 null（正文里也不得出现黄历断言）。 */
  almanac: Record<string, unknown> | null;
  /** 所选理解与证据的修订快照，用于解释「为什么提到」。 */
  selectedEvidence: Array<{
    insightId: number;
    insightRevision: number;
    eventIds: number[];
  }>;
};

export type PersonalMemoryLetterVersionRecord = {
  id: number;
  userId: number;
  /** 中国日期。 */
  letterDate: string;
  envelope: PersonalMemoryLetterEnvelope;
  /** 被 scrub 后为 null；此时前端显示「内容因删除请求不可再显示」。 */
  payload: PersonalMemoryLetterPayload | null;
  /** 生成这一版时的隐私 epoch。 */
  privacyEpoch: number;
  /** 产生这一版的 attempt 稳定动作 ID。重复提交返回同一版本。 */
  actionId: string;
  createdAt: string;
};

export type PersonalMemoryLetterAttemptState =
  | "in_flight"
  | "committed"
  | "failed"
  | "rejected_stale";

export type PersonalMemoryLetterAttemptRecord = {
  id: number;
  userId: number;
  letterDate: string;
  /** 稳定动作 ID：重复提交同一次「再读一遍」返回同一 attempt，不排第二次生成。 */
  actionId: string;
  state: PersonalMemoryLetterAttemptState;
  /** 开始生成时固定的输入截点。 */
  inputCutoffAt: string;
  /** 开始生成时的隐私 epoch；提交时不匹配则拒绝。 */
  privacyEpoch: number;
  committedVersionId: number | null;
  createdAt: string;
  updatedAt: string;
};

// ─── 本地模式：outbox 与幂等投影 ────────────────────────────────────────

/**
 * outbox 条目。**写在来源自己所属的聚合里**：
 *
 * - 普通聊天：与标准化消息一起写进 prompt-lineage 聚合；
 * - 每日留言／文章采用／图片采用：与各自来源一起写进 local-persist 聚合。
 *
 * 两份文件之间没有共同事务，只有下面这套带水位的幂等投影。
 * MySQL 模式不需要 outbox——那里来源、事件与任务本来就在同一个 SQL 事务里。
 */
export type PersonalMemoryOutboxEntry = {
  /** 聚合内单调递增序号，投影水位就是它。 */
  seq: number;
  identity: PersonalMemoryEventIdentity;
  occurredOn: string;
  occurredAt: string;
  snapshot: PersonalMemoryEventSnapshot;
  /** 需要一并入队的提炼任务；没有则为 null。 */
  job: {
    operationId: string;
    extractorVersion: string;
  } | null;
};

/** 各来源聚合的投影水位。key 是聚合名，value 是已投影到的 seq。 */
export type PersonalMemoryProjectionWatermarks = Record<string, number>;

/** 承载 outbox 的聚合都实现这个形状。 */
export type PersonalMemoryOutboxCarrier = {
  outbox: PersonalMemoryOutboxEntry[];
  nextOutboxSeq: number;
};

export function createEmptyPersonalMemoryOutbox(): PersonalMemoryOutboxCarrier {
  return { outbox: [], nextOutboxSeq: 1 };
}

// ─── 本地模式：统一足迹索引 ─────────────────────────────────────────────

/**
 * local-persist 聚合里的个人记忆状态。
 *
 * 它既是「来源在 local-persist 里的那几类事件」的家，也是**统一足迹索引**——
 * prompt-lineage 聚合的 outbox 由 projector 幂等投影进来。
 * 不新建第三份 JSON 文件。
 */
export type PersonalMemoryLocalState = {
  /** 结构版本，用于旧文件兼容加载。 */
  version: number;
  events: PersonalMemoryEventRecord[];
  insights: PersonalMemoryInsightRecord[];
  evidence: PersonalMemoryEvidenceRecord[];
  suppressions: PersonalMemorySuppressionRecord[];
  jobs: PersonalMemoryJobRecord[];
  privacyEpochs: PersonalMemoryPrivacyEpochRecord[];
  letterVersions: PersonalMemoryLetterVersionRecord[];
  letterAttempts: PersonalMemoryLetterAttemptRecord[];
  /** local-persist 自己那部分来源的 outbox。 */
  outbox: PersonalMemoryOutboxEntry[];
  nextOutboxSeq: number;
  /** 已经投影到的各聚合水位，崩溃后从这里续投。 */
  projectionWatermarks: PersonalMemoryProjectionWatermarks;
  nextIds: {
    event: number;
    insight: number;
    evidence: number;
    suppression: number;
    job: number;
    letterVersion: number;
    letterAttempt: number;
  };
};

export const PERSONAL_MEMORY_LOCAL_STATE_VERSION = 1;

export function createEmptyPersonalMemoryLocalState(): PersonalMemoryLocalState {
  return {
    version: PERSONAL_MEMORY_LOCAL_STATE_VERSION,
    events: [],
    insights: [],
    evidence: [],
    suppressions: [],
    jobs: [],
    privacyEpochs: [],
    letterVersions: [],
    letterAttempts: [],
    outbox: [],
    nextOutboxSeq: 1,
    projectionWatermarks: {},
    nextIds: {
      event: 1,
      insight: 1,
      evidence: 1,
      suppression: 1,
      job: 1,
      letterVersion: 1,
      letterAttempt: 1,
    },
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function nextIdFrom(rows: Array<{ id: number }>, stored: unknown): number {
  const fromRows = rows.reduce(
    (max, row) => (Number.isFinite(row.id) ? Math.max(max, row.id + 1) : max),
    1
  );
  const fromStored =
    typeof stored === "number" && Number.isFinite(stored) ? stored : 1;
  return Math.max(fromRows, fromStored);
}

/**
 * 旧文件兼容加载：缺字段补默认值，nextId 取「存的值」与「行里最大 id + 1」的较大者。
 * 这与 db.ts 既有 nextIdFromRows 的做法一致——存的值可能因为一次坏写而落后。
 */
export function normalizePersonalMemoryLocalState(
  raw: unknown
): PersonalMemoryLocalState {
  const empty = createEmptyPersonalMemoryLocalState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const input = raw as Partial<PersonalMemoryLocalState>;

  const events = asArray<PersonalMemoryEventRecord>(input.events);
  const insights = asArray<PersonalMemoryInsightRecord>(input.insights);
  const evidence = asArray<PersonalMemoryEvidenceRecord>(input.evidence);
  const suppressions = asArray<PersonalMemorySuppressionRecord>(
    input.suppressions
  );
  const jobs = asArray<PersonalMemoryJobRecord>(input.jobs);
  const letterVersions = asArray<PersonalMemoryLetterVersionRecord>(
    input.letterVersions
  );
  const letterAttempts = asArray<PersonalMemoryLetterAttemptRecord>(
    input.letterAttempts
  );
  const outbox = asArray<PersonalMemoryOutboxEntry>(input.outbox);

  const watermarks: PersonalMemoryProjectionWatermarks = {};
  if (
    input.projectionWatermarks &&
    typeof input.projectionWatermarks === "object" &&
    !Array.isArray(input.projectionWatermarks)
  ) {
    for (const [key, value] of Object.entries(input.projectionWatermarks)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        watermarks[key] = value;
      }
    }
  }

  const storedSeq =
    typeof input.nextOutboxSeq === "number" &&
    Number.isFinite(input.nextOutboxSeq)
      ? input.nextOutboxSeq
      : 1;

  return {
    version: PERSONAL_MEMORY_LOCAL_STATE_VERSION,
    events,
    insights,
    evidence,
    suppressions,
    jobs,
    privacyEpochs: asArray<PersonalMemoryPrivacyEpochRecord>(
      input.privacyEpochs
    ),
    letterVersions,
    letterAttempts,
    outbox,
    nextOutboxSeq: outbox.reduce(
      (max, entry) =>
        Number.isFinite(entry.seq) ? Math.max(max, entry.seq + 1) : max,
      storedSeq
    ),
    projectionWatermarks: watermarks,
    nextIds: {
      event: nextIdFrom(events, input.nextIds?.event),
      insight: nextIdFrom(insights, input.nextIds?.insight),
      evidence: nextIdFrom(evidence, input.nextIds?.evidence),
      suppression: nextIdFrom(suppressions, input.nextIds?.suppression),
      job: nextIdFrom(jobs, input.nextIds?.job),
      letterVersion: nextIdFrom(letterVersions, input.nextIds?.letterVersion),
      letterAttempt: nextIdFrom(letterAttempts, input.nextIds?.letterAttempt),
    },
  };
}

// ─── 来信版本 → 日期级投影 ──────────────────────────────────────────────

/**
 * 日期级来信行**只是当前版本的指针和兼容投影**，不是第二个 writer。
 * 这个函数是「投影可从版本重建」的唯一实现：迁移、回滚构建和对账都用它，
 * 任何绕过它直接写日期级正文的代码路径都属于必须被拒绝的 pre-U1 行为。
 */
export function projectLetterRowFromVersion(version: {
  userId: number;
  letterDate: string;
  envelope: PersonalMemoryLetterEnvelope;
  payload: PersonalMemoryLetterPayload | null;
}): {
  userId: number;
  letterDate: string;
  userMessage: string | null;
  dailyReference: unknown;
  analysisSeed: unknown;
  revision: number;
} {
  return {
    userId: version.userId,
    letterDate: version.letterDate,
    // payload 被 scrub 后正文不再可见，但 envelope 仍证明这天有过一封信。
    userMessage: version.payload?.userMessage ?? null,
    dailyReference: version.payload?.dailyReference ?? {},
    analysisSeed: version.payload?.analysisSeed ?? {},
    revision: version.envelope.versionNumber,
  };
}

/** 同一天的版本按版本号升序；当前版本是最后一个。 */
export function currentLetterVersion(
  versions: PersonalMemoryLetterVersionRecord[]
): PersonalMemoryLetterVersionRecord | null {
  let current: PersonalMemoryLetterVersionRecord | null = null;
  for (const version of versions) {
    if (
      !current ||
      version.envelope.versionNumber > current.envelope.versionNumber
    ) {
      current = version;
    }
  }
  return current;
}

// ─── 捕获、outbox 与幂等投影（纯函数）─────────────────────────────────
//
// 这一段是 U1 的心脏：MySQL 和本地两条路径共用同一套幂等语义，所以它必须是
// 纯的、可反复执行的。projector 崩了重跑、outbox 被重复投递、水位落后，
// 结果都必须与只执行一次完全一样。

/** 一次捕获需要的全部输入。来源、事件与任务在同一次调用里成立或一起不成立。 */
export type PersonalMemoryCapture = {
  identity: PersonalMemoryEventIdentity;
  occurredOn: string;
  occurredAt: string;
  snapshot: PersonalMemoryEventSnapshot;
  /** 来源所属 Story；每日留言与理解没有 Story，传 null。 */
  storyId: number | null;
  /** 需要一并入队的提炼任务；Phase 1 只入队不消费。 */
  job: { operationId: string; extractorVersion: string } | null;
};

export type PersonalMemoryApplyResult = {
  event: PersonalMemoryEventRecord;
  /** false = 这次是重放，状态没有任何变化。 */
  changed: boolean;
};

function findEventByIdentity(
  state: PersonalMemoryLocalState,
  fingerprint: string
): PersonalMemoryEventRecord | null {
  for (const event of state.events) {
    if (personalMemoryEventFingerprint(event) === fingerprint) return event;
  }
  return null;
}

/**
 * 把一次捕获幂等地应用到本地状态。**原地修改** state，调用方负责在外层
 * 聚合写盘失败时丢弃这份 state（本地模式用 copy-on-write，不做部分回滚）。
 *
 * 重放同一动作 ID 时返回既有事件且 changed=false——事件、任务、证据边基数
 * 都不变。这正是 projector 可以放心重跑的原因。
 */
export function applyPersonalMemoryCapture(
  state: PersonalMemoryLocalState,
  capture: PersonalMemoryCapture
): PersonalMemoryApplyResult {
  const identity = normalizePersonalMemoryEventIdentity(capture.identity);
  const fingerprint = personalMemoryEventFingerprint(identity);
  const existing = findEventByIdentity(state, fingerprint);
  if (existing) return { event: existing, changed: false };

  const event: PersonalMemoryEventRecord = {
    ...identity,
    id: state.nextIds.event,
    occurredOn: capture.occurredOn,
    occurredAt: capture.occurredAt,
    snapshot: capture.snapshot,
    contentScrubbed: false,
    createdAt: capture.occurredAt,
  };
  state.nextIds.event += 1;
  state.events.push(event);

  if (capture.job) {
    // 同一事件 + 同一提炼器版本只排一次；换版本才是新任务。
    const duplicate = state.jobs.some(
      job =>
        job.eventId === event.id &&
        job.extractorVersion === capture.job!.extractorVersion
    );
    if (!duplicate) {
      state.jobs.push({
        id: state.nextIds.job,
        userId: identity.userId,
        eventId: event.id,
        operationId: capture.job.operationId,
        extractorVersion: capture.job.extractorVersion,
        state: "pending",
        attempts: 0,
        leaseToken: null,
        leaseExpiresAt: null,
        availableAt: capture.occurredAt,
        lastErrorKind: null,
        createdAt: capture.occurredAt,
        updatedAt: capture.occurredAt,
      });
      state.nextIds.job += 1;
    }
  }

  return { event, changed: true };
}

/**
 * 往来源自己所属聚合的 outbox 追加一条。**原地修改** carrier。
 *
 * 这是本地模式下「不假装跨文件事务」的具体做法：聊天的 outbox 跟着聊天
 * 一起落进 prompt-lineage 聚合，采用与留言的 outbox 跟着来源落进 local-persist。
 */
export function appendPersonalMemoryOutboxEntry(
  carrier: PersonalMemoryOutboxCarrier,
  capture: PersonalMemoryCapture
): PersonalMemoryOutboxEntry {
  const identity = normalizePersonalMemoryEventIdentity(capture.identity);
  const entry: PersonalMemoryOutboxEntry = {
    seq: carrier.nextOutboxSeq,
    identity,
    occurredOn: capture.occurredOn,
    occurredAt: capture.occurredAt,
    snapshot: capture.snapshot,
    job: capture.job,
  };
  carrier.nextOutboxSeq += 1;
  carrier.outbox.push(entry);
  return entry;
}

export type PersonalMemoryProjectionResult = {
  /** 实际新建的事件数。重复投影时为 0。 */
  applied: number;
  /** 跳过的条目数（水位之下，或身份已存在）。 */
  skipped: number;
  /** 投影后的水位。 */
  watermark: number;
};

/**
 * 把某个来源聚合的 outbox 幂等投影进统一足迹索引。**原地修改** state。
 *
 * 崩溃恢复靠两道保险，缺一不可：
 *  1. **水位**：只处理 seq > 水位的条目，正常路径不必重扫全表；
 *  2. **身份去重**：即使水位因为一次坏写退回到 0、或同一条被重复投递，
 *     applyPersonalMemoryCapture 仍然按 fingerprint 拒绝第二次建事件。
 *
 * 光有水位不够——水位本身就存在 local-persist 里，它也可能落后于事实。
 */
export function projectPersonalMemoryOutbox(
  state: PersonalMemoryLocalState,
  aggregateName: string,
  entries: readonly PersonalMemoryOutboxEntry[]
): PersonalMemoryProjectionResult {
  const watermark = state.projectionWatermarks[aggregateName] ?? 0;
  let applied = 0;
  let skipped = 0;
  let highest = watermark;

  // outbox 可能乱序（并发追加后又被合并），按 seq 升序处理，水位才有意义。
  const ordered = [...entries].sort((left, right) => left.seq - right.seq);
  for (const entry of ordered) {
    if (entry.seq <= watermark) {
      skipped += 1;
      continue;
    }
    const result = applyPersonalMemoryCapture(state, {
      identity: entry.identity,
      occurredOn: entry.occurredOn,
      occurredAt: entry.occurredAt,
      snapshot: entry.snapshot,
      storyId: null,
      job: entry.job,
    });
    if (result.changed) applied += 1;
    else skipped += 1;
    highest = Math.max(highest, entry.seq);
  }

  state.projectionWatermarks[aggregateName] = highest;
  return { applied, skipped, watermark: highest };
}

// ─── 提炼与理解状态机（纯函数）──────────────────────────────────────────
//
// 这一段是 U5 的核心规则，两条持久化路径都必须遵守同一套判定：
// MySQL 事务与本地 copy-on-write 各自负责「读取相关切片、调用这里的纯函数
// 算出结果、写回」，规则本身只在这里定义一次。

/**
 * 模型对一条经历的结构化陈述类型判定。**由模型给出，但不被信任**——
 * 系统仍会依据这个类型强制约束能否产生理解、以及产生的理解归到什么可信级别。
 */
export type PersonalMemoryStatementType =
  | "direct_statement"
  | "question"
  | "quotation"
  | "hypothesis"
  | "project_scoped_instruction"
  | "inferred_behavior";

/** 这些陈述类型结构上不可能产生理解——不管模型说了什么，硬性清零。 */
export const STATEMENT_TYPES_WITHOUT_INSIGHTS: ReadonlySet<PersonalMemoryStatementType> =
  new Set(["question", "quotation", "hypothesis"]);

export type PersonalMemoryInsightActionKind = "new" | "reinforce" | "supersede";

/**
 * 根据陈述类型与动作种类推导可信级别。**这条规则不接受模型覆盖**——
 * 「用户明确陈述与纠正的可信级别高于系统推断」是产品不变量，不是模型的建议。
 */
export function deriveInsightOrigin(
  statementType: PersonalMemoryStatementType,
  action: PersonalMemoryInsightActionKind
): PersonalMemoryInsightOrigin {
  if (statementType === "inferred_behavior") return "inferred";
  // direct_statement 与 project_scoped_instruction 都是用户真实说过的话；
  // supersede 属于「用新表达替换旧结论」，这正是纠正的定义。
  return action === "supersede" ? "user_corrected" : "user_stated";
}

/** 置信度增量：重复表达或持续采用可以强化依据，但永远不会超过 1。 */
export function reinforceInsightConfidence(current: number): number {
  const REINFORCE_STEP = 0.1;
  return Math.min(1, Math.round((current + REINFORCE_STEP) * 100) / 100);
}

export type ExtractedInsightProposal = {
  /**
   * 由调用方（提炼层／手动纠正入口）通过 deriveInsightOrigin 算好再传入。
   * 这里不重新推导——mutation 只是「写什么」，不该再决定「有多可信」。
   */
  origin: PersonalMemoryInsightOrigin;
  category: PersonalMemoryInsightCategory;
  text: string;
  scope: Record<string, unknown> | null;
  confidence: number;
  allowProactiveMention: boolean;
};

export type PersonalMemoryInsightMutation =
  | ({ action: "new" } & ExtractedInsightProposal)
  | {
      action: "reinforce";
      lineageKey: string;
      /**
       * lineage 的 tip revision——调用方决定「这条证据要强化这条理解」时
       * 看到的那个版本号，不是「随便哪个 active」。
       *
       * 没有这个检查，一个在纠正之前就已经决定要 reinforce 的旧任务，会在
       * 纠正之后才完成，把新证据错挂到用户刚纠正出来的、内容完全不同的
       * 新版本上——tip 恰好还是 active，只是换了内容。「检查源状态和序列」
       * 里的「序列」指的就是这个。
       */
      expectedRevision: number;
    }
  | ({ action: "supersede"; lineageKey: string; expectedRevision: number } & ExtractedInsightProposal);

/**
 * 一条 lineage 的完整视图：当前 tip（最高 revision 的那一行）与它的历史。
 * 两条持久化路径都把各自读到的切片整理成这个形状，再交给下面的纯函数判定。
 */
export type PersonalMemoryInsightLineageView = {
  /** 按 revision 升序；为空表示这个 lineageKey 从未存在过。 */
  revisions: PersonalMemoryInsightRecord[];
};

/** 取 revision 最大的那一行，与数组顺序无关——调用方不保证已排序。 */
export function insightLineageTip(
  view: PersonalMemoryInsightLineageView
): PersonalMemoryInsightRecord | null {
  let tip: PersonalMemoryInsightRecord | null = null;
  for (const revision of view.revisions) {
    if (!tip || revision.revision > tip.revision) tip = revision;
  }
  return tip;
}

/**
 * 判定一次提炼动作现在能不能生效，以及为什么不能。
 *
 * 这是「旧任务在调用前后都检查源状态和序列，不能覆盖新纠正、归档、忘记或
 * 删除」的具体实现：reinforce／supersede 都要求目标当前恰好是 active——
 * 任何用户动作（纠正、归档、忘记）或另一个提炼任务抢先完成，都会让这里判定
 * 「过期，丢弃」而不是覆盖过去。
 */
export type InsightMutationDecision =
  | { kind: "create"; lineageKey: string }
  | { kind: "reinforce"; target: PersonalMemoryInsightRecord }
  | { kind: "supersede"; target: PersonalMemoryInsightRecord }
  | { kind: "stale"; reason: string };

export function decideInsightMutation(
  mutation: PersonalMemoryInsightMutation,
  lineageKey: string,
  view: PersonalMemoryInsightLineageView
): InsightMutationDecision {
  if (mutation.action === "new") return { kind: "create", lineageKey };

  const tip = insightLineageTip(view);
  if (!tip) {
    return { kind: "stale", reason: `lineage ${lineageKey} 不存在` };
  }
  if (tip.state !== "active") {
    return {
      kind: "stale",
      reason: `lineage ${lineageKey} 当前状态是 ${tip.state}，不是 active——` +
        "已被用户纠正、归档或忘记，提炼结果丢弃而不覆盖",
    };
  }
  if (tip.revision !== mutation.expectedRevision) {
    return {
      kind: "stale",
      reason: `lineage ${lineageKey} 当前是 revision ${tip.revision}，` +
        `不是这条 mutation 决定时看到的 revision ${mutation.expectedRevision}——` +
        "tip 虽然仍是 active，但内容已经被别的动作换过，不能把新证据挂上去",
    };
  }
  return mutation.action === "reinforce"
    ? { kind: "reinforce", target: tip }
    : { kind: "supersede", target: tip };
}

/** 归档／恢复只需要检查 tip 的当前状态是否允许该迁移。 */
export function decideLineageStateChange(
  view: PersonalMemoryInsightLineageView,
  to: "archived" | "active" | "forgotten"
): { kind: "apply"; target: PersonalMemoryInsightRecord } | { kind: "invalid"; reason: string } {
  const tip = insightLineageTip(view);
  if (!tip) return { kind: "invalid", reason: "lineage 不存在" };
  if (!canTransitionInsightState(tip.state, to)) {
    return {
      kind: "invalid",
      reason: `无法从 ${tip.state} 迁移到 ${to}`,
    };
  }
  return { kind: "apply", target: tip };
}

/**
 * 一个来源事件被清空内容（scrub）后，重新计算受影响理解是否还有依据。
 *
 * 只看**当前 tip**：历史 superseded 行不参与召回，不需要重算。
 * 多来源理解删掉其中一个仍然有效，只有最后一个有效来源没了才退出召回。
 */
export function decideEvidenceLossOutcome(
  tip: PersonalMemoryInsightRecord,
  remainingValidEvidenceCount: number
): "unaffected" | "unsupported" {
  if (tip.state !== "active") return "unaffected"; // 非活跃理解不参与召回判定
  return remainingValidEvidenceCount > 0 ? "unaffected" : "unsupported";
}

// ─── 足迹时间线（U7） ─────────────────────────────────────────────────

/**
 * 时间线游标。
 *
 * 语义是 keyset：「继续读 (occurredAt, id) 严格小于这一对的事件」。
 * 不用 offset —— 翻页途中插入新事件会让 offset 分页漏掉或重复整行。
 *
 * 它是**不透明**的：调用方只负责原样回传。之所以还要严格校验解析结果，
 * 是因为伪造的游标不能变成 SQL 注入或越权——但即使伪造成功，服务端始终
 * 用认证上下文的 userId 过滤，所以最坏情况也只是在**自己**的数据里跳位置。
 */
export type PersonalMemoryTimelineCursor = {
  occurredAt: string;
  id: number;
};

export function encodePersonalMemoryTimelineCursor(
  cursor: PersonalMemoryTimelineCursor
): string {
  const raw = JSON.stringify([cursor.occurredAt, cursor.id]);
  return Buffer.from(raw, "utf8").toString("base64url");
}

/** 解析失败一律返回 null——由调用方当作「从头开始」，绝不抛给用户看。 */
export function decodePersonalMemoryTimelineCursor(
  raw: string | null | undefined
): PersonalMemoryTimelineCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [occurredAt, id] = parsed;
  if (typeof occurredAt !== "string" || occurredAt.length === 0) return null;
  if (Number.isNaN(Date.parse(occurredAt))) return null;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    return null;
  }
  return { occurredAt, id };
}

/**
 * 来源当前的可达状态。
 *
 * 关键是把「已删除」和「当前无权访问」分成两种：它们对用户的解释完全不同
 * （一个是自己删掉了，一个是协作关系变了），而对攻击者又都不泄露内容。
 */
export type PersonalMemorySourceAvailability =
  /** 来源仍在，且当前账号有权访问。 */
  | "accessible"
  /** 来源已被删除（或内容已被 scrub）。 */
  | "deleted"
  /** 来源存在，但当前账号无权访问。 */
  | "forbidden"
  /** 来源还在生成／处理中，暂时没有可展示内容。 */
  | "processing";

/**
 * 时间线上的一条经历。
 *
 * 这是**索引投影**，不含来源正文——正文要另外走 resolver 逐条重新校验归属。
 * 之所以分成两步：列表一次几十条，不可能每条都去业务表验一遍归属；
 * 而只要列表本身泄露了摘录，验不验归属就都晚了。所以列表只放事件自己那份
 * 最小摘录（捕获时就已经按展示需要裁剪过，且来源删除时会被 scrub 清空）。
 */
export type PersonalMemoryTimelineItem = {
  id: number;
  occurredOn: string;
  occurredAt: string;
  sourceType: PersonalMemorySourceType;
  actionKind: PersonalMemoryActionKind;
  /** 来源删除后为 null。 */
  excerpt: string | null;
  display: Record<string, unknown> | null;
  contentScrubbed: boolean;
  /** 深链锚点：`<occurredOn>#event-<id>`，返回时可恢复到原日期段。 */
  anchor: string;
};

export type PersonalMemoryTimelinePage = {
  items: PersonalMemoryTimelineItem[];
  nextCursor: string | null;
};

export function personalMemoryEventAnchor(event: {
  occurredOn: string;
  id: number;
}): string {
  return `${event.occurredOn}#event-${event.id}`;
}

export function toPersonalMemoryTimelineItem(
  event: PersonalMemoryEventRecord
): PersonalMemoryTimelineItem {
  return {
    id: event.id,
    occurredOn: event.occurredOn,
    occurredAt: event.occurredAt,
    sourceType: event.sourceType,
    actionKind: event.actionKind,
    excerpt: event.contentScrubbed ? null : event.snapshot.excerpt,
    display: event.snapshot.display,
    contentScrubbed: event.contentScrubbed,
    anchor: personalMemoryEventAnchor(event),
  };
}

/**
 * 摘要里的「最近有活动的日期」。
 *
 * 刻意按**有事件的日期**取前 N 个，而不是取最近 N 个自然日——后者会造出一串
 * 空日期，让用户以为系统那天记了什么却显示不出来。
 */
export type PersonalMemorySummaryDay = {
  occurredOn: string;
  eventCount: number;
  sourceTypes: PersonalMemorySourceType[];
};

export function summarizePersonalMemoryDays(
  events: readonly PersonalMemoryEventRecord[],
  maxDays: number
): PersonalMemorySummaryDay[] {
  const byDate = new Map<string, PersonalMemorySummaryDay>();
  for (const event of events) {
    let day = byDate.get(event.occurredOn);
    if (!day) {
      day = { occurredOn: event.occurredOn, eventCount: 0, sourceTypes: [] };
      byDate.set(event.occurredOn, day);
    }
    day.eventCount += 1;
    if (!day.sourceTypes.includes(event.sourceType)) {
      day.sourceTypes.push(event.sourceType);
    }
  }
  return [...byDate.values()]
    .sort((left, right) => right.occurredOn.localeCompare(left.occurredOn))
    .slice(0, Math.max(0, maxDays));
}

/**
 * 从 sourceKey 解析出来源标识。
 *
 * 解析失败返回 null，调用方据此判 deleted/unknown，**绝不**猜测——
 * 猜错的后果是把别人的资源当成这条经历的来源展示出去。
 */
export type PersonalMemorySourceRef =
  | { kind: "chat_message"; messageId: number }
  | { kind: "daily_letter"; letterDate: string }
  | { kind: "image"; imageId: number }
  | { kind: "publishing"; storyId: number; versionId: string }
  | { kind: "insight"; lineageKey: string };

export function parsePersonalMemorySourceRef(
  sourceType: PersonalMemorySourceType,
  sourceKey: string
): PersonalMemorySourceRef | null {
  switch (sourceType) {
    case "chat_message": {
      const match = /^message:(\d+)$/.exec(sourceKey);
      if (!match) return null;
      const messageId = Number(match[1]);
      return Number.isSafeInteger(messageId) && messageId > 0
        ? { kind: "chat_message", messageId }
        : null;
    }
    case "daily_letter_message":
    case "daily_letter_version": {
      const match = /^daily-letter:(\d{4}-\d{2}-\d{2})$/.exec(sourceKey);
      return match ? { kind: "daily_letter", letterDate: match[1] } : null;
    }
    case "image_adoption": {
      const match = /^image:(\d+)$/.exec(sourceKey);
      if (!match) return null;
      const imageId = Number(match[1]);
      return Number.isSafeInteger(imageId) && imageId > 0
        ? { kind: "image", imageId }
        : null;
    }
    case "publishing_adoption": {
      // versionId 是发布侧自己发的不透明序号（`v1`、`v2`…），不是数字主键——
      // 这里只做长度与字符集校验，语义仍由发布侧权威解释。
      const match = /^publishing:(\d+):([A-Za-z0-9_-]{1,64})$/.exec(sourceKey);
      if (!match) return null;
      const storyId = Number(match[1]);
      return Number.isSafeInteger(storyId) && storyId > 0
        ? { kind: "publishing", storyId, versionId: match[2] }
        : null;
    }
    case "insight":
      return sourceKey.length > 0
        ? { kind: "insight", lineageKey: sourceKey }
        : null;
    default:
      return null;
  }
}
