/**
 * 叙事节奏引擎 —— 从文字稿到故事版的「整片时间预算」。
 *
 * 缺口所在：现在从文字稿生成故事版时，每镜时长要么是默认的 2.4 秒，要么由
 * directorAdvice 逐图独立判断。**没有任何地方持有整片视角** —— 没有总时长
 * 目标，没有段落之间的时间分配，用户也无法表达「我想要一支 30 秒的」。
 *
 * 本模块只做一件事：给定目标成片形态 + 创作意图，算出每一镜该占多久。
 * 具体的毫秒夹取与时间线渲染仍归 client/features/storyAgent/storyboardTiming.ts，
 * 两者边界是：**这里决定时长，那里渲染时间轴。**
 *
 * ── 与意图识别的关系 ────────────────────────────────────────────
 * 意图识别目前较粗糙，本模块刻意不依赖它的细节：两者之间只通过
 * `RhythmProfile`（5 个 0–1 的数字）耦合。识别侧怎么改进都不影响这里，
 * 只要还能产出这 5 个数字。见 `rhythmProfileFromIntent` —— 那是**唯一**
 * 需要随识别能力升级而重写的函数。
 */

/** 硬边界与 storyboardTiming 保持一致，不另立标准 */
export const RHYTHM_MIN_SHOT_MS = 100;
export const RHYTHM_MAX_SHOT_MS = 12_000;

/** 目标成片形态 */
export type NarrativeSpecId = "album9" | "video10" | "video30" | "video50";

export const NARRATIVE_SPEC_IDS: readonly NarrativeSpecId[] = [
  "album9",
  "video10",
  "video30",
  "video50",
] as const;

export const NARRATIVE_SPEC_LABELS: Record<NarrativeSpecId, string> = {
  album9: "静态画册 · 最多 9 张",
  video10: "约 10 秒",
  video30: "约 30 秒",
  video50: "约 50 秒",
};

/**
 * 节奏参数 —— 意图与节奏之间唯一的耦合面。
 *
 * 刻意做成 5 个连续维度而非枚举：一旦要让用户能自己说「想让他有点愧疚，
 * 但别太狠」，枚举就接不住；而模糊反馈（「太拖了」）也能落成连续的推动，
 * 不必整体替换一个人格。
 */
export type RhythmProfile = {
  /** 0=慢慢进入，给情绪落地时间；1=立刻进入。驱动开场段占比。 */
  entryPace: number;
  /** 0=干脆切断；1=长留余韵。驱动收束段占比。 */
  landingHold: number;
  /** 0=承重（前摇→落下→余震）；1=翻转（短促）。驱动转折段内部形状。 */
  turnCharacter: number;
  /** 0=平缓；1=大起大落。驱动转折段占比。 */
  amplitude: number;
  /** 0=少镜长停；1=多镜快切。驱动镜头数。 */
  dwellDensity: number;
};

export const NEUTRAL_RHYTHM_PROFILE: RhythmProfile = {
  entryPace: 0.5,
  landingHold: 0.5,
  turnCharacter: 0.5,
  amplitude: 0.5,
  dwellDensity: 0.5,
};

/** 段落在整片里承担的位置 */
export type RhythmBeat = "开场" | "起势" | "转折" | "收束";

export const RHYTHM_BEATS: readonly RhythmBeat[] = [
  "开场",
  "起势",
  "转折",
  "收束",
] as const;

/**
 * ── 意图 → 节奏：唯一需要随识别能力升级而重写的地方 ──────────────
 *
 * 当前只读 `primaryPurpose`（意图识别目前能稳定给出的字段），其余信号
 * 作为可选微调。识别侧变强之后，把这一个函数换掉即可，下游全部不动。
 */
export type RhythmIntentInput = {
  primaryPurpose?: "preserve" | "gift" | "share" | "persuade" | "create" | null;
  /** 语气倾向，自由文本；识别粗糙时常为空 */
  tone?: string | null;
  /** 想让对方感觉到什么，自由文本；识别粗糙时常为空 */
  desiredEffect?: string | null;
};

