import { createHash } from "node:crypto";

import type {
  ShotVisualAssetBinding,
  VisualAssetFixedFacts,
  VisualAssetKind,
  VisualAssetViewRole,
} from "../../shared/visualAssets";
import {
  findVisualAssetVersion,
  requiredVisualAssetViewRoles,
} from "../../shared/visualAssets";
import { getGeneratedImageById, getStoryById } from "../db";
import { materializeImageInput } from "./imageAssets";
import { toPublicImageUrl } from "./imageGen";
import { visualAssetsFromStory } from "./visualAssetPersistence";

export type VisualAssetGenerationIssueCode =
  | "binding-invalid"
  | "version-not-locked"
  | "view-missing"
  | "view-image-unavailable"
  | "shot-text-conflict"
  | "provider-role-unsupported";

export type VisualAssetGenerationIssue = {
  code: VisualAssetGenerationIssueCode;
  kind?: VisualAssetKind;
  message: string;
  imageId?: number;
};

export type VisualAssetGenerationView = {
  role: VisualAssetViewRole;
  imageId: number;
  sourceUrl: string;
  materializedUrl: string;
};

export type VisualAssetGenerationDimension = {
  kind: VisualAssetKind;
  assetId: string;
  versionId: string;
  assetName: string;
  fixedFacts: VisualAssetFixedFacts;
  allowedVariations: string[];
  views: VisualAssetGenerationView[];
  providerReferenceUrl: string;
};

export type VisualAssetGenerationSnapshot = {
  storyId: number;
  stableShotId: string;
  provider: "midjourney";
  fingerprint: string;
  dimensions: Partial<Record<VisualAssetKind, VisualAssetGenerationDimension>>;
  promptContract: string;
  /** MJ --oref: identity, hair, wardrobe and accessories. */
  characterRef?: string;
  /** Scene view supplied as an image prompt/context image. */
  sceneRef?: string;
  /** MJ --sref: medium and visual language only. */
  styleRef?: string;
};

export type VisualAssetGenerationContext =
  | { status: "disabled" }
  | { status: "blocked"; issues: VisualAssetGenerationIssue[] }
  | { status: "ready"; snapshot: VisualAssetGenerationSnapshot };

type StoryLike = { id: number; userId: number; body: unknown };
type ImageLike = {
  id: number;
  storyId: number | null;
  userId: number;
  imageUrl: string;
};

export type VisualAssetGenerationDependencies = {
  loadStory?: (storyId: number, userId: number) => Promise<StoryLike | null>;
  loadImage?: (imageId: number) => Promise<ImageLike | null>;
  materialize?: (url: string) => Promise<string>;
  makePublic?: (url: string) => Promise<string | undefined>;
};

const REPRESENTATIVE_ROLE: Record<VisualAssetKind, VisualAssetViewRole> = {
  // 人物的身份锚点必须是头部特写，不能是全身正面：
  // 全身图里脸只有几十像素，递给出图模型等于没给脸（2026-08-22）。
  character: "identity-detail",
  scene: "establishing",
  style: "character-sample",
};

const DIMENSION_TERMS: Record<VisualAssetKind, RegExp> = {
  character:
    /发型|头发|脸|五官|服装|衣服|外套|裤|裙|鞋|配饰|眼镜|hair|face|outfit|clothes|wardrobe|accessor/i,
  scene:
    /场景|地点|空间|布局|结构|墙|地面|材质|固定道具|家具|scene|location|layout|geometry|material|prop|furniture/i,
  style:
    /美术风格|画风|媒介|笔触|造型语言|色彩语言|配色|style|medium|brushwork|form language|color language|palette/i,
};
const CHANGE_TERMS =
  /改成|换成|变成|不要|去掉|移除|替换|不同的|change|replace|remove|without|different/i;

/**
 * 冲突词和维度词必须落在同一个小句里才算冲突。
 *
 * 原先是「全文里有改变词 且 有维度词」就拦，太松：合成出来的画面描述天然会写
 * 「白色长裙」这类外观词，同一段里再有一句「不要出现文字水印」就被判成冲突，
 * 于是任何绑了锁定资产又走提示词合成的镜头都会被自己挡住（2026-08-22 实测）。
 * 要拦的是「把裙子换成红色」这种同一句话里的表述。
 */
