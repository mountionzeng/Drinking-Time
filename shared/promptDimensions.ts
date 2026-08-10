/**
 * 提示词维度规范词表 —— 全项目「一个维度叫什么」的唯一事实源。
 *
 * ## 为什么需要它
 *
 * 在这张表出现之前，维度名字散落在 8 处独立声明里（`PROMPT_DIMENSION_WEIGHTS`、
 * `CONTENT_DIMENSIONS`、`VIDEO_DIMENSIONS`、`ART_PROMPT_LIBRARY_DIMENSIONS`、
 * `INHERITABLE_DIMENSIONS`、`VISUAL_SHARED_DIMENSIONS`、`structuredPromptAdapter`、
 * `CONSISTENCY_DIMENSIONS`），命名 snake_case 与 camelCase 混用，同一个语义有三四个名字：
 *
 *   配色 → `palette` / `color_palette` / `tone`
 *   风格 → `styleRef` / `style_reference` / `visual_style` / `genre`
 *   光   → `lighting` / `timeLight` / `time_light`
 *
 * 造成三类静默故障：
 *   1. 继承失效——`INHERITABLE_DIMENSIONS` 只认 `styleRef`，art 库产的是 `visual_style`
 *   2. 去重失效——`buildUnifiedPrompt` 按内容前缀去重，同义不同名的行各自成行，白吃 prompt 预算
 *   3. 无法按维度统计用户行为（编辑偏好学习的前置条件）
 *
 * ## 规范
 *
 * - **规范 id 一律 snake_case**（权威权重表、art 库、`VISUAL_SHARED_DIMENSIONS`、
 *   migration 元组四处已是 snake，改动面最小）。
 * - 历史上用过的其它写法（camelCase、镜头字段名）全部登记进 `aliases`，
 *   由 {@link canonicalDimension} 归一。
 * - `weight` 是**当前生效值**，不是「应该是多少」。别处硬编码了不同数值但没生效的，
 *   登记在 `declaredElsewhere` 里作为待决策记录——**读它不会改变任何行为**。
 *   收敛这些数值是独立的、需要单独评审的一步。
 *
 * ## 不在这张表里的维度
 *
 * - `shared/shotConsistency.ts` 的 `CONSISTENCY_DIMENSIONS`（face/hairstyle/clothing/
 *   scene/style）是**一致性比对的类别**，不是提示词的组成维度。名字看着像简写
 *   （`style` vs `visual_style`、`scene` vs `scene_reference`）但语义完全不同，
 *   **刻意不合并**。`promptDimensions.test.ts` 有断言防止有人日后并进来。
 * - `image_overrides` 是 migration 里的容器伪维度，不是真实维度。
 */

export type PromptDimensionCategory =
  | "story"
  | "content"
  | "camera"
  | "visual"
  | "video"
  | "narrative";

/** 别处硬编码、但当前未生效的权重声明。仅作记录，不参与计算。 */
export type PromptDimensionDeclaration = {
  /** 声明位置，便于收敛时直接定位 */
  site: string;
  weight: number;
};

export type PromptDimensionDef = {
  /** 规范 id，snake_case */
  id: string;
  /** 历史上用过的其它写法：camelCase、镜头字段名等 */
  aliases?: readonly string[];
  label: string;
  category: PromptDimensionCategory;
  /** 当前生效的权重（`promptDimensionWeight` 的返回值） */
  weight: number;
  /**
   * `stub` = 属于尚未正式集成的 art 库适配层（`structuredPromptAdapter`），
   * 它自带一套与主表不同的权重尺度。art 库正式接入时一并处理，现在不动。
   */
  status?: "stub";
  declaredElsewhere?: readonly PromptDimensionDeclaration[];
};

const BUILD_PROMPT_TABLE = "client/src/features/creationEditor/promptTable/buildPromptTable.ts";
const ART_ADAPTER = "client/src/features/creationEditor/promptTable/structuredPromptAdapter.ts";