/** 各意图对应的节奏锚点。增补一个意图的成本是一行。 */
export const PURPOSE_RHYTHM_ANCHORS: Record<
  NonNullable<RhythmIntentInput["primaryPurpose"]>,
  RhythmProfile
> = {
  // 留给自己的：慢慢进入，长留余韵
  preserve: {
    entryPace: 0.25,
    landingHold: 0.85,
    turnCharacter: 0.3,
    amplitude: 0.45,
    dwellDensity: 0.3,
  },
  // 送给某个人的：情绪饱满，落点要留住
  gift: {
    entryPace: 0.45,
    landingHold: 0.72,
    turnCharacter: 0.3,
    amplitude: 0.7,
    dwellDensity: 0.4,
  },
  // 发出去给人看的：快进快收，别拖
  share: {
    entryPace: 0.8,
    landingHold: 0.3,
    turnCharacter: 0.7,
    amplitude: 0.7,
    dwellDensity: 0.7,
  },
  // 要说服人的：进入干脆，转折要有力
  persuade: {
    entryPace: 0.75,
    landingHold: 0.45,
    turnCharacter: 0.65,
    amplitude: 0.75,
    dwellDensity: 0.6,
  },
  // 纯创作：留出余地，起伏大一些
  create: {
    entryPace: 0.4,
    landingHold: 0.6,
    turnCharacter: 0.4,
    amplitude: 0.65,
    dwellDensity: 0.4,
  },
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 自由文本里的语气线索 → 维度推动。识别粗糙时这一层基本不触发，属锦上添花。 */
const TONE_NUDGES: Array<{ test: RegExp; delta: Partial<RhythmProfile> }> = [
  { test: /轻松|幽默|好笑|逗|俏皮/, delta: { entryPace: 0.15, landingHold: -0.15, turnCharacter: 0.15 } },
  { test: /克制|平静|淡|收敛/, delta: { amplitude: -0.15, turnCharacter: -0.15 } },
  { test: /热烈|激动|强烈|燃/, delta: { amplitude: 0.15, dwellDensity: 0.1 } },
  { test: /温柔|舒缓|慢|柔/, delta: { entryPace: -0.15, dwellDensity: -0.15, landingHold: 0.1 } },
];

/**
 * 意图 → 节奏参数。
 *
 * 意图缺失或识别不出时返回中性基线 —— **绝不阻塞生成**。宁可给一个平庸
 * 但可用的节奏，也不要因为「没识别出意图」而卡住用户。
 */
export function rhythmProfileFromIntent(
  intent: RhythmIntentInput | null | undefined
): RhythmProfile {
  const purpose = intent?.primaryPurpose;
  const base = purpose ? PURPOSE_RHYTHM_ANCHORS[purpose] : NEUTRAL_RHYTHM_PROFILE;
  const hints = `${intent?.tone ?? ""} ${intent?.desiredEffect ?? ""}`.trim();
  if (!hints) return { ...base };

  const next = { ...base };
  for (const { test, delta } of TONE_NUDGES) {
    if (!test.test(hints)) continue;
    for (const [dim, amount] of Object.entries(delta)) {
      const key = dim as keyof RhythmProfile;
      next[key] = clamp01(next[key] + (amount as number));
    }
  }
  return next;
}

/** 用户看完成片后的模糊反馈 → 维度推动 */
export type RhythmNudge =
  | "太拖了"
  | "前面有点闷"
  | "结尾收太快"
  | "不够有劲"
  | "太用力了"
  | "中间那下不够狠";

const NUDGE_DELTAS: Record<RhythmNudge, Partial<Record<keyof RhythmProfile, number>>> = {
  太拖了: { dwellDensity: 1, landingHold: -1 },
  前面有点闷: { entryPace: 1 },
  结尾收太快: { landingHold: 1 },
  不够有劲: { amplitude: 1 },
  太用力了: { amplitude: -1, turnCharacter: -1 },
  中间那下不够狠: { turnCharacter: -1, amplitude: 1 },
};

/** 单次步长受限，避免一句话把参数推到极端 */
export const RHYTHM_NUDGE_STEP = 0.18;

export function applyRhythmNudge(
  profile: RhythmProfile,
  nudge: RhythmNudge
): RhythmProfile {
  const next = { ...profile };
  for (const [dim, sign] of Object.entries(NUDGE_DELTAS[nudge])) {
    const key = dim as keyof RhythmProfile;
    next[key] = clamp01(next[key] + (sign as number) * RHYTHM_NUDGE_STEP);
  }
  return next;
}

/** ── 规格表 ──────────────────────────────────────────────────── */

type SpecDefinition = {
  mode: "album" | "video";
  /** 目标总时长（毫秒）；画册档为 null */
  totalMs: number | null;
  /** 容差带 [下限, 上限]（毫秒）；画册档为 null */
  toleranceMs: [number, number] | null;
  /** 画册档页数上限；视频档为 null */
  pageCount: number | null;
  /** 镜头数区间 */
  shotRange: [number, number];
  /**
   * 单镜叙事区间（毫秒）。在 storyboardTiming 的硬边界 100–12000ms 之内再收紧：
   * 低于 ~1 秒观众读不出主体，属闪切素材而非叙事镜头；10 秒档更紧，因为
   * 总共就那么点时间，单镜太长就没有第二镜了。
   */
  shotClampMs: [number, number];
  /** 规格偏移（百分点）：这个长度「天然」该怎么分，与意图正交相加 */
  offsets: { 开场: number; 转折: number; 收束: number };
};

export const NARRATIVE_SPECS: Record<NarrativeSpecId, SpecDefinition> = {
  album9: {
    mode: "album",
    totalMs: null,
    toleranceMs: null,
    pageCount: 9,
    shotRange: [4, 9],
    shotClampMs: [0, 0],
    offsets: { 开场: 0, 转折: 0, 收束: 0 },
  },
  video10: {
    mode: "video",
    totalMs: 10_000,
    toleranceMs: [9_000, 11_000],
    pageCount: null,
    shotRange: [3, 5],
    shotClampMs: [1_200, 4_000],
    offsets: { 开场: 0, 转折: 5, 收束: 0 },
  },
  video30: {
    mode: "video",
    totalMs: 30_000,
    toleranceMs: [27_000, 33_000],
    pageCount: null,
    shotRange: [6, 10],
    shotClampMs: [1_000, 8_000],
    offsets: { 开场: 0, 转折: 0, 收束: 0 },
  },
  video50: {
    mode: "video",
    totalMs: 50_000,
    toleranceMs: [45_000, 55_000],
    pageCount: null,
    shotRange: [9, 16],
    shotClampMs: [1_000, 8_000],
    offsets: { 开场: 3, 转折: -5, 收束: 0 },
  },
};

export function isNarrativeSpecId(value: unknown): value is NarrativeSpecId {
  return (
    typeof value === "string" &&
    (NARRATIVE_SPEC_IDS as readonly string[]).includes(value)
  );
}

/** ── 带上下界的按权重分配（预算与镜头分配的共同底座）────────────── */

const EPS = 1e-9;

export type DistributionBounds = Array<[number, number]>;

/**
 * 把 total 按 weights 分配，每项夹进各自的界，总和守恒。
 *
 * 夹取会产生盈亏，用迭代再分配收敛。关键细节：每轮必须**在夹取之后**、
 * 并且**方向敏感**地判断哪些项还能吸收盈亏 —— 需要加量时只有没顶到上限的
 * 能接，需要减量时只有没触到下限的能出。否则越界项会被误判为锁死，
 * 导致没有任何项能吸收差额，总和直接偏离目标。
 */
export function distributeWithBounds(
  weights: number[],
  total: number,
  bounds: DistributionBounds
): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const minSum = bounds.reduce((a, b) => a + b[0], 0);
  const maxSum = bounds.reduce((a, b) => a + b[1], 0);

  // 下限之和已超过总量：按下限比例缩，由 diagnose 报告这个冲突
  if (minSum > total + EPS) {
    return minSum > 0
      ? bounds.map(b => (b[0] * total) / minSum)
      : new Array(n).fill(total / n);
  }
  // 上限之和填不满总量：按上限比例撑
  if (maxSum < total - EPS) {
    return maxSum > 0
      ? bounds.map(b => (b[1] * total) / maxSum)
      : new Array(n).fill(total / n);
  }

  const sumW = weights.reduce((a, b) => a + b, 0);
  const w = sumW > EPS ? weights : new Array(n).fill(1);
  const sw = sumW > EPS ? sumW : n;

  let d = w.map(x => (total * x) / sw);

  for (let iter = 0; iter < 40; iter++) {
    d = d.map((x, i) => Math.min(bounds[i][1], Math.max(bounds[i][0], x)));

    const diff = total - d.reduce((a, b) => a + b, 0);
    if (Math.abs(diff) < 1e-6) break;

    const free = d
      .map((_, i) => i)
      .filter(i =>
        diff > 0 ? d[i] < bounds[i][1] - EPS : d[i] > bounds[i][0] + EPS
      );
    if (free.length === 0) break;

    const freeW = free.reduce((a, i) => a + w[i], 0);
    for (const i of free) {
      d[i] += freeW > EPS ? (diff * w[i]) / freeW : diff / free.length;
    }
  }

  return d;
}

