/**
 * 共鸣信号 —— 把「用户意图识别」与「长期情绪画像」收成一份结构化信号，
 * 给文学库排序、剧本生成、出图网关共用（这就是用户要的「1+2 信息共享」）。
 *
 * 两个来源：
 *   1. dropZoneAgent 的意图识别（intent / emotion / themes / missingInfo）
 *   2. emotionAnalysis 长期情绪画像底盘（profile：年龄 / 人生阶段 / 出生季 / 世代 / 当日五行）
 *
 * 本轮（打地基）：只搭共享结构 + 从已有来源真实组装 + 提供人类可读描述；
 * 「怎么用信号判断 / 共鸣」的 LLM 智能留空，先用确定性规则消费（见 literatureLibrary.rankVoicesBySignal）。
 */

/** 来自 emotionAnalysis 的长期情绪画像（结构化，可被任意 Agent 读） */
export type ResonanceProfile = {
  age?: number | null;
  lifeStage?: string;
  birthSeason?: string;
  cohort?: string;
  /** 当日五行 element：metal/wood/water/fire/earth */
  wuxing?: string;
};

/** 共享共鸣信号：意图（来自 1）+ 画像（来自 2）的并集 */
export type ResonanceSignal = {
  /** 用户意图的一句话复述（来自 dropZoneAgent 的意图识别） */
  intent?: string;
  /** 情绪标签 */
  emotion?: string[];
  /** 题材 / 母题 */
  themes?: string[];
  /** 识别到的缺失信息（场景 / 时间 / 情绪 / 机位 …） */
  missingInfo?: string[];
  /** 长期情绪画像（来自 emotionAnalysis） */
  profile?: ResonanceProfile;
};

/**
 * 从持久化的 emotionAnalysis `analysisSeed`（json，形状宽松）组装出 profile 部分。
 * 容错读取——字段缺失 / 类型不对都安全跳过。
 */
export function profileFromAnalysisSeed(seed: unknown): ResonanceProfile | undefined {
  if (!seed || typeof seed !== "object") return undefined;
  const s = seed as Record<string, unknown>;
  const profile: ResonanceProfile = {};
  if (typeof s.age === "number") profile.age = s.age;
  if (typeof s.lifeStage === "string") profile.lifeStage = s.lifeStage;
  if (typeof s.birthSeason === "string") profile.birthSeason = s.birthSeason;
  if (typeof s.cohort === "string") profile.cohort = s.cohort;
  if (typeof s.wuxing === "string") profile.wuxing = s.wuxing;
  return Object.keys(profile).length > 0 ? profile : undefined;
}

/** 把意图（1）与画像（2）组装成一份共享信号。空的部分不写入。 */
export function buildResonanceSignal(parts: {
  analysisSeed?: unknown;
  intent?: string;
  emotion?: string[];
  themes?: string[];
  missingInfo?: string[];
}): ResonanceSignal {
  const signal: ResonanceSignal = {};
  const profile = profileFromAnalysisSeed(parts.analysisSeed);
  if (profile) signal.profile = profile;
  if (parts.intent?.trim()) signal.intent = parts.intent.trim();
  if (parts.emotion?.length) signal.emotion = parts.emotion;
  if (parts.themes?.length) signal.themes = parts.themes;
  if (parts.missingInfo?.length) signal.missingInfo = parts.missingInfo;
  return signal;
}

/**
 * 把信号压成一段简短中文，给任意 Agent 的 prompt 注入（共享的人类可读形式）。
 * 空信号返回空字符串。
 */
export function describeResonanceSignal(signal: ResonanceSignal): string {
  const lines: string[] = [];
  if (signal.intent) lines.push(`用户意图：${signal.intent}`);
  if (signal.emotion?.length) lines.push(`情绪：${signal.emotion.join("、")}`);
  if (signal.themes?.length) lines.push(`题材：${signal.themes.join("、")}`);
  if (signal.missingInfo?.length) lines.push(`待补：${signal.missingInfo.join("、")}`);
  const p = signal.profile;
  if (p) {
    const bits = [
      p.age != null ? `${p.age}岁` : "",
      p.lifeStage,
      p.birthSeason,
      p.cohort,
      p.wuxing ? `当日五行${p.wuxing}` : "",
    ].filter(Boolean);
    if (bits.length) lines.push(`长期画像：${bits.join("；")}`);
  }
  return lines.join("\n");
}
