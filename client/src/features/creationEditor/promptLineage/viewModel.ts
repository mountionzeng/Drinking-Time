import {
  compilePromptTargets,
  type CompiledPromptTarget,
} from "@shared/promptCompiler";
import type {
  PromptModality,
  PromptNode,
  PromptRevision,
  PromptRevisionAuthor,
  PromptScope,
  StoryPromptAggregate,
} from "@shared/promptLineage";
import type {
  PromptCategory,
  PromptRow,
  PromptSourceSystem,
} from "../promptTable/types";

type PromptOutputModality = Exclude<PromptModality, "shared">;

type PromptDimensionMeta = {
  label: string;
  category: PromptCategory;
  source: PromptSourceSystem;
  weight: number;
};

const DIMENSION_META: Record<string, PromptDimensionMeta> = {
  title: {
    label: "故事标题",
    category: "narrative",
    source: "director",
    weight: 0.18,
  },
  theme: {
    label: "故事主题",
    category: "narrative",
    source: "director",
    weight: 0.26,
  },
  story_arc: {
    label: "叙事弧线",
    category: "narrative",
    source: "director",
    weight: 0.26,
  },
  visual_style: {
    label: "全局美术",
    category: "style",
    source: "art-repo",
    weight: 0.36,
  },
  color_palette: {
    label: "色彩基调",
    category: "style",
    source: "art-repo",
    weight: 0.28,
  },
  composition: {
    label: "构图",
    category: "style",
    source: "art-repo",
    weight: 0.24,
  },
  lighting: {
    label: "灯光",
    category: "style",
    source: "art-repo",
    weight: 0.24,
  },
  character_reference: {
    label: "人物参考",
    category: "style",
    source: "art-repo",
    weight: 0.52,
  },
  scene_reference: {
    label: "场景参考",
    category: "style",
    source: "art-repo",
    weight: 0.42,
  },
  art_style_recipe: {
    label: "美术配方",
    category: "style",
    source: "art-repo",
    weight: 0.4,
  },
  subject: {
    label: "主体",
    category: "content",
    source: "chat",
    weight: 0.42,
  },
  action: {
    label: "动作",
    category: "content",
    source: "chat",
    weight: 0.38,
  },
  dialogue: {
    label: "字幕/旁白",
    category: "content",
    source: "chat",
    weight: 0.34,
  },
  location: {
    label: "场景",
    category: "content",
    source: "intent",
    weight: 0.32,
  },
  time_light: {
    label: "时间光",
    category: "content",
    source: "intent",
    weight: 0.24,
  },
  mood: {
    label: "情绪",
    category: "content",
    source: "intent",
    weight: 0.3,
  },
  style_reference: {
    label: "风格参考",
    category: "style",
    source: "intent",
    weight: 0.26,
  },
  beat: {
    label: "拍点",
    category: "narrative",
    source: "director",
    weight: 0.28,
  },
  intent: {
    label: "镜头意图",
    category: "narrative",
    source: "director",
    weight: 0.5,
  },
  rationale: {
    label: "导演解释",
    category: "narrative",
    source: "director",
    weight: 0.46,
  },
  image_prompt: {
    label: "图片提示词",
    category: "style",
    source: "director",
    weight: 0.5,
  },
  negative_prompt: {
    label: "负面提示",
    category: "style",
    source: "director",
    weight: 0.22,
  },
  camera_motion: {
    label: "相机运动",
    category: "motion",
    source: "director",
    weight: 0.36,
  },
  video_prompt: {
    label: "图生视频提示词",
    category: "motion",
    source: "director",
    weight: 0.5,
  },
  sound: {
    label: "背景音/气口",
    category: "motion",
    source: "director",
    weight: 0.32,
  },
  narrativeClaim: {
    label: "优势主张",
    category: "narrative",
    source: "director",
    weight: 0.54,
  },
  roleConcern: {
    label: "岗位关心什么",
    category: "narrative",
    source: "director",
    weight: 0.5,
  },
  visualTranslation: {
    label: "导演画面策略",
    category: "narrative",
    source: "director",
    weight: 0.48,
  },
  causalExplanation: {
    label: "因果解释",
    category: "narrative",
    source: "director",
    weight: 0.46,
  },
  narrativeEvidence: {
    label: "可信证据",
    category: "narrative",
    source: "director",
    weight: 0.44,
  },
  externalValue: {
    label: "外部价值",
    category: "narrative",
    source: "director",
    weight: 0.42,
  },
  storyContext: {
    label: "上下文位置",
    category: "narrative",
    source: "director",
    weight: 0.36,
  },
  avoidMisread: {
    label: "避免误读",
    category: "narrative",
    source: "director",
    weight: 0.3,
  },
  recommendationStatus: {
    label: "建议状态",
    category: "narrative",
    source: "director",
    weight: 0.26,
  },
  intentSummary: {
    label: "意图摘要",
    category: "narrative",
    source: "director",
    weight: 0.22,
  },
};

