/**
 * 文本调用的计价：按**供应商 + 模型**折算，而不是一个全局单价。
 *
 * 为什么必须分开：编排器是有序候选链（openai-next 打头，302 兜底），同一次
 * 调用可能落在任何一家。用一个固定单价扣费，两家价差多少，账本就系统性地
 * 偏多少——而且偏的方向是恒定的，用得越久差得越远，对账时也查不出原因，
 * 因为每一笔看上去都「算对了」。
 *
 * 单价从环境变量读，代码里不写死任何一家的商业价格：价格会变，改价不该
 * 需要发版。变量名的形状是
 *
 *   TEXT_PRICE_<PROVIDER>_PER_1K_YUAN            该供应商的默认单价
 *   TEXT_PRICE_<PROVIDER>_<MODEL>_PER_1K_YUAN    某个模型的单价（优先）
 *
 * PROVIDER 和 MODEL 里的非字母数字一律换成下划线并大写，例如
 * openai-next 的 gpt-5.6-terra → TEXT_PRICE_OPENAI_NEXT_GPT_5_6_TERRA_PER_1K_YUAN。
 *
 * 取不到单价时回落到 DEFAULT_YUAN_PER_1K_TOKENS，并把这件事报给调用方
 * （priced: false）——**不能静默按默认价扣钱**。默认价只是让功能不中断的
 * 兜底，不是一个可以拿去对账的数字。
 */

/** 没有任何配置时的兜底单价：每 1000 token ¥0.01。与改造前的行为一致。 */
export const DEFAULT_YUAN_PER_1K_TOKENS = 0.01;

function envKeySegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function textPriceEnvKeys(input: {
  provider: string;
  model?: string | null;
}): { modelKey: string | null; providerKey: string } {
  const provider = envKeySegment(input.provider);
  const model = input.model ? envKeySegment(input.model) : "";
  return {
    modelKey: model
      ? `TEXT_PRICE_${provider}_${model}_PER_1K_YUAN`
      : null,
    providerKey: `TEXT_PRICE_${provider}_PER_1K_YUAN`,
  };
}

export type TextPriceResolution = {
  yuanPer1kTokens: number;
  /** true 表示这个价格是配置出来的，可以拿去对账；false 表示走了兜底。 */
  priced: boolean;
  /** 命中的环境变量名，便于日志里说清楚钱是按哪条规则算的。 */
  source: string | null;
};

function readPositiveNumber(
  env: Record<string, string | undefined>,
  key: string | null
): number | null {
  if (!key) return null;
  const raw = env[key];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 解析某次调用该按什么单价计费。
 *
 * 优先级：模型专属 → 供应商默认 → 兜底。模型优先是因为同一家的不同档位
 * 价差可以到十几倍，按供应商拉平等于给贵模型打折、给便宜模型加价。
 */
export function resolveTextPrice(input: {
  provider: string;
  model?: string | null;
  env?: Record<string, string | undefined>;
}): TextPriceResolution {
  const env = input.env ?? process.env;
  const { modelKey, providerKey } = textPriceEnvKeys(input);

  const byModel = readPositiveNumber(env, modelKey);
  if (byModel !== null) {
    return { yuanPer1kTokens: byModel, priced: true, source: modelKey };
  }

  const byProvider = readPositiveNumber(env, providerKey);
  if (byProvider !== null) {
    return { yuanPer1kTokens: byProvider, priced: true, source: providerKey };
  }

  return {
    yuanPer1kTokens: DEFAULT_YUAN_PER_1K_TOKENS,
    priced: false,
    source: null,
  };
}
