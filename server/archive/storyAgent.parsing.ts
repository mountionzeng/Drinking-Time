function asCleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asCleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(item => asCleanString(item))
        .filter(Boolean)
        .slice(0, 4)
    : [];
}

function asIntensity(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0.1, Math.min(1, Math.round(value * 100) / 100));
}

export function asEmotionOptions(value: unknown): string[] {
  // 不再硬编码方向性默认词：情绪选项必须来自模型，方向跟着用户此刻真实的情绪。
  // prompt 已要求模型返回至少 5 个方向适配的候选；若模型返回空，空列表也好过注入错误方向的词。
  const options = Array.isArray(value)
    ? value.map(item => asCleanString(item)).filter(Boolean)
    : [];
  return Array.from(new Set(options)).slice(0, 7);
}

export {
  asCleanString,
  asCleanStringArray,
  asIntensity,
};
