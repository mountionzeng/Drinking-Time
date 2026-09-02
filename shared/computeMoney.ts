/**
 * 算力金额的唯一内部单位：**微元**。1 元 = 1_000_000 微元。
 *
 * 为什么不用「分」：模型用量的单价经常比一分钱还细（几百 token 的花费可能是
 * ¥0.0003），按分取整会把它抹成 0，累计消费就永远对不上供应商账单。
 * 为什么不用浮点：`0.1 + 0.2 !== 0.3`，逐笔累加几千次之后余额会漂。
 *
 * 所有金额在数据库里是 bigint，在代码里是 JS 安全整数，只有展示层才变成「¥30.00」。
 */

export const MINOR_PER_YUAN = 1_000_000;

/** 金额必须是安全整数；负数合法（账本里消费是负数）。 */
export function assertMinorAmount(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`金额必须是安全整数微元，收到：${value}`);
  }
  return value;
}

function assertFiniteYuan(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`金额必须是有限数，收到：${value}`);
  }
  return value;
}

/** 元 → 微元，四舍五入到最近的微元。 */
export function fromYuan(yuan: number): number {
  return assertMinorAmount(Math.round(assertFiniteYuan(yuan) * MINOR_PER_YUAN));
}

/**
 * 元 → 微元，**向上取整**。
 *
 * 只用于费用上界：预占宁可多占一点，也不能因为取整少占而让实际费用超过 hold。
 */
export function ceilYuanToMinor(yuan: number): number {
  return assertMinorAmount(Math.ceil(assertFiniteYuan(yuan) * MINOR_PER_YUAN));
}

/** 微元 → 元。只用于展示和对外报表，不要拿回来再做累加。 */
export function toYuan(minor: number): number {
  return assertMinorAmount(minor) / MINOR_PER_YUAN;
}

export function addMinor(left: number, right: number): number {
  return assertMinorAmount(assertMinorAmount(left) + assertMinorAmount(right));
}

export function subtractMinor(left: number, right: number): number {
  return assertMinorAmount(assertMinorAmount(left) - assertMinorAmount(right));
}

/**
 * 可用余额 = 已入账余额 − 活动预占。
 *
 * 结果可能为负——那意味着预占超过了入账余额，属于账务异常。这里**不做 clamp**：
 * 把它显式暴露出来，让上层熔断并进入对账，而不是让一个被抹平的 0 掩盖问题。
 */
export function availableMinor(input: {
  postedMinor: number;
  reservedMinor: number;
}): number {
  return subtractMinor(input.postedMinor, input.reservedMinor);
}

/**
 * 展示成人民币：最少两位小数，需要时补到六位，去掉多余的尾随零。
 *
 * 这个原语**不做取整**。金额是 ¥1.2345 就显示 ¥1.2345，是 ¥0.000001 就显示
 * ¥0.000001——用户看到「本次花了 ¥0.00」会以为没扣费。展示层若想在余额大字上
 * 只给两位小数，自己再取整，但逐笔明细必须能对上供应商账单。
 */
export function formatCny(minor: number): string {
  assertMinorAmount(minor);
  const sign = minor < 0 ? "-" : "";
  const absolute = Math.abs(minor);
  const integerPart = Math.trunc(absolute / MINOR_PER_YUAN);
  const fraction = absolute % MINOR_PER_YUAN;

  let decimals = String(fraction).padStart(6, "0").replace(/0+$/, "");
  if (decimals.length < 2) decimals = decimals.padEnd(2, "0");

  return `${sign}¥${integerPart}.${decimals}`;
}

/**
 * 解析人工输入的元金额（管理员调整、续充申请、发卡面额）。
 *
 * 只接受非负、最多 6 位小数的十进制写法；科学计数法、负数和多余小数位一律拒绝，
 * 返回 null 由调用方给出面向用户的错误，不在这里抛异常。
 */
export function parseYuanInput(raw: string): number | null {
  const text = raw.trim().replace(/^¥/, "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const minor = Math.round(Number(text) * MINOR_PER_YUAN);
  return Number.isSafeInteger(minor) ? minor : null;
}
