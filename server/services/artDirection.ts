import type { ImageProvider } from "./imageGen";
import { editImage, generateImage } from "./imageGen";
import { renderViaGate } from "./renderGate";
import {
  getAllStyles,
  type StyleEntry,
} from "./styleLibrary";
import {
  artRecipePrompt,
  type ArtDirectionCandidate,
  type ArtCandidateRole,
  type ArtRecipeDNA,
  type ArtReferenceMaterial,
} from "../../shared/artDirection";

export type ArtCandidatePlan = {
  id: string;
  title: string;
  role: ArtCandidateRole;
  axis?: string;
  recipe: ArtRecipeDNA;
};

export type GenerateArtCandidatesParams = {
  targetContent: string;
  references: ArtReferenceMaterial[];
  imageProvider?: ImageProvider;
  round: number;
  mode?: "explore" | "converge";
  likedRecipes?: ArtRecipeDNA[];
};

const MEDIA_TOKEN = /(illustration|painting|watercolor|gouache|ink|oil|crayon|pencil|pastel|woodblock|print|collage|digital|animation|anime|photography|photo|geometric|flat|line|pixel|clay|3d|水彩|水墨|油画|版画|拼贴|线描|摄影|插画|平涂|蜡笔|铅笔|像素|黏土)/i;

function unique(values: Array<string | undefined | null>, limit = 8): string[] {
  return Array.from(
    new Set(values.map(value => value?.trim() ?? "").filter(Boolean)),
  ).slice(0, limit);
}

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