const SOURCE_LABELS: Record<PromptSourceSystem, string> = {
  chat: "聊天",
  intent: "意图",
  director: "导演",
  "art-repo": "art库",
  inheritance: "继承",
  manual: "手改",
};

export type PromptLineageRowView = PromptRow & {
  nodeId: number;
  scope: PromptScope;
  modality: PromptModality;
  stableShotId: string | null;
  revisionId: number;
  authorType: PromptRevisionAuthor;
  createdAt: string;
  usedBy: PromptOutputModality[];
};

export type PromptLineageShotView = {
  version: number;
  stableShotId: string;
  shotNo: number;
  rows: PromptLineageRowView[];
  currentTargets: Record<PromptOutputModality, CompiledPromptTarget>;
  compilationIds: Partial<Record<PromptOutputModality, number>>;
};

export type PromptLineageShotPreview = {
  stableShotId: string;
  current: Record<PromptOutputModality, CompiledPromptTarget>;
  proposed: Record<PromptOutputModality, CompiledPromptTarget>;
  impactedModalities: PromptOutputModality[];
};

export type PromptLineageRevisionPreview = {
  nodeId: number;
  revisionId: number;
  shots: PromptLineageShotPreview[];
};

export function resolvePromptCandidateNodeId(input: {
  aggregate: StoryPromptAggregate;
  row: Pick<
    PromptLineageRowView,
    "nodeId" | "scope" | "modality" | "dimension"
  >;
  targetScope: "shot" | "source";
}): number | null {
  if (input.targetScope === "shot" || input.row.scope === "story") {
    return input.row.nodeId;
  }
  return (
    input.aggregate.nodes.find(
      node =>
        node.scope === "story" &&
        node.modality === input.row.modality &&
        node.dimension === input.row.dimension,
    )?.id ?? null
  );
}

function bindingOrder(
  aggregate: StoryPromptAggregate,
  stableShotId: string,
): Map<number, number> {
  return new Map(
    aggregate.bindings
      .filter(
        binding =>
          binding.stableShotId == null || binding.stableShotId === stableShotId,
      )
      .map(binding => [binding.nodeId, binding.sortOrder]),
  );
}

