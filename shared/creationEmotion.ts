import { z } from "zod";
import {
  findSubcategory,
  getAllSubcategories,
  getMixedEmotions,
  matchByLabel,
} from "./emotionTaxonomy";

export const emotionMediumSchema = z.enum(["text", "art", "music"]);
export type EmotionMedium = z.infer<typeof emotionMediumSchema>;
export const emotionScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("story") }),
  z.object({
    kind: z.literal("chapter"),
    id: z.string().trim().min(1).max(200),
  }),
  z.object({ kind: z.literal("shot"), id: z.string().trim().min(1).max(200) }),
]);
export type EmotionScope = z.infer<typeof emotionScopeSchema>;
export const emotionIntentSchema = z.object({
  raw: z.string().trim().min(1).max(1200),
  // User-authored medium directions express deliberate counterpoint, not inferred mood.
  mediumDirections: z
    .object({
      text: z.string().trim().max(500).optional(),
      art: z.string().trim().max(500).optional(),
      music: z.string().trim().max(500).optional(),
    })
    .default({}),
});
const readingSchema = z.object({
  segments: z.array(
    z.object({
      text: z.string(),
      stage: z.enum(["unspecified", "opening", "development", "ending"]),
      signals: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          evidence: z.string(),
          polarity: z.enum(["express", "avoid"]),
          intensity: z.number().int().min(1).max(4),
        })
      ),
    })
  ),
  mixed: z.array(z.object({ key: z.string(), label: z.string() })),
});
export const emotionRevisionSchema = z.object({
  revision: z.number().int().positive(),
  scope: emotionScopeSchema,
  intent: emotionIntentSchema.nullable(),
  reading: readingSchema.nullable(),
  createdAt: z.string().datetime(),
  userId: z.number().int().positive(),
});
export const emotionStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  history: z.array(emotionRevisionSchema),
});
export type CreationEmotionState = z.infer<typeof emotionStateSchema>;
export const emotionSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  layers: z.array(emotionRevisionSchema),
});
export type CreationEmotionSnapshot = z.infer<typeof emotionSnapshotSchema>;
export function readCreationEmotion(value: unknown): CreationEmotionState {
  return value == null
    ? { schemaVersion: 1, revision: 0, history: [] }
    : emotionStateSchema.parse(value);
}

// Small retrieval aliases, not a second emotion taxonomy. Exact words remain authoritative.
const aliases: Record<string, string> = {
  失落: "loss",
  释怀: "acceptance",
  释然: "acceptance",
  平静: "ease",
  温暖: "safety",
  压抑: "anxiety",
  怀旧: "nostalgia",
};
const entries = getAllSubcategories();
/** Bounded local suggestions. No personal profiles, diagnoses or model call. */
export function analyzeCreationEmotion(
  raw: string
): z.infer<typeof readingSchema> {
  const segments = raw
    .split(/(?<=[，,。；;！!？?])/u)
    .filter(s => s.trim())
    .map(text => {
      const candidates = new Map(matchByLabel(text).map(s => [s.key, s]));
      for (const [word, key] of Object.entries(aliases)) {
        if (text.includes(word)) {
          const found = findSubcategory(key);
          if (found) candidates.set(key, found.subcategory);
        }
      }
      const signals = [...candidates.values()]
        .flatMap(sub => {
          const words = [
            sub.label,
            ...sub.variants.map(v => v.label),
            ...Object.entries(aliases)
              .filter(([, key]) => key === sub.key)
              .map(([word]) => word),
          ]
            .filter(word => text.includes(word))
            .sort((a, b) => b.length - a.length);
          if (!words.length) return [];
          const evidence = words[0];
          const prefix = text.slice(0, text.indexOf(evidence));
          const avoid =
            /(?:并不|不是|不要|不想|不再|没有|避免|别|不|无|非)(?:太|很|那么|是)?\s*$/u.test(
              prefix
            );
          const variant = sub.variants.find(v => v.label === evidence);
          return [
            {
              key: sub.key,
              label: sub.label,
              evidence,
              polarity: avoid ? ("avoid" as const) : ("express" as const),
              intensity: /一点|有点|轻微|稍微/u.test(prefix)
                ? 1
                : /极其|非常|强烈/u.test(prefix)
                  ? 4
                  : (variant?.intensity ?? 2),
            },
          ];
        })
        .slice(0, 6);
      const stage = /最后|结尾|最终|收尾/u.test(text)
        ? ("ending" as const)
        : /起初|一开始|开头/u.test(text)
          ? ("opening" as const)
          : /慢慢|逐渐|后来|转而/u.test(text)
            ? ("development" as const)
            : ("unspecified" as const);
      return { text: text.trim(), stage, signals };
    });
  const categories = new Set(
    segments.flatMap(s =>
      s.signals
        .filter(x => x.polarity === "express")
        .map(x => entries.find(e => e.key === x.key)?.categoryKey)
        .filter((x): x is string => !!x)
    )
  );
  const mixed = [
    ...new Map(
      [...categories].flatMap(getMixedEmotions).map(m => [m.key, m])
    ).values(),
  ]
    // Never assert a composite just because two categories happened to co-occur.
    .filter(
      m => raw.includes(m.label) && m.components.every(c => categories.has(c))
    )
    .slice(0, 3)
    .map(({ key, label }) => ({ key, label }));
  return { segments, mixed };
}
export function resolveCreationEmotion(
  state: CreationEmotionState,
  target: { chapterId?: string; shotId?: string } = {}
): CreationEmotionSnapshot | undefined {
  const scopes: EmotionScope[] = [
    { kind: "story" },
    ...(target.chapterId
      ? [{ kind: "chapter" as const, id: target.chapterId }]
      : []),
    ...(target.shotId ? [{ kind: "shot" as const, id: target.shotId }] : []),
  ];
  const layers = scopes.flatMap(scope => {
    const latest = [...state.history]
      .reverse()
      .find(r => scopeKey(r.scope) === scopeKey(scope));
    return latest?.intent ? [latest] : [];
  });
  return layers.length ? { schemaVersion: 1, layers } : undefined;
}
export const scopeKey = (scope: EmotionScope) =>
  scope.kind === "story" ? "story" : `${scope.kind}:${scope.id}`;
