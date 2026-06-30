/**
 * 出图网关 —— 所有出图 / 局部重绘的唯一必经点。
 *
 * 为什么要它：现在出图调用散落在 creationAgent / artAgent / routers 多处，各自拼 prompt、
 * 各自直连生成器。网关把这些出口收口到一处，给「美术 Agent 判断」留一个唯一插入点。
 *
 * 美术 Agent v1：artJudge 从美术仓库 styleLibrary 选一个流派，把视觉 DNA 注入 prompt
 * （确定性规则，非 LLM）。更"聪明"的版本（用情绪 / 意图 / 参考图 + shotPromptComposer 合成）后续替换 artJudge 即可，调用方不变。
 *
 * 设计：网关不关心具体用哪个生成器（_core 的 generateImage、services 的 generateImage /
 * inpaintImage 各不相同）。调用方把自己现有的生成器调用包成 `(prompt) => Promise<R>` 传进来
 * （其余参数用闭包带上），网关只负责在调用前过一遍判断、把（可能改写过的）prompt 交回去。
 */
import { getActiveStyles, styleToFragments } from "./styleLibrary";
import {
  artRecipePrompt,
  type ArtRecipeDNA,
} from "../../shared/artDirection";
import { getRecentRejectionSignals, getRecentEditPreferences, getRecentChatCorrections } from "../db";

/** 渲染上下文：至少含 prompt；其余字段是美术判断（artJudge）要用的信号 */
export type RenderContext = {
  prompt: string;
  /** 用户意图（如「改暖一点」） */
  intent?: string;
  /** 情绪信号 */
  emotion?: string;
  /** 用户参考图 / 原图 URL（美术判断的主要参照之一） */
  referenceImages?: string[];
  /** 关联镜号 */
  shotNo?: string;
  /** 关联项目 */
  projectId?: number;
  /** 关联故事（用于查询拒绝信号） */
  storyId?: number;
  /** 当前故事已经确认的原创视觉配方。存在时优先于流派库。 */
  artDirection?: ArtRecipeDNA;
  /** 用户选择的风格索引（存在 story body 里）。优先于每日轮转。 */
  styleIndex?: number;
};

/**
 * 美术 Agent v1：从美术仓库 styleLibrary 选一个流派。
 * 优先级：ctx.artDirection（锁定配方）> ctx.emotion 匹配 > ctx.styleIndex（用户选择）> 每日轮转。
 */
function pickStyle(ctx: RenderContext) {
  const styles = getActiveStyles();
  if (styles.length === 0) return null;
  if (ctx.emotion) {
    const hit = styles.find((s) => s.emotion_fit.includes(ctx.emotion!));
    if (hit) return hit;
  }
  // 用户点过"换风格"时，用存储的索引
  if (ctx.styleIndex != null) {
    return styles[ctx.styleIndex % styles.length];
  }
  const dayIndex = Math.floor(Date.now() / 86_400_000) % styles.length;
  return styles[dayIndex];
}

/**
 * 美术判断钩子：把选中流派的视觉 DNA 注入 prompt，让出图带上这个美术风格。
 * 选不出流派（库空）时原样返回。
 */
async function artJudge(ctx: RenderContext): Promise<RenderContext> {
  const additions: string[] = [];

  if (ctx.artDirection) {
    const recipe = artRecipePrompt(ctx.artDirection);
    if (recipe) {
      additions.push("【故事视觉配方】", recipe);
    }
  } else {
    const style = pickStyle(ctx);
    if (style) {
      const dna = styleToFragments(style)
        .map((f) => `${f.tag}：${f.text}`)
        .join("；");
      if (dna) additions.push(`【美术流派·${style.name}】${dna}`);
    }
  }

  // 矫正循环：读取用户最近拒绝的图片信号 + 聊天矫正，生成负面约束
  if (ctx.storyId || ctx.projectId) {
    const rejectedBlock = await buildRejectionBlock(ctx.storyId, ctx.projectId);
    if (rejectedBlock) additions.push(rejectedBlock);
  }

  // 矫正循环：读取编辑器里的语义注解，把推断的创作偏好注入出图 prompt
  if (ctx.projectId) {
    const prefBlock = await buildEditPreferenceBlock(ctx.projectId);
    if (prefBlock) additions.push(prefBlock);
  }

  if (additions.length === 0) return ctx;
  additions.push("保持原创风格化插图，不模仿或复制任何具名艺术家、电影或现成 IP。");
  return { ...ctx, prompt: [ctx.prompt, ...additions].join("\n") };
}