/** ── 时间预算 ────────────────────────────────────────────────── */

/** 起势段下限。低于此值中段塌陷，故事讲不动。 */
const MIN_RISE_PCT = 25;

export type RhythmTimeBudget = {
  specId: NarrativeSpecId;
  mode: "album" | "video";
  totalMs: number | null;
  toleranceMs: [number, number] | null;
  pageCount: number | null;
  /** 每个 beat 分到的毫秒数 */
  segmentMs: Record<RhythmBeat, number>;
  /** 段占比，保留用于展示与调试 */
  segmentPct: Record<RhythmBeat, number>;
  shotCount: number;
  segmentShots: Record<RhythmBeat, number>;
  shotClampMs: [number, number];
  turnShape: "翻转" | "承重" | "中性";
};

/**
 * 段占比 = 公式(节奏参数) + 规格偏移。
 *
 * 两个输入正交：规格管「这个长度天然该怎么分」，意图管「这个目的要怎么花」。
 * 公式已内含基线 —— 全 0.5 且无偏移时得 15/40/30/15。
 *
 * 系数是按机制推的初值，尚未用真实成片校准。
 */
export function computeSegmentPct(
  profile: RhythmProfile,
  specId: NarrativeSpecId
): Record<RhythmBeat, number> {
  const { offsets } = NARRATIVE_SPECS[specId];

  let 开场 = 22 - 14 * profile.entryPace + offsets.开场;
  let 收束 = 8 + 14 * profile.landingHold + offsets.收束;
  let 转折 = 22 + 16 * profile.amplitude + offsets.转折;
  let 起势 = 100 - 开场 - 收束 - 转折;

  if (起势 < MIN_RISE_PCT) {
    const others = 开场 + 收束 + 转折;
    const scale = (100 - MIN_RISE_PCT) / others;
    开场 *= scale;
    收束 *= scale;
    转折 *= scale;
    起势 = MIN_RISE_PCT;
  }

  return { 开场, 起势, 转折, 收束 };
}