function rotate<T>(values: T[], offset: number): T[] {
  if (values.length === 0) return [];
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function referenceDNA(references: ArtReferenceMaterial[]): ArtRecipeDNA {
  const aesthetic = references.filter(
    reference =>
      reference.selected &&
      (reference.purpose === "aesthetic" || reference.purpose === "both"),
  );
  return {
    style: unique(aesthetic.flatMap(reference => reference.visualStyle ?? []), 4),
    palette: unique(aesthetic.flatMap(reference => reference.colorPalette ?? []), 5),
    light: unique(aesthetic.map(reference => reference.lighting), 3),
    composition: unique(aesthetic.map(reference => reference.composition), 3),
    material: unique(aesthetic.flatMap(reference => reference.material ?? []), 4),
    negative: [],
  };
}

function mergeDNA(base: ArtRecipeDNA, variation: ArtRecipeDNA): ArtRecipeDNA {
  return {
    style: unique(["原创风格化插图", ...base.style, ...variation.style], 6),
    palette: unique([...base.palette, ...variation.palette], 7),
    light: unique([...base.light, ...variation.light], 4),
    composition: unique([...base.composition, ...variation.composition], 4),
    material: unique([...base.material, ...variation.material], 5),
    negative: unique([
      ...base.negative,
      ...variation.negative,
      "多格拼图",
      "分镜拼贴",
      "文字",
      "水印",
      "现成 IP 角色",
      "具名艺术家仿作",
    ], 10),
  };
}

function styleEntryDNA(entry: StyleEntry): ArtRecipeDNA {
  return {
    style: unique(entry.style.filter(token => MEDIA_TOKEN.test(token)), 3),
    palette: unique(entry.palette, 5),
    light: unique([entry.light], 2),
    composition: unique([entry.composition], 2),
    material: unique([entry.material], 2),
    negative: unique(entry.negative, 5),
  };
}

function mergedLikedDNA(liked: ArtRecipeDNA[]): ArtRecipeDNA {
  const rank = (field: keyof ArtRecipeDNA, limit: number) => {
    const counts = new Map<string, number>();
    for (const recipe of liked) {
      for (const value of recipe[field]) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([value]) => value);
  };
  return {
    style: rank("style", 5),
    palette: rank("palette", 6),
    light: rank("light", 3),
    composition: rank("composition", 3),
    material: rank("material", 4),
    negative: rank("negative", 8),
  };
}

const COMPARISON_AXES: Array<{
  axis: string;
  title: string;
  patch: Partial<ArtRecipeDNA>;
}> = [
  {
    axis: "色温",
    title: "单因素 · 更温暖",
    patch: { palette: ["自然暖色温", "克制的暖黄点色"] },
  },
  {
    axis: "色温",
    title: "单因素 · 更清冷",
    patch: { palette: ["自然冷色温", "克制的青绿色"] },
  },
  {
    axis: "材质",
    title: "单因素 · 更有手感",
    patch: { material: ["可见纸张纤维", "轻微手工笔触"] },
  },
  {
    axis: "光线",
    title: "单因素 · 更柔和",
    patch: { light: ["大面积漫射柔光", "低反差阴影"] },
  },
  {
    axis: "构图",
    title: "单因素 · 更多留白",
    patch: { composition: ["主体缩小", "稳定负空间"] },
  },
];

function patchDNA(base: ArtRecipeDNA, patch: Partial<ArtRecipeDNA>): ArtRecipeDNA {
  return {
    ...base,
    style: unique(patch.style ?? base.style, 6),
    palette: unique(patch.palette ?? base.palette, 7),
    light: unique(patch.light ?? base.light, 4),
    composition: unique(patch.composition ?? base.composition, 4),
    material: unique(patch.material ?? base.material, 5),
    negative: unique(patch.negative ?? base.negative, 10),
  };
}

export function buildArtCandidatePlans(params: {
  targetContent: string;
  references: ArtReferenceMaterial[];
  round: number;
  mode?: "explore" | "converge";
  likedRecipes?: ArtRecipeDNA[];
  styles?: StyleEntry[];
}): ArtCandidatePlan[] {
  const styles = params.styles ?? getAllStyles();
  const baseFromReferences = referenceDNA(params.references);
  const convergenceBase =
    params.mode === "converge" && params.likedRecipes?.length
      ? mergedLikedDNA(params.likedRecipes)
      : baseFromReferences;
  const orderedStyles = rotate(
    styles,
    hash(`${params.targetContent}:${params.round}`),
  );
  const fallbackDirections: ArtRecipeDNA[] = [
    {
      style: ["平涂叙事插图"],
      palette: ["低饱和自然色"],
      light: ["柔和侧光"],
      composition: ["单一主体", "清楚前后层次"],
      material: ["细纸纹"],
      negative: [],
    },
    {
      style: ["水性媒介手绘插图"],
      palette: ["透明青绿", "暖灰"],
      light: ["自然漫射光"],
      composition: ["主体偏侧", "适度留白"],
      material: ["水彩晕染边缘"],
      negative: [],
    },
    {
      style: ["颗粒版画插图"],
      palette: ["有限色盘"],
      light: ["明暗块面"],
      composition: ["轮廓清楚", "平面层次"],
      material: ["印刷颗粒"],
      negative: [],
    },
    {
      style: ["细腻数字绘本插图"],
      palette: ["克制亮色点缀", "中低饱和底色"],
      light: ["清透环境光"],
      composition: ["稳定中心", "环境包围主体"],
      material: ["细腻数字笔刷"],
      negative: [],
    },
  ];
  const directionVariations = Array.from({ length: 4 }, (_, index) => {
    const entry = orderedStyles[index];
    return entry ? styleEntryDNA(entry) : fallbackDirections[index];
  });
  const directionTitles = ["温润手作", "清透留白", "颗粒图形", "细腻绘本"];
  const directionPlans = directionVariations.map((variation, index) => ({
    id: `art-${params.round}-direction-${index + 1}`,
    title:
      params.mode === "converge"
        ? `收敛方向 ${index + 1}`
        : directionTitles[index],
    role: (params.mode === "converge" ? "convergence" : "direction") as ArtCandidateRole,
    recipe: mergeDNA(convergenceBase, variation),
  }));

  const knownAxes = new Set<string>();
  if (convergenceBase.palette.length > 0) knownAxes.add("色温");
  if (convergenceBase.material.length > 0) knownAxes.add("材质");
  if (convergenceBase.light.length > 0) knownAxes.add("光线");
  if (convergenceBase.composition.length > 0) knownAxes.add("构图");
  const comparisons = [
    ...COMPARISON_AXES.filter(item => !knownAxes.has(item.axis)),
    ...COMPARISON_AXES.filter(item => knownAxes.has(item.axis)),
  ].slice(0, 2);
  const comparisonBase = directionPlans[0]?.recipe ?? mergeDNA(convergenceBase, fallbackDirections[0]);
  const comparisonPlans = comparisons.map((comparison, index) => ({
    id: `art-${params.round}-comparison-${index + 1}`,
    title: comparison.title,
    role: "comparison" as const,
    axis: comparison.axis,
    recipe: patchDNA(comparisonBase, comparison.patch),
  }));

  return [...directionPlans, ...comparisonPlans];
}

function referencePrompt(references: ArtReferenceMaterial[]): string {
  const selected = references.filter(reference => reference.selected);
  const factLines = selected
    .filter(reference => reference.purpose === "fact" || reference.purpose === "both")
    .map(reference => `- ${reference.label}：${reference.text || "保持图中人物、物件与场景事实"}`);
  const aestheticLines = selected
    .filter(reference => reference.purpose === "aesthetic" || reference.purpose === "both")
    .map(reference => {
      const dna = unique([
        ...(reference.visualStyle ?? []),
        ...(reference.colorPalette ?? []),
        reference.lighting,
        reference.composition,
        ...(reference.material ?? []),
      ], 8);
      return `- ${reference.label}${dna.length ? `：${dna.join(" / ")}` : ""}`;
    });
  return [
    factLines.length ? `事实参考：\n${factLines.join("\n")}` : "",
    aestheticLines.length ? `审美参考：\n${aestheticLines.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export function buildArtCandidatePrompt(params: {
  targetContent: string;
  references: ArtReferenceMaterial[];
  plan: ArtCandidatePlan;
}): string {
  return [
    "生成一张独立的正方形风格化叙事插图。",
    "只生成一张完整画面，禁止多格漫画、九宫格、分镜表、拼图或同图多方案。",
    "六张候选必须画同一个故事瞬间、同一个主体与动作；只改变视觉表达。",
    `故事瞬间：${params.targetContent}`,
    referencePrompt(params.references),
    `本张视觉方向：${params.plan.title}`,
    artRecipePrompt(params.plan.recipe),
    "忠于用户材料，不新增人物、事件或戏剧冲突。画面中不要文字，不要水印。",
  ].filter(Boolean).join("\n\n");
}

function strongestReferenceImage(
  references: ArtReferenceMaterial[],
): string | undefined {
  return references.find(
    reference =>
      reference.selected &&
      reference.imageUrl &&
      (reference.purpose === "fact" || reference.purpose === "both"),
  )?.imageUrl ?? references.find(
    reference => reference.selected && Boolean(reference.imageUrl),
  )?.imageUrl;
}

async function mapLimit<T, R>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function generateArtDirectionCandidates(
  params: GenerateArtCandidatesParams,
): Promise<Array<Omit<ArtDirectionCandidate, "imageId">>> {
  const plans = buildArtCandidatePlans(params);
  const referenceImage = strongestReferenceImage(params.references);
  const generated = await mapLimit<
    ArtCandidatePlan,
    Omit<ArtDirectionCandidate, "imageId"> | null
  >(plans, 2, async plan => {
    try {
      const prompt = buildArtCandidatePrompt({
        targetContent: params.targetContent,
        references: params.references,
        plan,
      });
      const result = await renderViaGate(
        {
          prompt,
          referenceImages: params.references
            .filter(reference => reference.selected && reference.imageUrl)
            .map(reference => reference.imageUrl!),
          artDirection: plan.recipe,
        },
        judgedPrompt => {
          if (referenceImage && params.imageProvider !== "midjourney") {
            return editImage(referenceImage, judgedPrompt, {
              provider: params.imageProvider,
              aspectRatio: "1:1",
              fidelity: "draft",
            });
          }
          const midjourneyReferencePrefix =
            params.imageProvider === "midjourney"
              ? params.references
                  .filter(reference => reference.selected && reference.imageUrl)
                  .slice(0, 2)
                  .map(reference => reference.imageUrl)
                  .join(" ")
              : "";
          return generateImage(
            [midjourneyReferencePrefix, judgedPrompt].filter(Boolean).join("\n"),
            {
              provider: params.imageProvider,
              aspectRatio: "1:1",
              fidelity: "draft",
            },
          );
        },
      );
      if (result.status !== "ok" || !result.imageUrl) {
        throw new Error(result.message || `${plan.title} 生成失败`);
      }
      return {
        ...plan,
        imageUrl: result.imageUrl,
        prompt,
        verdict: "pending" as const,
      };
    } catch (error) {
      console.warn(`[artDirection] ${plan.title} failed:`, error);
      return null;
    }
  });
  const successful = generated.filter(
    (candidate): candidate is Omit<ArtDirectionCandidate, "imageId"> =>
      candidate !== null,
  );
  if (successful.length === 0) {
    throw new Error("六张美术候选都没有生成成功，请稍后重试。");
  }
  return successful;
}