export const PROMPT_DIMENSIONS: readonly PromptDimensionDef[] = [
  // ── 故事级 ──
  { id: "title", label: "标题", category: "story", weight: 0.18 },
  { id: "theme", label: "主题", category: "story", weight: 0.26 },
  { id: "story_arc", aliases: ["arc"], label: "故事弧", category: "story", weight: 0.26 },

  // ── 内容 ──
  { id: "subject", label: "主体", category: "content", weight: 0.42 },
  { id: "action", label: "动作", category: "content", weight: 0.38 },
  { id: "dialogue", label: "字幕/旁白", category: "content", weight: 0.34 },
  { id: "location", label: "场景", category: "content", weight: 0.32 },
  { id: "mood", label: "情绪", category: "content", weight: 0.3 },
  { id: "beat", label: "节拍", category: "content", weight: 0.28 },
  { id: "scene_title", aliases: ["sceneTitle"], label: "场次", category: "content", weight: 0.34 },
  {
    id: "scene_art_brief",
    aliases: ["sceneArtBrief"],
    label: "场景美术库",
    category: "content",
    weight: 0.4,
  },

  // ── 机位 ──
  // shot_type / camera_angle 从未进过权威表：谱系路径实际取到的是默认 0.3，
  // 而 buildPromptTable 自己硬编码了 0.28 / 0.24。此处如实记录两者。
  {
    id: "shot_type",
    aliases: ["shotType"],
    label: "景别",
    category: "camera",
    weight: 0.3,
    declaredElsewhere: [{ site: BUILD_PROMPT_TABLE, weight: 0.28 }],
  },
  {
    id: "camera_angle",
    aliases: ["cameraAngle"],
    label: "机位",
    category: "camera",
    weight: 0.3,
    declaredElsewhere: [{ site: BUILD_PROMPT_TABLE, weight: 0.24 }],
  },
  { id: "camera_motion", aliases: ["cameraMove"], label: "相机运动", category: "camera", weight: 0.36 },

  // ── 视觉 ──
  {
    id: "visual_style",
    aliases: ["visualPreference"],
    label: "视觉风格",
    category: "visual",
    weight: 0.36,
  },
  // 0.26 → 0.32：见 `pnpm eval:weights` 的真实编辑率证据；不在这里冻结
  // 会随本地语料变化的样本数和百分比。调到跟 location 同档。
  { id: "style_reference", aliases: ["styleRef"], label: "风格参考", category: "visual", weight: 0.32 },
  { id: "color_palette", label: "配色", category: "visual", weight: 0.28 },
  {
    id: "composition",
    label: "构图",
    category: "visual",
    weight: 0.24,
    declaredElsewhere: [{ site: ART_ADAPTER, weight: 0.05 }],
  },
  {
    id: "lighting",
    label: "光线",
    category: "visual",
    weight: 0.24,
    declaredElsewhere: [{ site: ART_ADAPTER, weight: 0.05 }],
  },
  {
    id: "material",
    label: "材质",
    category: "visual",
    weight: 0.24,
    declaredElsewhere: [{ site: ART_ADAPTER, weight: 0.05 }],
  },
  { id: "time_light", aliases: ["timeLight"], label: "时间光", category: "visual", weight: 0.24 },
  { id: "character_reference", label: "角色参考", category: "visual", weight: 0.52 },
  { id: "scene_reference", label: "场景参考", category: "visual", weight: 0.42 },
  { id: "art_style_recipe", label: "美术配方", category: "visual", weight: 0.4 },
  { id: "negative_prompt", aliases: ["negativePrompt"], label: "负面提示", category: "visual", weight: 0.22 },
  { id: "image_prompt", aliases: ["promptDraft"], label: "图片提示词", category: "visual", weight: 0.5 },

  // ── 视频 ──
  { id: "video_prompt", aliases: ["videoPrompt"], label: "图生视频提示词", category: "video", weight: 0.5 },
  { id: "sound", label: "背景音/字幕气口", category: "video", weight: 0.32 },
  {
    id: "video_start",
    aliases: ["videoStart"],
    label: "起始画面",
    category: "video",
    weight: 0.3,
    declaredElsewhere: [{ site: BUILD_PROMPT_TABLE, weight: 0.35 }],
  },
  {
    id: "video_end",
    aliases: ["videoEnd"],
    label: "结束状态",
    category: "video",
    weight: 0.3,
    declaredElsewhere: [{ site: BUILD_PROMPT_TABLE, weight: 0.34 }],
  },
  { id: "transition_in", aliases: ["transitionIn"], label: "接前镜", category: "video", weight: 0.3 },
  { id: "transition_out", aliases: ["transitionOut"], label: "接后镜", category: "video", weight: 0.3 },

  // ── 叙事/导演 ──
  { id: "intent", label: "导演意图", category: "narrative", weight: 0.5 },
  { id: "rationale", label: "导演解释", category: "narrative", weight: 0.46 },
  { id: "narrative_claim", aliases: ["narrativeClaim"], label: "优势主张", category: "narrative", weight: 0.54 },
  { id: "role_concern", aliases: ["roleConcern"], label: "岗位关心什么", category: "narrative", weight: 0.5 },
  {
    id: "visual_translation",
    aliases: ["visualTranslation"],
    label: "导演画面策略",
    category: "narrative",
    weight: 0.48,
  },
  {
    id: "causal_explanation",
    aliases: ["causalExplanation"],
    label: "因果解释",
    category: "narrative",
    weight: 0.46,
  },
  {
    id: "narrative_evidence",
    aliases: ["narrativeEvidence"],
    label: "可信证据",
    category: "narrative",
    weight: 0.44,
  },
  { id: "external_value", aliases: ["externalValue"], label: "外部价值", category: "narrative", weight: 0.42 },
  { id: "story_context", aliases: ["storyContext"], label: "上下文位置", category: "narrative", weight: 0.36 },
  { id: "avoid_misread", aliases: ["avoidMisread"], label: "避免误读", category: "narrative", weight: 0.3 },
  {
    id: "recommendation_status",
    aliases: ["recommendationStatus"],
    label: "建议状态",
    category: "narrative",
    weight: 0.26,
  },
  { id: "intent_summary", aliases: ["intentSummary"], label: "意图摘要", category: "narrative", weight: 0.22 },

  // ── art 库适配层（stub）──
  // structuredPromptAdapter 是临时占位（其文件注释：real art-repo integration should
  // replace this function only）。它自带一套近乎归零的权重尺度，与主表不是同一套设计意图，
  // 因此登记为 stub 而不是并进上面的视觉维度。art 库正式接入时一并决策。
  {
    id: "genre",
    label: "流派",
    category: "visual",
    weight: 0.3,
    status: "stub",
    declaredElsewhere: [{ site: ART_ADAPTER, weight: 0.5 }],
  },
  { id: "tone", label: "色调", category: "visual", weight: 0.3, status: "stub" },
  {
    id: "palette",
    label: "配色",
    category: "visual",
    weight: 0.3,
    status: "stub",
    declaredElsewhere: [{ site: ART_ADAPTER, weight: 0.05 }],
  },
  {
    id: "angle",
    label: "角度",
    category: "camera",
    weight: 0.3,
    status: "stub",
    declaredElsewhere: [{ site: ART_ADAPTER, weight: 0.05 }],
  },
  {
    id: "emotion",
    label: "情感",
    category: "content",
    weight: 0.3,
    status: "stub",
    declaredElsewhere: [{ site: ART_ADAPTER, weight: 0.15 }],
  },
];

