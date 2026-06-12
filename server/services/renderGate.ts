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
  /** 当前故事已经确认的原创视觉配方。存在时优先于流派库。 */
  artDirection?: ArtRecipeDNA;
};

/**
 * 美术 Agent v1：从美术仓库 styleLibrary 选一个流派。
 * 选法：ctx.emotion 命中某流派的 emotion_fit 优先；否则按当天轮换一个（每天不同、可解释）。
 */
function pickStyle(ctx: RenderContext) {
  const styles = getActiveStyles();
  if (styles.length === 0) return null;
  if (ctx.emotion) {
    const hit = styles.find((s) => s.emotion_fit.includes(ctx.emotion!));
    if (hit) return hit;
  }
  const dayIndex = Math.floor(Date.now() / 86_400_000) % styles.length;
  return styles[dayIndex];
}

/**
 * 美术判断钩子：把选中流派的视觉 DNA 注入 prompt，让出图带上这个美术风格。
 * 选不出流派（库空）时原样返回。
 */
async function artJudge(ctx: RenderContext): Promise<RenderContext> {
  if (ctx.artDirection) {
    const recipe = artRecipePrompt(ctx.artDirection);
    if (!recipe) return ctx;
    return {
      ...ctx,
      prompt: [
        ctx.prompt,
        "【故事视觉配方】",
        recipe,
        "保持原创风格化插图，不模仿或复制任何具名艺术家、电影或现成 IP。",
      ].join("\n"),
    };
  }
  const style = pickStyle(ctx);
  if (!style) return ctx;
  const dna = styleToFragments(style)
    .map((f) => `${f.tag}：${f.text}`)
    .join("；");
  if (!dna) return ctx;
  return { ...ctx, prompt: `${ctx.prompt}\n\n【美术流派·${style.name}】${dna}` };
}

/**
 * 出图网关：所有出图 / 重绘的唯一必经点。
 *
 * @param ctx    渲染上下文（至少含 prompt）
 * @param render 实际生成器调用，接收（可能被美术判断改写过的）prompt，返回该生成器自己的结果
 * @returns      render 的返回值原样透传（泛型 R，保留各生成器自己的返回形）
 */
export async function renderViaGate<R>(
  ctx: RenderContext,
  render: (prompt: string) => Promise<R>,
): Promise<R> {
  const judged = await artJudge(ctx);
  return render(judged.prompt);
}
