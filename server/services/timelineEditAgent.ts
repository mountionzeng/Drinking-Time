/**
 * 剪辑指令代理：把「把第三镜挪到最前面」「删掉第 5 镜」「第一镜改成 2 秒」
 * 这类自然语言变成结构化时间轴操作并落库（ChatCut 式对话驱动剪辑的执行层）。
 *
 * 契约要点：
 * - LLM 用【序号】定位镜头（上下文里给编号清单），不回显 stableShotId——
 *   序号几乎不会抄错，长 ID 会。服务端把序号映射回身份后再执行。
 * - 只做能落库的四类操作：move / remove / restore / setDuration（+整轴 reorder）。
 *   尺寸统一、生成视频这类有专门界面的诉求，回复里指路，不硬做。
 * - 指令不是剪辑意图时返回 handled=false，调用方放行回普通小酌聊天。
 */
import { getStoryById, updateStoryTimeline } from "../db";
import type { StoryTimelineItem } from "../../shared/storyMaterial";
import { runJsonAgent } from "./agentRuntime";
import { getStoryMaterialState } from "./storyMaterials";

export type TimelineEditResult =
  | { handled: false }
  | { handled: true; reply: string; appliedCount: number };

type RawOperation = {
  op?: unknown;
  entry?: unknown;
  toPosition?: unknown;
  seconds?: unknown;
  order?: unknown;
};

type RawAgentPayload = {
  isEditCommand?: unknown;
  operations?: unknown;
  reply?: unknown;
};

const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 30_000;

function buildSystemPrompt(entries: string[]): string {
  return [
    "你是短片时间轴剪辑助手。用户会用中文口语描述想怎么调整时间轴。",
    "当前时间轴（按顺序编号；「已移除」表示暂不在成片里但可恢复）：",
    ...entries,
    "",
    "判断用户这句话是否是时间轴剪辑指令：",
    '- 是 → "isEditCommand": true，给出 operations（可多个，按执行顺序）。',
    '- 不是（在聊故事/情绪/画面内容等）→ "isEditCommand": false，operations 空。',
    "支持的 operations（entry 一律用上面的序号）：",
    '- {"op":"move","entry":3,"toPosition":1}  把某镜挪到第几位',
    '- {"op":"remove","entry":5}               从成片移除（可恢复）',
    '- {"op":"restore","entry":5}              恢复已移除的镜头',
    '- {"op":"setDuration","entry":2,"seconds":2.5}  改该镜时长（秒）',
    '- {"op":"reorder","order":[2,1,3,...]}    整轴重排（必须列出全部序号）',
    "统一尺寸/画幅请他用「一键剪辑」，生成或换视频请他在素材仓库操作——",
    '这类诉求算剪辑意图（isEditCommand: true）但 operations 留空，在 reply 里指路。',
    'reply 用一两句中文口语汇报做了什么（或为什么没做）。',
    "严格返回 JSON，不要 markdown：",
    '{"isEditCommand":true,"operations":[...],"reply":"..."}',
  ].join("\n");
}

function asEntryNumber(value: unknown, max: number): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(num) || num < 1 || num > max) return null;
  return num;
}

