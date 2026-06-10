/**
 * 出图网关 —— 所有出图 / 局部重绘的唯一必经点。
 *
 * 为什么要它：现在出图调用散落在 creationAgent / artAgent / routers 多处，各自拼 prompt、
 * 各自直连生成器。网关把这些出口收口到一处，给「美术 Agent 判断」留一个唯一插入点。
 *
 * 本轮（打地基）：artJudge 是 identity 桩，原样返回 prompt —— 出图结果与收口前逐字节一致。
 * 未来：artJudge 用 styleLibrary（美术仓库）+ 情绪 + 意图 + 用户参考图 → shotPromptComposer
 * 合成 / 改写 prompt，再交给生成器。
 *
 * 设计：网关不关心具体用哪个生成器（_core 的 generateImage、services 的 generateImage /
 * inpaintImage 各不相同）。调用方把自己现有的生成器调用包成 `(prompt) => Promise<R>` 传进来
 * （其余参数用闭包带上），网关只负责在调用前过一遍判断、把（可能改写过的）prompt 交回去。
 */

/** 渲染上下文：至少含 prompt；其余字段是「未来美术判断要用、本轮先收集不消费」的信号 */
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
};

/**
 * 美术判断钩子。
 * 本轮：identity —— 原样返回，prompt 不变。
 * 未来：在此用美术仓库 + 情绪 + 意图 + 参考图，产出（可能改写过的）渲染上下文。
 */
async function artJudge(ctx: RenderContext): Promise<RenderContext> {
  return ctx;
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
