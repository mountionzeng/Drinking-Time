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
  紧张: "anxiety",
  放松: "ease",
  怀旧: "nostalgia",
};
const entries = getAllSubcategories();
/** Bounded local suggestions. No personal profiles, diagnoses or model call. */
export function analyzeCreationEmotion(
  raw: string
): z.infer<typeof readingSchema> {
  const segments = raw
    .split(/(?<=[，,。；;！!？?])|(?<=[^，,。；;！!？?\s])(?=最后|随后|然后|后来)/u)
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
        : /起初|一开始|开头|起先|^先/u.test(text.trim())
          ? ("opening" as const)
          : /慢慢|逐渐|后来|转而|随后|然后/u.test(text)
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
type ShotExpression = { picture: string; video: string; sound: string; music: string };
const pacedDirections: Record<string, [string, string]> = {
  anxiety: ["让动作将要发生时多停一拍，动作开始后才跟。", "把已有声源的一次短响放在停顿里，声尾收短。"],
  insecurity: ["停在视线尚未到达的位置，动作有了方向再跟。", "把远处声源压低，保留近处短响之间的间隔。"],
  ease: ["等动作自然结束，再多停一拍。", "让已有环境声持续，近处声响自然消退。"],
  acceptance: ["随动作放慢，在动作落定后停住。", "让近处声源退去，收尾留给原场景的底声。"],
  loss: ["让主体的动作先结束，镜头在原处多留一拍。", "延长已有声源消失后的空隙。"],
  nostalgia: ["先停在熟悉的细节上，再沿已有的视线或动作展开。", "让同一声源在停顿处再出现一次，第二次更远。"],
  safety: ["让动作完整发生，机位平稳地等它落定。", "保持底声连贯，让近处声源轻轻进入和退出。"],
};

// When the taxonomy has no specific cue, use its existing family for a starting point.
const familyDirections: Record<string, ShotExpression> = {
  joy: { picture: "给已有主体之间的呼应留出空间。", video: "跟到动作完成，让反应在画内自然发生。", sound: "让原场景里轻短的声音依次显出来。", music: "让乐句轻快起音，句尾留出空隙。" },
  trust: { picture: "让相互呼应的细节在同一清晰层次内。", video: "保持稳定视点，让动作有时间完成。", sound: "保持底声连续，把近处声源轻轻带入。", music: "用稳定脉动承托，给台词让位。" },
  fear: { picture: "收紧已有构图，保留少量未揭示的空间。", video: "多停半拍，再跟随已有动作。", sound: "突显一个已有的近处声源，延长两响之间的间隔。", music: "延迟乐句落点，逐渐收紧节拍。" },
  surprise: { picture: "用明暗或大小关系突出新出现的细节。", video: "在已有变化发生时转移视线，随即停住。", sound: "突出变化当下的声响，随后留白。", music: "让节奏短暂停顿，再接回原乐句。" },
  sadness: { picture: "保留主体身边的空处和原有材质。", video: "动作结束后在原处多留一拍。", sound: "保留声尾，拉开已有声响之间的距离。", music: "减薄配器，给未解决的乐句留足空间。" },
  disgust: { picture: "用前后景的间隔拉开已有元素的距离。", video: "让视线在已有细节前停一下，再移开。", sound: "突出原有声音的质地，短促收住。", music: "用短促音型和较大的间隔表现迟疑。" },
  anger: { picture: "让原有线条与构图重心形成对峙。", video: "紧跟已有动作，在动作尽头突然停住。", sound: "突出动作接触的一刻，让声尾迅速退下。", music: "缩短重音间距，在关键动作处收住。" },
  anticipation: { picture: "将视觉重心放在即将变化的已有细节上。", video: "先等候，待动作出现后再跟随。", sound: "把关键声源留到动作发生时。", music: "让动机重复，暂缓落到主音。" },
  groundedness: { picture: "稳住画面重心，让已有细节清楚可辨。", video: "保持稳定视点，跟完动作再停。", sound: "留下稳定的环境底声。", music: "以稳定节拍托住画面，减少叠加声部。" },
};

/** The reader and the writing prompt reuse the saved analysis, including mixed and negated signals. */
export function storyboardEmotionBeats(intent: z.infer<typeof emotionIntentSchema>, reading: z.infer<typeof readingSchema>) {
  // A direction after “开头” belongs to that beat until another phase is named.
  // “全程/始终” applies across phases even when the author mentions it later.
  let phase: (typeof reading.segments)[number]["stage"] = "unspecified";
  const phased = reading.segments.map(segment => {
    if (segment.stage !== "unspecified") phase = segment.stage;
    return { ...segment, phase };
  });
  const global = phased.filter(s => s.phase === "unspecified" || /全程|全片|始终|从头到尾/u.test(s.text)).map(s => s.text).join(" ");
  const byPhase = new Map<(typeof reading.segments)[number]["stage"], string>();
  for (const s of phased) byPhase.set(s.phase, (byPhase.get(s.phase) ?? "") + " " + s.text);
  return phased.map(({ stage, phase, text, signals }) => {
    const instructions = global + " " + byPhase.get(phase);
    const suggestions: Partial<ShotExpression> = {};
    for (const signal of signals.filter(s => s.polarity === "express")) {
      const hints = expressionHints[signal.key];
      const pacing = pacedDirections[signal.key];
      if (hints) {
        suggestions.picture ??= hints.art;
        suggestions.music ??= hints.music;
      }
      if (pacing) {
        suggestions.video ??= pacing[0];
        suggestions.sound ??= pacing[1];
      }
      const family = findSubcategory(signal.key)?.category.key;
      if (family && familyDirections[family]) {
        for (const track of ["picture", "video", "sound", "music"] as const) suggestions[track] ??= familyDirections[family][track];
      }
    }
    if (intent.mediumDirections.art) suggestions.picture = intent.mediumDirections.art;
    if (intent.mediumDirections.music) suggestions.music = intent.mediumDirections.music;
    const cameraInstructions = instructions.replace(/(?:不(?:要|用|必|再)?|别)固定(?:镜头|机位)/gu, "");
    if (/固定(?:镜头|机位)|机位固定|镜头不动|不要运镜/u.test(cameraInstructions))
      suggestions.video = "按原话保持机位，节拍由画内动作和停留时长承担。";
    if (/无(?:配乐|音乐)|不(?:要|用|加|放)(?:配乐|音乐)|只(?:留|有|听)[^，。；]{0,12}声|静音|无声/u.test(instructions))
      suggestions.music = "在作者指定的留白处停奏。";
    if (/静音|无声|完全安静/u.test(instructions)) suggestions.sound = "在作者指定的静音时段留白。";
    return { stage, text, signals, suggestions };
  });
}

export function storyboardEmotionBrief(snapshot?: CreationEmotionSnapshot) {
  return snapshot?.layers.map(layer => ({
    scope: layer.scope, revision: layer.revision, intent: layer.intent!.raw,
    explicit: layer.intent!.mediumDirections,
    beats: layer.reading ? storyboardEmotionBeats(layer.intent!, layer.reading) : [],
  }));
}

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
      : expression[medium] + " 把同一处动作或停顿作为配合点，按用户原话保留主次和进入、退出的时机。只输出当前媒介需要完成的部分，其他媒介只作参照。",
    JSON.stringify(payload),
  ].join("\n");
}