function clausesOf(text: string): string[] {
  return text
    .split(/[。！？!?;；\n]+|，(?=\s*(?:不要|禁止|避免))/)
    .map(clause => clause.trim())
    .filter(Boolean);
}

function textConflicts(kind: VisualAssetKind, text: string): boolean {
  if (!text.trim()) return false;
  return clausesOf(text).some(
    clause => CHANGE_TERMS.test(clause) && DIMENSION_TERMS[kind].test(clause)
  );
}

function factsLines(facts: VisualAssetFixedFacts): string[] {
  if (facts.kind === "character") {
    return [
      `脸部：${facts.face}`,
      `发型：${facts.hair}`,
      `服饰：${facts.outfit}`,
      `配饰：${facts.accessories.join("、") || "无"}`,
    ];
  }
  if (facts.kind === "scene") {
    return [
      `空间结构：${facts.geometry.join("、")}`,
      `材质：${facts.materials.join("、")}`,
      `固定道具：${facts.fixedProps.join("、")}`,
    ];
  }
  return [
    `媒介：${facts.medium.join("、")}`,
    `笔触：${facts.brushwork.join("、")}`,
    `造型语言：${facts.formLanguage.join("、")}`,
    `色彩语言：${facts.colorLanguage.join("、")}`,
    `禁止项：${facts.forbidden.join("、") || "无"}`,
  ];
}

function promptContract(
  dimensions: Partial<Record<VisualAssetKind, VisualAssetGenerationDimension>>
): string {
  const labels: Record<VisualAssetKind, string> = {
    character: "人物资产锁",
    scene: "场景资产锁",
    style: "美术风格资产锁",
  };
  const blocks = (["character", "scene", "style"] as const)
    .map(kind => {
      const dimension = dimensions[kind];
      if (!dimension) return "";
      return [
        `【${labels[kind]}｜${dimension.assetName}｜${dimension.versionId}】`,
        ...factsLines(dimension.fixedFacts),
        `允许变化：${dimension.allowedVariations.join("、") || "无"}`,
      ].join("\n");
    })
    .filter(Boolean);
  return [
    "【锁定视觉资产·最高优先级】以下人物、场景和美术事实是用户已经确认的视觉真相，必须与所附标准视图一致，不得被镜头文字、当前帧、自动美术库或模型默认想象改写。镜头景别、机位、动作、表情和光线只有在下方明确列为允许变化时才可改变。",
    ...blocks,
  ].join("\n");
}

function fingerprintOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function bindingForShot(
  bindings: ShotVisualAssetBinding[],
  stableShotId: string
): ShotVisualAssetBinding | undefined {
  return bindings.find(binding => binding.stableShotId === stableShotId);
}