export async function runTimelineEditCommand(params: {
  storyId: number;
  userId: number;
  instruction: string;
}): Promise<TimelineEditResult> {
  const instruction = params.instruction.trim();
  if (!instruction) return { handled: false };

  const story = await getStoryById(params.storyId, params.userId);
  if (!story) return { handled: false };

  const material = await getStoryMaterialState(params.storyId, params.userId);
  if (!material) return { handled: false };
  const byIdentity = new Map(
    material.shots.map(shot => [shot.stableShotId, shot] as const)
  );
  // 时间轴条目按 position 排序做编号基准；不在轴上的镜头也列出（可恢复）。
  const items: StoryTimelineItem[] = [...material.timeline.items].sort(
    (left, right) => left.position - right.position
  );
  if (items.length === 0) return { handled: false };

  const describe = (item: StoryTimelineItem, index: number): string => {
    const shot = byIdentity.get(item.stableShotId);
    const line =
      shot?.currentVideo?.subtitle ||
      shot?.currentImage?.prompt ||
      "";
    const seconds = (item.plannedDurationMs / 1000).toFixed(1);
    return [
      `${index + 1}. SH${String(shot?.shotNo ?? index + 1).padStart(2, "0")}`,
      `${seconds}秒`,
      item.included ? "在轴上" : "已移除",
      line ? line.slice(0, 30) : "",
    ]
      .filter(Boolean)
      .join("｜");
  };

  const { parsed: result } = await runJsonAgent<RawAgentPayload>({
    systemPrompt: buildSystemPrompt(items.map(describe)),
    message: instruction,
    maxTokens: 600,
    fallback: () => ({ isEditCommand: false }),
  });

  if (!result || result.isEditCommand !== true) return { handled: false };

  const operations: RawOperation[] = Array.isArray(result.operations)
    ? (result.operations as RawOperation[])
    : [];
  const reply =
    typeof result.reply === "string" && result.reply.trim()
      ? result.reply.trim()
      : "收到，这就调整时间轴。";

  // 序号 → 身份的映射以进场时的编号为准（执行过程中不重编号）。
  const identityOfEntry = (entry: unknown): string | null => {
    const num = asEntryNumber(entry, items.length);
    return num === null ? null : items[num - 1].stableShotId;
  };

  let working = items.map(item => ({ ...item }));
  const skipped: string[] = [];
  let appliedCount = 0;

  for (const raw of operations.slice(0, 12)) {
    const op = typeof raw.op === "string" ? raw.op : "";
    if (op === "reorder") {
      const order = Array.isArray(raw.order) ? raw.order : [];
      const identities = order.map(identityOfEntry);
      const unique = new Set(identities.filter(Boolean));
      if (
        identities.some(identity => identity === null) ||
        unique.size !== working.length
      ) {
        skipped.push("整轴重排的序号不完整，已跳过");
        continue;
      }
      const byId = new Map(working.map(item => [item.stableShotId, item]));
      working = identities.map(identity => byId.get(identity!)!);
      appliedCount += 1;
      continue;
    }

    const identity = identityOfEntry(raw.entry);
    if (!identity) {
      skipped.push(`有一步没定位到镜头（序号 ${String(raw.entry)}），已跳过`);
      continue;
    }
    const index = working.findIndex(item => item.stableShotId === identity);
    if (index < 0) continue;

    if (op === "remove" || op === "restore") {
      working[index] = { ...working[index], included: op === "restore" };
      appliedCount += 1;
    } else if (op === "setDuration") {
      const seconds = Number(raw.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        skipped.push("时长数值不合法，已跳过");
        continue;
      }
      working[index] = {
        ...working[index],
        plannedDurationMs: Math.min(
          MAX_DURATION_MS,
          Math.max(MIN_DURATION_MS, Math.round(seconds * 1000))
        ),
      };
      appliedCount += 1;
    } else if (op === "move") {
      const target = asEntryNumber(raw.toPosition, working.length);
      if (target === null) {
        skipped.push("移动的目标位置不合法，已跳过");
        continue;
      }
      const [moved] = working.splice(index, 1);
      working.splice(target - 1, 0, moved);
      appliedCount += 1;
    } else {
      skipped.push(`不认识的操作 ${op || "(空)"}，已跳过`);
    }
  }

  if (appliedCount > 0) {
    await updateStoryTimeline({
      storyId: params.storyId,
      userId: params.userId,
      expectedVersion: material.timeline.version,
      items: working.map((item, position) => ({ ...item, position })),
    });
  }

  const suffix = skipped.length > 0 ? `（${skipped.join("；")}）` : "";
  return { handled: true, reply: `${reply}${suffix}`, appliedCount };
}