/**
 * 容器伪维度：migration 用它承载整包 image overrides，不是真实的提示词维度。
 * 登记在此，使「无孤儿维度」测试可以显式豁免它，而不是靠沉默通过。
 */
export const PSEUDO_DIMENSIONS: readonly string[] = ["image_overrides"];

const byId = new Map<string, PromptDimensionDef>();
const byAnyName = new Map<string, PromptDimensionDef>();

/**
 * 建表时立即校验，不用等测试跑到才发现——两个定义抢注同一个 id/别名
 * 正是这张表存在的理由（散落各处的维度名互相打架），建表本身不能重蹈覆辙。
 */
function registerName(name: string, def: PromptDimensionDef, kind: "id" | "alias"): void {
  const existing = byAnyName.get(name);
  if (existing && existing !== def) {
    throw new Error(
      `[promptDimensions] "${name}" 同时被 "${existing.id}" 和 "${def.id}" 注册为${kind === "id" ? "规范 id" : "别名"}——两个维度定义不能共享同一个名字。`,
    );
  }
  byAnyName.set(name, def);
}

for (const def of PROMPT_DIMENSIONS) {
  if (byId.has(def.id)) {
    throw new Error(`[promptDimensions] 规范 id "${def.id}" 重复定义。`);
  }
  byId.set(def.id, def);
  registerName(def.id, def, "id");
  for (const alias of def.aliases ?? []) registerName(alias, def, "alias");
}

/** 已知名字（规范 id + 全部别名）。 */
export const KNOWN_DIMENSION_NAMES: readonly string[] = Array.from(byAnyName.keys()).sort();

/**
 * 把任意写法归一到规范 id。未登记的名字**原样返回**——
 * 归一是尽力而为，不会因为遇到新名字就抛错或吞掉它。
 */
export function canonicalDimension(name: string): string {
  return byAnyName.get(name)?.id ?? name;
}

/** 取维度定义；接受规范 id 或任意别名。 */
export function promptDimension(name: string): PromptDimensionDef | undefined {
  return byAnyName.get(name);
}

export function isKnownDimension(name: string): boolean {
  return byAnyName.has(name);
}

export function promptDimensionLabel(name: string): string | undefined {
  return byAnyName.get(name)?.label;
}

/** 仅供测试与工具使用：按规范 id 精确取，不走别名。 */
export function promptDimensionById(id: string): PromptDimensionDef | undefined {
  return byId.get(id);
}