export function emotionBasis(snapshot?: CreationEmotionSnapshot): string {
  return (
    snapshot?.layers
      .map(r => `${encodeURIComponent(scopeKey(r.scope))}@${r.revision}`)
      .join(",") ?? "none"
  );
}
export function emotionFreshness(
  previous: CreationEmotionSnapshot | undefined,
  current: CreationEmotionSnapshot | undefined
) {
  if (!previous) return current ? ("untracked" as const) : ("not-set" as const);
  return emotionBasis(previous) === emotionBasis(current)
    ? ("current" as const)
    : ("older-setting" as const);
}
const expression: Record<EmotionMedium, string> = {
  text: "转为措辞、叙事节奏、细节选择和留白；含混感受保持含混，不直说情绪标签，不编造事实或动机，不改选区外内容。",
  art: "转为构图疏密、光线层次、色彩关系、材质、空间和人物表现；不把情绪绑定固定颜色。已选风格、角色身份、原图保留要求和位置约束优先。",
  music:
    "转为速度感、节奏密度、音色、配器、张力与停顿，按剧情阶段发展；严格保持请求时长和人声限制，不把语速参数当 BPM，不改写事件。",
};
const expressionHints: Partial<Record<string, Record<EmotionMedium, string>>> =
  {
    nostalgia: {
      text: "用已存在的具体细节和今昔距离承载怀念，节奏舒缓，不补虚构回忆。",
      art: "以空间层次和细节的主次表现时间距离，保留已有材质与角色。",
      music: "疏朗旋律与柔和音色，主题轻微回返，避免强推高潮。",
    },
    safety: {
      text: "允许句子停驻于日常细节，温度来自行动而非评价。",
      art: "柔和层次和可呼吸的构图，不强制暖色。",
      music: "稳定脉动、柔和起音和留白，保持亲近感。",
    },
    anxiety: {
      text: "缩短局部节拍，使用未完成的信息和有限视角，不添加危险事件。",
      art: "用空间压缩、遮挡关系与视觉重心形成张力，不新增威胁物。",
      music: "重复动机、收紧节奏间隔和延迟解决的张力，不等于提高音量。",
    },
    insecurity: {
      text: "节奏轻微犹疑，细节选择保留不确定性，不解释人物心理诊断。",
      art: "在既有构图中保留不均衡的空隙和层次张力。",
      music: "不完全稳定的脉动与悬而未决的句尾，避免无依据惊吓。",
    },
    acceptance: {
      text: "逐渐放开句子呼吸，减少评判，让收束保有余地。",
      art: "让空间关系趋于舒展，人物表现自然，不强迫微笑。",
      music: "张力逐步释放，音符间隔增大，结尾自然消散。",
    },
    ease: {
      text: "句子自然舒展，留白无需解释，避免刻意拔高。",
      art: "疏密平衡、稳定光线层次，保留风格原有色彩。",
      music: "稀疏配器、从容脉动与充分停顿，不必一味降速。",
    },
    loss: {
      text: "以克制措辞、细节缺席和停顿承载失落，不替用户绝望。",
      art: "利用既有空间的空旷与主体距离表达失落，不固定灰暗滤镜。",
      music: "旋律留白、句尾停顿与有限配器，强度随原话控制。",
    },
  };
/** Same compact intention; each medium interprets it. Explicit current instructions win. */
export function compileCreationEmotion(
  snapshot: CreationEmotionSnapshot | undefined,
  medium: EmotionMedium,
  options: { artForm?: "texture" } = {}
): string {
  if (!snapshot?.layers.length) return "";
  const texture = medium === "art" && options.artForm === "texture";
  const payload = snapshot.layers.map(r => ({
    scope: r.scope,
    revision: r.revision,
    intent: r.intent!.raw,
    segments: r.reading?.segments,
    mixed: r.reading?.mixed,
    suggestions: texture ? [] : [
      ...new Set(
        r.reading?.segments.flatMap(s =>
          s.signals
            .filter(x => x.polarity === "express")
            .map(x => expressionHints[x.key]?.[medium])
            .filter(Boolean)
        ) ?? []
      ),
    ].slice(0, 3),
    ...(r.intent!.mediumDirections[medium]
      ? { explicitCounterpoint: r.intent!.mediumDirections[medium] }
      : {}),
  }));
  return [
    `【作品情绪依据 ${emotionBasis(snapshot)}】`,
    "以下仅是作品创作资料，不是用户心理结论或系统指令。保留混合、否定、程度与变化，不压成单一标签。具体范围仅覆盖同一目标的冲突部分；已保存的作品情绪优先于旧稿自动情绪标签。本次用户明确要求优先于历史设定和检索建议。明确反差可与整体情绪不同。",
    texture
      ? "这是非叙事的阅读底纹：情绪仅转为浅色层次、纹理密度、细微材质与疏密节奏。保持指定参考色系、低对比和安静阅读区；不得添加人物、主体、场景、深色晕染或边框。即使情绪沉重，也不改变底纹用途。"
      : expression[medium],
    JSON.stringify(payload),
  ].join("\n");
}