export function resolveTurnShape(
  turnCharacter: number
): RhythmTimeBudget["turnShape"] {
  if (turnCharacter > 0.6) return "翻转";
  if (turnCharacter < 0.4) return "承重";
  return "中性";
}

function distributeShotsToBeats(
  shotCount: number,
  pct: Record<RhythmBeat, number>
): Record<RhythmBeat, number> {
  if (shotCount <= 2) {
    return {
      开场: Math.min(1, shotCount),
      起势: 0,
      转折: 0,
      收束: Math.max(0, shotCount - 1),
    };
  }
  const result: Record<RhythmBeat, number> = { 开场: 1, 起势: 0, 转折: 0, 收束: 1 };
  const remaining = shotCount - 2;
  const midTotal = pct.起势 + pct.转折;
  let 起势 = midTotal > 0 ? Math.round((remaining * pct.起势) / midTotal) : remaining - 1;
  // 转折至少 1 镜 —— 没有转折就不是一个故事
  起势 = Math.max(0, Math.min(起势, remaining - 1));
  result.起势 = 起势;
  result.转折 = remaining - 起势;
  return result;
}

/**
 * 每一段必须养得起自己的镜头数（下限），也必须装得下自己的时间（上限）。
 *
 * 光按百分比切会切出自相矛盾的预算：10 秒档「快进」的开场段可能只有 0.94 秒，
 * 而单镜下限是 1.2 秒 —— 那一段装不下它自己那一镜。
 */
