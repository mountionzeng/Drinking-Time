/**
 * 一键剪辑 · 视觉一致性质检：
 * 把故事的人物锚点图和每个镜头的当前主图成对喂给视觉模型，
 * 识别五官/发型/服饰/场景/画风的不一致，产出结构化 findings 供用户逐条裁决。
 * 单图失败只降级该镜头为 unknown，不放弃整批。
 */
import { getStoryById } from "../db";
import { parseJsonLoose } from "../_core/llmJson";
import {
  characterReferenceOf,
  normalizeStoryArtDirection,
} from "../../shared/artDirection";
import {
  CONSISTENCY_DIMENSIONS,
  type ConsistencyDimension,
  type ShotConsistencyAnalysis,
  type ShotConsistencyFinding,
  type ShotConsistencyMismatch,
} from "../../shared/shotConsistency";
import { getStoryImageAssets, materializeImageInput } from "./imageAssets";
import { invokeVisionJson, visionChannelConfigured } from "./visionChannel";

const MAX_SHOTS_DEFAULT = 12;
const CONCURRENCY = 2;

const SYSTEM_PROMPT = [
  "你是影视素材一致性质检员。用户会给你两张图：",
  "第一张是这个故事的人物锚点参考图（角色的标准长相、发型、服饰和整体画风）。",
  "第二张是某个镜头当前的画面。",
  "逐项对比第二张图与锚点：五官(face)、发型(hairstyle)、服饰(clothing)、场景(scene)、画风(style)。",
  "判定 verdict：",
  '- "consistent"：人物与画风和锚点一致（场景可以不同，除非画风明显跳掉）。',
  '- "inconsistent"：至少一处明显不一致。',
  '- "unknown"：画面里没有人物或看不清。',
  "空镜头（画面里没有人物）时 face/hairstyle/clothing 不算不一致。",
  "只报有把握的差异，不要编造；note 用简体中文一句话说清差在哪。",
  "严格返回 JSON，不要 markdown，不要解释：",
  '{"verdict":"inconsistent","mismatches":[{"dimension":"hairstyle","note":"锚点是齐肩短发，这张是长卷发"}]}',
].join("\n");

type RawVerdictPayload = {
  verdict?: unknown;
  mismatches?: unknown;
};

function normalizeMismatches(raw: unknown): ShotConsistencyMismatch[] {
  if (!Array.isArray(raw)) return [];
  const dimensions = new Set<string>(CONSISTENCY_DIMENSIONS);
  return raw
    .flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const dimension =
        typeof record.dimension === "string" ? record.dimension.trim() : "";
      if (!dimensions.has(dimension)) return [];
      const note =
        typeof record.note === "string" ? record.note.trim().slice(0, 200) : "";
      return [
        {
          dimension: dimension as ConsistencyDimension,
          note: note || "模型未说明具体差异",
        },
      ];
    })
    .slice(0, 5);
}

function normalizeVerdict(
  raw: unknown,
  mismatches: ShotConsistencyMismatch[]
): ShotConsistencyFinding["verdict"] {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "consistent" || value === "inconsistent" || value === "unknown") {
    // 模型说一致但又列了差异 → 以差异为准，避免绿灯放行脏数据。
    if (value === "consistent" && mismatches.length > 0) return "inconsistent";
    return value;
  }
  return mismatches.length > 0 ? "inconsistent" : "unknown";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

export async function analyzeStoryShotConsistency(params: {
  storyId: number;
  userId: number;
  /** 用户在界面上选定的锚点图；缺省用故事美术方向里的人物锚点 */
  anchorImageUrl?: string | null;
  maxShots?: number;
}): Promise<ShotConsistencyAnalysis> {
  if (!visionChannelConfigured()) {
    return {
      status: "not_configured",
      message:
        "视觉识别通道未配置：在 .env 里加 VISION_302_MODEL（如 gemini-3-pro-preview），API Key 复用现有 API302_KEY。",
    };
  }

  const story = await getStoryById(params.storyId, params.userId);
  if (!story) {
    return { status: "error", message: "故事不存在或无权访问" };
  }

  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const anchorImageUrl =
    params.anchorImageUrl?.trim() ||
    characterReferenceOf(normalizeStoryArtDirection(body.artDirection)) ||
    "";
  if (!anchorImageUrl) {
    return {
      status: "error",
      message: "还没有人物锚点：先在锚点栏选一张人物参考图，再做一致性识别。",
    };
  }

  const assets = await getStoryImageAssets(params.storyId, params.userId);
  const shotImages = assets
    .filter(asset => asset.kind === "story_frame")
    .filter(asset => asset.assignment === "shot")
    .filter(asset => asset.isPrimary)
    .filter(asset => asset.status !== "rejected")
    .filter(asset => asset.availability !== "missing")
    .filter(asset => Boolean(asset.imageUrl))
    .slice(0, params.maxShots ?? MAX_SHOTS_DEFAULT);

  if (shotImages.length === 0) {
    return {
      status: "error",
      message: "这个故事还没有可检查的镜头主图，先生成或选定每个镜头的当前画面。",
    };
  }

  let anchorInput: string;
  try {
    anchorInput = await materializeImageInput(anchorImageUrl);
  } catch (error) {
    return {
      status: "error",
      message: `锚点图读取失败：${error instanceof Error ? error.message : "未知原因"}`,
    };
  }

  let modelLabel = "";
  const findings = await mapWithConcurrency(
    shotImages,
    CONCURRENCY,
    async (asset): Promise<ShotConsistencyFinding> => {
      const shotNo = asset.canonicalShotNo ?? asset.rawShotNo ?? null;
      const base = {
        imageId: asset.id,
        shotNo,
        imageUrl: asset.imageUrl as string,
      };
      try {
        const shotInput = await materializeImageInput(asset.imageUrl as string);
        const { text, modelLabel: label } = await invokeVisionJson({
          system: SYSTEM_PROMPT,
          userText: `第一张是人物锚点参考图，第二张是镜头 ${shotNo ?? "?"} 的当前画面。请按规则对比并返回 JSON。`,
          imageUrls: [anchorInput, shotInput],
        });
        modelLabel = modelLabel || label;
        const parsed = parseJsonLoose<RawVerdictPayload>(text);
        const mismatches = normalizeMismatches(parsed.mismatches);
        return {
          ...base,
          verdict: normalizeVerdict(parsed.verdict, mismatches),
          mismatches,
        };
      } catch (error) {
        // 单镜头失败降级为 unknown，保住整批结果。
        return {
          ...base,
          verdict: "unknown",
          mismatches: [],
          note:
            error instanceof Error
              ? error.message.slice(0, 200)
              : "该镜头分析失败",
        };
      }
    }
  );

  return {
    status: "ok",
    anchorImageUrl,
    modelLabel: modelLabel || "vision",
    findings,
  };
}