export async function resolveVisualAssetGenerationContext(input: {
  storyId: number;
  userId: number;
  stableShotId: string;
  shotText?: string;
  explicitDimensionOverrides?: Partial<Record<VisualAssetKind, string>>;
  provider?: string;
  dependencies?: VisualAssetGenerationDependencies;
}): Promise<VisualAssetGenerationContext> {
  const loadStory = input.dependencies?.loadStory ?? getStoryById;
  const loadImage = input.dependencies?.loadImage ?? getGeneratedImageById;
  const materialize = input.dependencies?.materialize ?? materializeImageInput;
  const makePublic = input.dependencies?.makePublic ?? toPublicImageUrl;
  const story = await loadStory(input.storyId, input.userId);
  if (!story || story.userId !== input.userId) {
    return {
      status: "blocked",
      issues: [{ code: "binding-invalid", message: "故事不存在或无权访问" }],
    };
  }
  const aggregate = visualAssetsFromStory(story);
  const binding = bindingForShot(aggregate.bindings, input.stableShotId);
  if (!binding) return { status: "disabled" };

  const issues: VisualAssetGenerationIssue[] = [];
  const dimensions: Partial<
    Record<VisualAssetKind, VisualAssetGenerationDimension>
  > = {};
  const selectedKinds = (["character", "scene", "style"] as const).filter(
    kind => Boolean(binding[kind])
  );

  if (selectedKinds.length === 0) {
    issues.push({
      code: "binding-invalid",
      message: "镜头资产绑定为空，不能安全生成",
    });
  }
  if ((input.provider ?? "midjourney") !== "midjourney") {
    issues.push({
      code: "provider-role-unsupported",
      message: "当前供应商尚未验证人物、场景和风格参考职责，未提交付费生成",
    });
  }

  for (const kind of selectedKinds) {
    const ref = binding[kind]!;
    const found = findVisualAssetVersion(aggregate, ref);
    if (!found || found.asset.kind !== kind) {
      issues.push({
        code: "binding-invalid",
        kind,
        message: `${kind} 资产版本不存在或类型不匹配`,
      });
      continue;
    }
    if (found.version.status !== "locked") {
      issues.push({
        code: "version-not-locked",
        kind,
        message: `${found.asset.name} 的绑定版本未锁定`,
      });
      continue;
    }
    if (textConflicts(kind, input.shotText ?? "")) {
      issues.push({
        code: "shot-text-conflict",
        kind,
        message: `镜头文字要求改变已锁定的${kind}事实，请先修改资产或移除冲突要求`,
      });
    }
    if (input.explicitDimensionOverrides?.[kind]?.trim()) {
      issues.push({
        code: "shot-text-conflict",
        kind,
        message: `本次请求另行指定了${kind}方向，但镜头已绑定锁定资产；请以资产版本为准`,
      });
    }

    const views: VisualAssetGenerationView[] = [];
    for (const role of requiredVisualAssetViewRoles(kind)) {
      const view = found.version.views.find(
        item => item.role === role && item.status === "pass"
      );
      if (!view) {
        issues.push({
          code: "view-missing",
          kind,
          message: `${found.asset.name} 缺少可用的 ${role} 标准视图`,
        });
        continue;
      }
      const image = await loadImage(view.imageId);
      if (
        !image ||
        image.storyId !== input.storyId ||
        image.userId !== input.userId ||
        !image.imageUrl.trim()
      ) {
        issues.push({
          code: "view-image-unavailable",
          kind,
          imageId: view.imageId,
          message: `${found.asset.name} 的 ${role} 标准视图已丢失或不属于当前故事`,
        });
        continue;
      }
      try {
        const materializedUrl = await materialize(image.imageUrl);
        if (!materializedUrl) throw new Error("empty image input");
        views.push({
          role,
          imageId: image.id,
          sourceUrl: image.imageUrl,
          materializedUrl,
        });
      } catch {
        issues.push({
          code: "view-image-unavailable",
          kind,
          imageId: image.id,
          message: `${found.asset.name} 的 ${role} 标准视图无法读取`,
        });
      }
    }
    const representative = views.find(
      view => view.role === REPRESENTATIVE_ROLE[kind]
    );
    if (!representative) continue;
    let providerReferenceUrl = representative.materializedUrl;
    if (kind === "character" || kind === "style") {
      const publicUrl = await makePublic(representative.sourceUrl);
      if (!publicUrl) {
        issues.push({
          code: "provider-role-unsupported",
          kind,
          imageId: representative.imageId,
          message: `${found.asset.name} 的标准视图无法转换为供应商可读取的公网参考，未提交付费生成`,
        });
        continue;
      }
      providerReferenceUrl = publicUrl;
    }
    dimensions[kind] = {
      kind,
      assetId: found.asset.id,
      versionId: found.version.id,
      assetName: found.asset.name,
      fixedFacts: found.version.fixedFacts,
      allowedVariations: [...found.version.allowedVariations],
      views,
      providerReferenceUrl,
    };
  }

  if (issues.length > 0) return { status: "blocked", issues };
  const fingerprint = fingerprintOf(
    (["character", "scene", "style"] as const).map(kind => {
      const dimension = dimensions[kind];
      return dimension
        ? {
            kind,
            assetId: dimension.assetId,
            versionId: dimension.versionId,
            fixedFacts: dimension.fixedFacts,
            views: dimension.views.map(view => [view.role, view.imageId]),
          }
        : null;
    })
  );
  const snapshot: VisualAssetGenerationSnapshot = {
    storyId: input.storyId,
    stableShotId: input.stableShotId,
    provider: "midjourney",
    fingerprint,
    dimensions,
    promptContract: promptContract(dimensions),
    ...(dimensions.character
      ? { characterRef: dimensions.character.providerReferenceUrl }
      : {}),
    ...(dimensions.scene ? { sceneRef: dimensions.scene.providerReferenceUrl } : {}),
    ...(dimensions.style ? { styleRef: dimensions.style.providerReferenceUrl } : {}),
  };
  return { status: "ready", snapshot };
}
