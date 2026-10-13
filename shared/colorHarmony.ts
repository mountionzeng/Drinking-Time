/** Executable, colour-independent methods. Source observations remain open tags. */
export const COLOR_DESIGN_VALUES = {
  harmony: {
    monochromatic: "单色相的明暗与纯度变化",
    analogous: "色环相邻色域",
    complementary: "对向色域呼应",
    splitComplementary: "主色与对向两侧色域呼应",
    triadic: "三角色域有主次地呼应",
  },
  localHarmony: { complementary: "局部互补点触", analogous: "局部邻近色过渡" },
  localScale: { marks: "仅细小笔触尺度", accents: "仅局部点睛尺度" },
  areaBalance: {
    dominantAccent: "大面积主域与少量点睛",
    balanced: "色域面积均衡",
    backgroundDominant: "背景主导、主体有限点睛",
  },
  saturation: {
    restrained: "整体低饱和、保留细微纯度层次",
    selective: "仅焦点提高纯度",
    vivid: "鲜明纯度但维持主次",
  },
  valueContrast: { soft: "有限明暗差", strong: "明确亮暗对照" },
  valueMasses: {
    connected: "亮暗归并成连贯的大块面",
    broken: "亮暗分散成有节奏的间断块面",
  },
  edges: {
    soft: "颜色边缘柔和但不抹去形体",
    selective: "焦点实边、次要区域虚边",
    hard: "清晰色面交界",
  },
  application: {
    dryLayers: "干性笔触薄层叠色、保留纸纹",
    transparent: "透明薄层叠染",
    opaque: "不透明色面覆盖",
    juxtaposed: "细小色触并置、远看融合",
  },
} as const;
export type ColorDesign = {
  -readonly [K in keyof typeof COLOR_DESIGN_VALUES]?: keyof (typeof COLOR_DESIGN_VALUES)[K];
};
export type ColorDesignKey = keyof ColorDesign;
export const COLOR_DESIGN_KEYS = Object.keys(
  COLOR_DESIGN_VALUES
) as ColorDesignKey[];

export function normalizeColorDesign(value: unknown): ColorDesign | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const result: Record<string, string> = {};
  for (const key of COLOR_DESIGN_KEYS) {
    const item = (value as Record<string, unknown>)[key];
    if (
      typeof item === "string" &&
      Object.hasOwn(COLOR_DESIGN_VALUES[key], item)
    )
      result[key] = item;
  }
  // A local relationship without a scale could recolour the entire picture.
  if (!result.localScale) delete result.localHarmony;
  return Object.keys(result).length ? (result as ColorDesign) : undefined;
}

export function colorDesignSummary(value: unknown): string {
  const design = normalizeColorDesign(value);
  if (!design) return "";
  return `配色方法〔${COLOR_DESIGN_KEYS.flatMap(key => {
    const v = design[key];
    return v ? [(COLOR_DESIGN_VALUES[key] as Record<string, string>)[v]] : [];
  }).join("；")}〕`;
}

/** Only our controlled summary round-trips; arbitrary prose/JSON is never executed. */
export function colorDesignFromSummary(text: string): ColorDesign | undefined {
  const summaries = [...text.matchAll(/配色方法〔([^〕]*)〕/gu)];
  const parts = new Set(summaries.flatMap(match => match[1].split("；")));
  const result: Record<string, string> = {};
  for (const key of COLOR_DESIGN_KEYS) {
    const matches = Object.entries(COLOR_DESIGN_VALUES[key]).filter(
      ([, label]) => parts.has(label)
    );
    if (matches.length === 1) result[key] = matches[0][0];
  }
  return normalizeColorDesign(result);
}

export function commonColorDesign(values: unknown[]): ColorDesign | undefined {
  const designs = values.map(normalizeColorDesign);
  const common: Record<string, string> = {};
  for (const key of COLOR_DESIGN_KEYS) {
    const value = designs[0]?.[key];
    if (value && designs.every(design => design?.[key] === value))
      common[key] = value;
  }
  return normalizeColorDesign(common);
}

export function colorDesignsConflict(left: unknown, right: unknown): boolean {
  const a = normalizeColorDesign(left),
    b = normalizeColorDesign(right);
  return COLOR_DESIGN_KEYS.some(
    key => a?.[key] && b?.[key] && a[key] !== b[key]
  );
}