function enforceSegmentFeasibility(
  segmentMs: Record<RhythmBeat, number>,
  segmentShots: Record<RhythmBeat, number>,
  shotClampMs: [number, number],
  totalMs: number
): Record<RhythmBeat, number> {
  const [min, max] = shotClampMs;
  const bounds: DistributionBounds = RHYTHM_BEATS.map(beat => {
    const n = segmentShots[beat];
    return n === 0 ? [0, 0] : [n * min, n * max];
  });
  const adjusted = distributeWithBounds(
    RHYTHM_BEATS.map(beat => segmentMs[beat]),
    totalMs,
    bounds
  );
  const out = {} as Record<RhythmBeat, number>;
  RHYTHM_BEATS.forEach((beat, i) => {
    out[beat] = adjusted[i];
  });
  return out;
}

/**
 * 镜头数再平衡 —— 给装不下时间的段从「每镜最松」的段借一镜。
 *
 * 不做这个，50 秒档里想慢的意图会全部撞上单镜上限被压平，不同意图产出
 * 同一条时间线，节奏参数的表达力被吃掉。总镜头数不变。
 */
function rebalanceShots(
  segmentShots: Record<RhythmBeat, number>,
  pct: Record<RhythmBeat, number>,
  totalMs: number,
  shotClampMs: [number, number]
): Record<RhythmBeat, number> {
  const [, max] = shotClampMs;
  const shots = { ...segmentShots };
  const msOf = (beat: RhythmBeat) => (totalMs * pct[beat]) / 100;

  for (let iter = 0; iter < 8; iter++) {
    const overflow = RHYTHM_BEATS.filter(
      b => shots[b] > 0 && msOf(b) > shots[b] * max + 1e-6
    ).sort((a, b) => msOf(b) / shots[b] - msOf(a) / shots[a]);
    if (overflow.length === 0) break;

    const donors = RHYTHM_BEATS.filter(
      b => b !== overflow[0] && shots[b] > 1 && msOf(b) <= (shots[b] - 1) * max + 1e-6
    ).sort((a, b) => msOf(a) / shots[a] - msOf(b) / shots[b]);
    if (donors.length === 0) break;

    shots[donors[0]] -= 1;
    shots[overflow[0]] += 1;
  }
  return shots;
}

export function planRhythmBudget(
  specId: NarrativeSpecId,
  profile: RhythmProfile
): RhythmTimeBudget {
  const spec = NARRATIVE_SPECS[specId];
  const pct = computeSegmentPct(profile, specId);

  const [lo, hi] = spec.shotRange;
  const shotCount = Math.round(lo + (hi - lo) * profile.dwellDensity);
  let segmentShots = distributeShotsToBeats(shotCount, pct);

  let segmentMs = {} as Record<RhythmBeat, number>;
  let finalPct = pct;

  if (spec.totalMs !== null) {
    segmentShots = rebalanceShots(segmentShots, pct, spec.totalMs, spec.shotClampMs);
    for (const beat of RHYTHM_BEATS) {
      segmentMs[beat] = (spec.totalMs * pct[beat]) / 100;
    }
    segmentMs = enforceSegmentFeasibility(
      segmentMs,
      segmentShots,
      spec.shotClampMs,
      spec.totalMs
    );
    finalPct = {} as Record<RhythmBeat, number>;
    for (const beat of RHYTHM_BEATS) {
      finalPct[beat] = (segmentMs[beat] / spec.totalMs) * 100;
    }
  } else {
    for (const beat of RHYTHM_BEATS) segmentMs[beat] = 0;
  }

  return {
    specId,
    mode: spec.mode,
    totalMs: spec.totalMs,
    toleranceMs: spec.toleranceMs,
    pageCount: spec.pageCount,
    segmentMs,
    segmentPct: finalPct,
    shotCount,
    segmentShots,
    shotClampMs: spec.shotClampMs,
    turnShape: resolveTurnShape(profile.turnCharacter),
  };
}

