/**
 * 剧本 Agent —— 剧本 + 台词生成职责的家。
 *
 * 本轮（打地基）：把「共鸣信号 + 文学库」接进剧本——让剧本生成能呼应用户的意图 / 情绪
 * 与文学声音（这就是用户要的「意图识别 + 文学库 → 剧本」）。
 *
 * 重型的镜头表 / 台词合成逻辑仍委托现有实现（archive/storyAgent 的 synthesizeShotList，
 * 已被测试覆盖），本单元只新增「共鸣上下文」这一层缝并把它喂进合成，不改其原有行为；
 * LLM「怎么把剧本写专业」的判断仍留空。
 */
import {
  rankVoicesBySignal,
  literatureToFragments,
  type LiteratureFragment,
} from "./literatureLibrary";
import {
  buildResonanceSignalForUser,
  describeResonanceSignal,
  type ResonanceSignal,
} from "./resonanceSignal";

type ScriptShotReasonSource = {
  beat?: string;
  subject?: string;
  action?: string;
  emotion?: string;
  intent?: string | null;
  rationale?: string | null;
  sourceCardContent?: string;
};

/** 一把被选中的共鸣声音（文学家名 + 注入用的片段） */
export type ResonantVoice = {
  id: string;
  name: string;
  fragments: LiteratureFragment[];
};

/** 按共鸣信号从文学库取前 limit 把声音（含可注入片段）。 */
export function gatherResonantVoices(
  signal: ResonanceSignal,
  limit = 2,
): ResonantVoice[] {
  return rankVoicesBySignal(signal)
    .slice(0, Math.max(0, limit))
    .map((v) => ({
      id: v.id,
      name: v.name,
      fragments: literatureToFragments(v),
    }));
}

/**
 * 把共鸣信号 + 选中的文学声音组装成一段可注入剧本 prompt 的中文上下文。
 * 空信号 + 无声音 → 空串（剧本行为不变）。
 */
export function buildScriptResonanceContext(signal: ResonanceSignal): string {
  // 完全没有信号时不注入任何东西——剧本行为与接入前一致
  const hasSignal =
    Boolean(signal.intent) ||
    Boolean(signal.emotion?.length) ||
    Boolean(signal.themes?.length) ||
    Boolean(signal.missingInfo?.length) ||
    Boolean(signal.profile);
  if (!hasSignal) return "";

  const parts: string[] = [];

  const desc = describeResonanceSignal(signal);
  if (desc) parts.push(desc);

  const voices = gatherResonantVoices(signal, 2);
  if (voices.length > 0) {
    parts.push(
      "可呼应的文学声音（仅作共鸣参照，不要照抄其句子）：\n" +
        voices
          .map(
            (v) =>
              `· ${v.name}：` +
              v.fragments.map((f) => `${f.tag}=${f.text}`).join("；"),
          )
          .join("\n"),
    );
  }

  return parts.join("\n\n");
}

/**
 * 为某个用户组装剧本共鸣上下文：取其长期情绪画像（emotionAnalysis）+ 当前卡片情绪
 * → 共鸣信号 → 上下文。容错：画像读取失败 / 无画像都不影响（上下文可能为空）。
 */
export async function buildScriptResonanceContextForUser(
  userId: number,
  cardEmotions?: string[],
): Promise<string> {
  const emotion = Array.from(
    new Set((cardEmotions ?? []).map((e) => e.trim()).filter(Boolean)),
  );
  const signal = await buildResonanceSignalForUser(userId, { emotion });
  return buildScriptResonanceContext(signal);
}

function firstContextLine(context?: string): string {
  return (context ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

export function annotateScriptShotReasons<T extends ScriptShotReasonSource>(
  shots: T[],
  options: { resonanceContext?: string } = {},
): Array<T & { intent: string | null; rationale: string | null }> {
  const contextIntent = firstContextLine(options.resonanceContext).slice(0, 180);
  return shots.map((shot) => {
    const source = shot.sourceCardContent?.trim()
      ? "来自用户素材"
      : "连接镜补足叙事节奏";
    const task = [shot.subject, shot.action].filter(Boolean).join("：");
    const rationale = [
      shot.beat ? `叙事位置=${shot.beat}` : "",
      source,
      shot.emotion ? `情绪=${shot.emotion}` : "",
      task ? `画面任务=${task}` : "",
    ].filter(Boolean).join("；");
    const explicitIntent = typeof shot.intent === "string" ? shot.intent.trim() : "";
    const explicitRationale = typeof shot.rationale === "string" ? shot.rationale.trim() : "";

    return {
      ...shot,
      intent: explicitIntent || contextIntent || "把用户素材转成当前镜头可理解的画面任务",
      rationale: explicitRationale || rationale || null,
    };
  });
}