/**
 * 从最近的 swipe_left 信号 + 聊天矫正信号中提取负面约束，生成 prompt 块。
 * swipe_left：从被拒图片的 recipe DNA 统计高频元素。
 * chat_correction：从用户聊天中的视觉修正指令直接提取。
 */
async function buildRejectionBlock(
  storyId: number | undefined,
  projectId: number | undefined,
): Promise<string | null> {
  const parts: string[] = [];

  // 1. swipe_left 信号：被拒图片的 recipe DNA
  if (storyId) {
    try {
      const signals = await getRecentRejectionSignals(storyId, 10);
      if (signals.length > 0) {
        const rejectedDnas: ArtRecipeDNA[] = [];
        for (const sig of signals) {
          const meta = sig.metadata as Record<string, unknown> | null;
          const recipe = meta?.rejectedRecipe as ArtRecipeDNA | null | undefined;
          if (recipe) rejectedDnas.push(recipe);
        }
        if (rejectedDnas.length > 0) {
          const threshold = Math.ceil(rejectedDnas.length / 2);
          const fields: (keyof ArtRecipeDNA)[] = [
            "style", "palette", "light", "composition", "material",
          ];
          const rejected: string[] = [];
          for (const field of fields) {
            const counts = new Map<string, number>();
            for (const dna of rejectedDnas) {
              const values = dna[field];
              if (!Array.isArray(values)) continue;
              for (const v of values) {
                counts.set(v, (counts.get(v) ?? 0) + 1);
              }
            }
            for (const [value, count] of Array.from(counts.entries())) {
              if (count >= threshold) rejected.push(value);
            }
          }
          if (rejected.length > 0) {
            parts.push(`不要使用以下被拒绝过的风格元素：${rejected.join("、")}`);
          }
        }
      }
    } catch {
      // 静默跳过
    }
  }

  // 2. chat_correction 信号：用户在聊天中的视觉修正指令
  if (projectId) {
    try {
      const corrections = await getRecentChatCorrections(projectId, 5);
      if (corrections.length > 0) {
        const texts: string[] = [];
        for (const sig of corrections) {
          const meta = sig.metadata as Record<string, unknown> | null;
          const correction = meta?.correction;
          if (typeof correction === "string" && correction.trim()) {
            texts.push(correction.trim());
          }
        }
        if (texts.length > 0) {
          parts.push(`用户明确要求的视觉修正：${texts.join("；")}`);
        }
      }
    } catch {
      // 静默跳过
    }
  }

  if (parts.length === 0) return null;
  return `【用户拒绝过的风格】${parts.join("。")}`;
}

/**
 * 从编辑器的语义注解中提取用户创作偏好，生成正向引导 prompt 块。
 * 逻辑：读取项目最近的 semanticAnnotations，聚合 inferredPreferences，
 * 去重后作为「用户偏好」注入出图 prompt。
 */
async function buildEditPreferenceBlock(projectId: number): Promise<string | null> {
  try {
    const annotations = await getRecentEditPreferences(projectId, 5);
    if (annotations.length === 0) return null;

    const allPrefs: string[] = [];
    for (const ann of annotations) {
      const raw = ann.inferredPreferences;
      if (!raw) continue;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed)) allPrefs.push(...parsed);
    }
    if (allPrefs.length === 0) return null;

    // 去重，保留出现次数最多的偏好
    const counts = new Map<string, number>();
    for (const p of allPrefs) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pref]) => pref);

    if (sorted.length === 0) return null;
    return `【用户创作偏好】请参考以下偏好指导生成风格：${sorted.join("；")}`;
  } catch {
    // 查询失败不影响生成，静默跳过
    return null;
  }
}

/**
 * 出图网关：所有出图 / 重绘的唯一必经点。
 *
 * @param ctx    渲染上下文（至少含 prompt）
 * @param render 实际生成器调用，接收（可能被美术判断改写过的）prompt，返回该生成器自己的结果
 * @returns      render 的返回值原样透传（泛型 R，保留各生成器自己的返回形）
 */
const MJ_PROMPT_MAX_LENGTH = 3500;

export async function renderViaGate<R>(
  ctx: RenderContext,
  render: (prompt: string) => Promise<R>,
): Promise<R> {
  const judged = await artJudge(ctx);
  // 最终截断：artJudge 可能追加大量内容，确保不超过 MJ 限制
  const prompt = judged.prompt.length > MJ_PROMPT_MAX_LENGTH
    ? judged.prompt.slice(0, MJ_PROMPT_MAX_LENGTH)
    : judged.prompt;
  return render(prompt);
}