/**
 * 把预算适配到**实际**的镜头分布。
 *
 * 文字稿的段落数决定了镜头数，不一定等于 budget.shotCount。此时不动镜头，
 * 只把时间重新摊到实际存在的镜头上：空段的时间按占比还给非空段，
 * 再重做可行性夹取。用户手动增删镜头后同样走这里。
 */
export function fitBudgetToBeats(
  budget: RhythmTimeBudget,
  beatOfShot: readonly RhythmBeat[]
): RhythmTimeBudget {
  if (budget.mode === "album" || budget.totalMs === null) {
    return { ...budget, shotCount: beatOfShot.length };
  }

  const actualShots = {} as Record<RhythmBeat, number>;
  for (const beat of RHYTHM_BEATS) actualShots[beat] = 0;
  for (const beat of beatOfShot) {
    if (actualShots[beat] !== undefined) actualShots[beat] += 1;
  }

  const liveTotal = RHYTHM_BEATS.filter(b => actualShots[b] > 0).reduce(
    (a, b) => a + budget.segmentPct[b],
    0
  );

  const raw = {} as Record<RhythmBeat, number>;
  for (const beat of RHYTHM_BEATS) {
    raw[beat] =
      actualShots[beat] === 0 || liveTotal <= 0
        ? 0
        : (budget.totalMs * budget.segmentPct[beat]) / liveTotal;
  }

  const segmentMs = enforceSegmentFeasibility(
    raw,
    actualShots,
    budget.shotClampMs,
    budget.totalMs
  );
  const segmentPct = {} as Record<RhythmBeat, number>;
  for (const beat of RHYTHM_BEATS) {
    segmentPct[beat] = (segmentMs[beat] / budget.totalMs) * 100;
  }

  return {
    ...budget,
    segmentMs,
    segmentPct,
    segmentShots: actualShots,
    shotCount: beatOfShot.length,
  };
}

/** ── 镜头时长分配 ────────────────────────────────────────────── */

/**
 * 段落的情绪信号。全部可空 —— 文字稿段落目前没有这层标注，缺失时
 * 退化为等权分配，仍能产出可用节奏。
 */
export type RhythmSegmentSignal = {
  /** 情绪浓度 0–1 */
  intensity?: number | null;
  /** 是否承担戏剧功能（转折、代价、爆发…） */
  loadBearing?: boolean;
  /** 是否为异常点 —— 往往是最独特的一刻，压缩时优先保护 */
  outlier?: boolean;
  /** 段落字数，无情绪标注时作为兜底权重 */
  textLength?: number | null;
};

export function segmentWeight(signal: RhythmSegmentSignal | undefined): number {
  if (!signal) return 1;

  let w: number;
  if (typeof signal.intensity === "number" && Number.isFinite(signal.intensity)) {
    w = 0.5 + Math.min(1, Math.max(0, signal.intensity));
  } else if (typeof signal.textLength === "number" && signal.textLength > 0) {
    // 没有情绪标注时用字数兜底：说得多的那段值得多停一会儿。
    // 压到 [0.7, 1.4]，避免长段落把整片时间吃光。
    w = Math.min(1.4, Math.max(0.7, 0.7 + signal.textLength / 120));
  } else {
    w = 1;
  }

  if (signal.loadBearing) w *= 1.3;
  if (signal.outlier) w *= 1.15;
  return w;
}