function humanizeDimension(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

function dimensionMeta(
  dimension: string,
  modality: PromptModality,
  authorType: PromptRevisionAuthor,
): PromptDimensionMeta {
  const base = DIMENSION_META[dimension];
  if (authorType === "user") {
    if (base) return { ...base, source: "manual" };
    return {
      label: humanizeDimension(dimension),
      category: modality === "video" ? "motion" : "content",
      source: "manual",
      weight: 0.3,
    };
  }
  if (base) return base;
  return {
    label: humanizeDimension(dimension),
    category: modality === "video" ? "motion" : "content",
    source: modality === "shared" ? "inheritance" : "director",
    weight: 0.3,
  };
}

function scopeRank(node: Pick<PromptNode, "scope">): number {
  if (node.scope === "story") return 0;
  if (node.scope === "shot") return 1;
  return 2;
}

function sourceSystem(
  node: Pick<PromptNode, "scope" | "modality" | "dimension">,
  authorType: PromptRevisionAuthor,
): PromptSourceSystem {
  if (authorType === "user") return "manual";
  return dimensionMeta(node.dimension, node.modality, authorType).source;
}

function inheritanceState(
  node: Pick<PromptNode, "scope">,
  revision: Pick<PromptRevision, "authorType" | "parentRevisionId">,
): PromptRow["inheritance"] {
  if (node.scope === "story") return "inherited";
  if (revision.authorType === "user") {
    return "overridden";
  }
  return "own";
}

function shotIdsForNode(
  aggregate: StoryPromptAggregate,
  node: Pick<PromptNode, "stableShotId">,
): string[] {
  if (node.stableShotId) return [node.stableShotId];
  return Array.from(
    new Set(
      aggregate.nodes
        .map(item => item.stableShotId)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
}

function usedByModalities(
  currentTargets: Record<PromptOutputModality, CompiledPromptTarget>,
  revisionId: number,
): PromptOutputModality[] {
  return (["dialogue", "image", "video"] as const).filter(modality =>
    currentTargets[modality].revisionIds.includes(revisionId),
  );
}

export function buildPromptLineageShotView(input: {
  aggregate: StoryPromptAggregate;
  stableShotId: string;
  shotNo: number;
}): PromptLineageShotView {
  const order = bindingOrder(input.aggregate, input.stableShotId);
  const revisionById = new Map(
    input.aggregate.revisions.map(revision => [revision.id, revision]),
  );
  const currentTargets = compilePromptTargets({
    stableShotId: input.stableShotId,
    nodes: input.aggregate.nodes,
    revisions: input.aggregate.revisions,
    bindings: input.aggregate.bindings,
  });
  const eligibleNodes = input.aggregate.nodes
    .filter(
      node =>
        node.dimension !== "image_overrides" &&
        (node.scope === "story" || node.stableShotId === input.stableShotId),
    )
    .sort((left, right) => {
      const scopeDelta = scopeRank(left) - scopeRank(right);
      if (scopeDelta !== 0) return scopeDelta;
      const orderDelta =
        (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.id) ?? Number.MAX_SAFE_INTEGER);
      return orderDelta || left.id - right.id;
    });
  const effectiveNodes = Array.from(
    eligibleNodes.reduce((nodesByDimension, node) => {
      nodesByDimension.set(node.dimension, node);
      return nodesByDimension;
    }, new Map<string, PromptNode>()).values(),
  );
  const rows = effectiveNodes
    .map(node => {
      const revision =
        node.currentRevisionId == null
          ? undefined
          : revisionById.get(node.currentRevisionId);
      if (!revision) return null;
      const meta = dimensionMeta(
        node.dimension,
        node.modality,
        revision.authorType,
      );
      const system = sourceSystem(node, revision.authorType);
      return {
        id: `lineage:${node.id}`,
        nodeId: node.id,
        dimension: node.dimension,
        label: meta.label,
        value: revision.content,
        weight: revision.weight,
        category: meta.category,
        source: {
          system,
          label: SOURCE_LABELS[system],
        },
        inheritance: inheritanceState(node, revision),
        contentLength: Array.from(revision.content).length,
        scope: node.scope,
        modality: node.modality,
        stableShotId: node.stableShotId,
        revisionId: revision.id,
        authorType: revision.authorType,
        createdAt: revision.createdAt,
        usedBy: usedByModalities(currentTargets, revision.id),
      } satisfies PromptLineageRowView;
    })
    .filter((row): row is PromptLineageRowView => Boolean(row));

  const compilationIds = Object.fromEntries(
    input.aggregate.compilationHeads
      .filter(head => head.stableShotId === input.stableShotId)
      .map(head => [head.modality, head.currentCompilationId]),
  ) as Partial<Record<PromptOutputModality, number>>;

  return {
    version: input.aggregate.state.version,
    stableShotId: input.stableShotId,
    shotNo: input.shotNo,
    rows,
    currentTargets,
    compilationIds,
  };
}

export function buildPromptLineageRevisionPreview(input: {
  aggregate: StoryPromptAggregate;
  nodeId: number;
  revisionId: number;
}): PromptLineageRevisionPreview {
  const node = input.aggregate.nodes.find(item => item.id === input.nodeId);
  if (!node) {
    throw new Error(`Prompt node ${input.nodeId} 不存在`);
  }
  const shots = shotIdsForNode(input.aggregate, node).map(stableShotId => {
    const current = compilePromptTargets({
      stableShotId,
      nodes: input.aggregate.nodes,
      revisions: input.aggregate.revisions,
      bindings: input.aggregate.bindings,
    });
    const proposed = compilePromptTargets({
      stableShotId,
      nodes: input.aggregate.nodes,
      revisions: input.aggregate.revisions,
      bindings: input.aggregate.bindings,
      revisionOverrides: { [node.id]: input.revisionId },
    });
    const impactedModalities = (["dialogue", "image", "video"] as const).filter(
      modality =>
        current[modality].inputFingerprint !== proposed[modality].inputFingerprint,
    );
    return {
      stableShotId,
      current,
      proposed,
      impactedModalities,
    };
  });
  return {
    nodeId: input.nodeId,
    revisionId: input.revisionId,
    shots,
  };
}