/**
 * 转折段内部形状。只重塑段内分配，不改段占比。
 *
 * 转折段**占多少时间**由振幅驱动，段内**怎么走**由转折性质驱动 ——
 * 翻转不是「占得多」，是「段内那一下短促」。
 */
export function shapeTurnSegment(
  durations: number[],
  shape: RhythmTimeBudget["turnShape"],
  clampMs: [number, number]
): number[] {
  const n = durations.length;
  if (n < 2 || shape === "中性") return durations;

  const total = durations.reduce((a, b) => a + b, 0);
  const [min, max] = clampMs;

  if (shape === "翻转") {
    const punch = Math.max(min, Math.min(1_500, max));
    const rest = total - punch;
    if (rest <= 0) return durations;
    const head = durations.slice(0, n - 1);
    const headSum = head.reduce((a, b) => a + b, 0) || n - 1;
    const scaled = distributeWithBounds(
      head.map(d => d / headSum),
      rest,
      head.map(() => clampMs)
    );
    return [...scaled, punch];
  }

  const shapeW =
    n === 2 ? [1, 1.6] : [1, 1.8, ...new Array(Math.max(0, n - 2)).fill(1.2)];
  return distributeWithBounds(
    shapeW.slice(0, n),
    total,
    new Array(n).fill(clampMs) as DistributionBounds
  );
}

export type RhythmShotPlan = {
  index: number;
  beat: RhythmBeat;
  /** 计划时长（毫秒）；画册档为 null */
  durationMs: number | null;
  startMs: number | null;
  endMs: number | null;
  /** 画册档的阅读权重，替代时长 */
  readingWeight: number | null;
};

export function allocateShotDurations(
  budget: RhythmTimeBudget,
  beatOfShot: readonly RhythmBeat[],
  signals: ReadonlyArray<RhythmSegmentSignal | undefined>
): RhythmShotPlan[] {
  const n = beatOfShot.length;

  if (budget.mode === "album") {
    const weights = signals.map(s => segmentWeight(s));
    const maxW = Math.max(...weights, 1);
    return beatOfShot.map((beat, i) => ({
      index: i,
      beat,
      durationMs: null,
      startMs: null,
      endMs: null,
      readingWeight: Math.round((weights[i] / maxW) * 100) / 100,
    }));
  }

  const durations = new Array<number>(n).fill(0);

  for (const beat of RHYTHM_BEATS) {
    const idx = beatOfShot
      .map((b, i) => (b === beat ? i : -1))
      .filter(i => i >= 0);
    if (idx.length === 0) continue;

    const weights = idx.map(i => segmentWeight(signals[i]));
    let seg = distributeWithBounds(
      weights,
      budget.segmentMs[beat],
      idx.map(() => budget.shotClampMs)
    );
    if (beat === "转折") {
      seg = shapeTurnSegment(seg, budget.turnShape, budget.shotClampMs);
    }
    idx.forEach((shotIdx, k) => {
      durations[shotIdx] = seg[k];
    });
  }

  let cursor = 0;
  return beatOfShot.map((beat, i) => {
    // 取整到 10ms —— 时间线上不需要亚毫秒精度，整数也更好读
    const d = Math.max(
      RHYTHM_MIN_SHOT_MS,
      Math.min(RHYTHM_MAX_SHOT_MS, Math.round(durations[i] / 10) * 10)
    );
    const start = cursor;
    cursor += d;
    return {
      index: i,
      beat,
      durationMs: d,
      startMs: start,
      endMs: cursor,
      readingWeight: null,
    };
  });
}

/** ── 诊断 ────────────────────────────────────────────────────── */

export type RhythmDiagnosisLevel = "ok" | "warn" | "off";

export type RhythmDiagnosis = {
  totalMs: number;
  targetMs: number | null;
  /** 与目标的差值，正数表示超长 */
  deltaMs: number;
  level: RhythmDiagnosisLevel;
  /** 明显偏长的镜头下标 */
  tooLong: number[];
  /** 明显偏短的镜头下标 */
  tooShort: number[];
  /** 是否建议重排 —— 提供动作，不自动执行 */
  suggestReflow: boolean;
  message: string;
};

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * 只提示，不自动纠正。
 *
 * 系统绝不为了凑总时长偷偷改动其他镜头 —— 用户刚调好的一镜被系统改回去，
 * 是信任杀手。
 */
export function diagnoseRhythm(
  shots: ReadonlyArray<{ durationMs: number | null; beat: RhythmBeat }>,
  budget: RhythmTimeBudget
): RhythmDiagnosis {
  const totalMs = shots.reduce((a, s) => a + (s.durationMs ?? 0), 0);

  if (budget.mode === "album") {
    const limit = budget.pageCount ?? 9;
    const over = shots.length > limit;
    return {
      totalMs: 0,
      targetMs: null,
      deltaMs: 0,
      level: over ? "off" : "ok",
      tooLong: [],
      tooShort: [],
      suggestReflow: over,
      message: over
        ? `画册最多 ${limit} 张，当前 ${shots.length} 张`
        : `画册 ${shots.length} 张`,
    };
  }

  const target = budget.totalMs ?? 0;
  const deltaMs = totalMs - target;
  const [loTol, hiTol] = budget.toleranceMs ?? [target, target];

  // 镜头数本身够不着目标 —— 再怎么调单镜时长都到不了，必须直说，
  // 否则用户只看到镜头被莫名拉长/压扁，找不到原因。
  const [minShot, maxShot] = budget.shotClampMs;
  const capacityMax = shots.length * maxShot;
  const capacityMin = shots.length * minShot;
  if (shots.length > 0 && (capacityMax < target || capacityMin > target)) {
    const reason =
      capacityMax < target
        ? `镜头太少：${shots.length} 镜最多撑 ${fmt(capacityMax)}，够不到 ${fmt(target)}`
        : `镜头太多：${shots.length} 镜最少占 ${fmt(capacityMin)}，压不到 ${fmt(target)}`;
    return {
      totalMs,
      targetMs: target,
      deltaMs,
      level: "off",
      tooLong: [],
      tooShort: [],
      suggestReflow: true,
      message: `当前 ${fmt(totalMs)} / 目标 ${fmt(target)}，${reason}`,
    };
  }

  let level: RhythmDiagnosisLevel;
  if (totalMs >= loTol && totalMs <= hiTol) {
    level = "ok";
  } else {
    const excess = totalMs < loTol ? loTol - totalMs : totalMs - hiTol;
    level = target > 0 && excess / target <= 0.2 ? "warn" : "off";
  }

  // 偏长/偏短相对**同 beat 内**的均值判断 —— 开场镜天然比转折镜短，
  // 用全片均值会把正常的开场误报成偏短。
  const sums: Record<string, { total: number; count: number }> = {};
  for (const s of shots) {
    const bucket = (sums[s.beat] ??= { total: 0, count: 0 });
    bucket.total += s.durationMs ?? 0;
    bucket.count += 1;
  }

  const tooLong: number[] = [];
  const tooShort: number[] = [];
  shots.forEach((s, i) => {
    const bucket = sums[s.beat];
    if (!bucket || bucket.count === 0) return;
    const mean = bucket.total / bucket.count;
    if (mean <= 0) return;
    const d = s.durationMs ?? 0;
    if (d > mean * 1.6) tooLong.push(i);
    else if (d < mean * 0.6) tooShort.push(i);
  });

  const parts = [`当前 ${fmt(totalMs)} / 目标 ${fmt(target)}`];
  if (level === "ok") {
    parts.push("在容差带内");
  } else {
    parts.push(`${deltaMs > 0 ? "超出" : "不足"} ${fmt(Math.abs(deltaMs))}`);
  }

  return {
    totalMs,
    targetMs: target,
    deltaMs,
    level,
    tooLong,
    tooShort,
    suggestReflow: level === "off",
    message: parts.join("，"),
  };
}
