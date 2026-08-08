/**
 * 导演顾问：用户有一堆好看的图片但不知道怎么让它们为故事服务时，
 * 聊聊以专业导演视角逐图判断——这张图能供哪个镜头、为什么（导演理由）、
 * 怎么动起来（运镜/时长/情绪基调/视频提示词）。
 * 采纳后：图片绑定到目标镜头并成为当前首帧（进故事版看板），
 * 视频参数写进镜头字段（videoPrompt/cameraMove/durationMs/rationale），
 * 镜头设计表的「渲染视频」直接按参数可用。
 */
import {
  assignStoryImageToShot as assignStoryImageToShotDb,
  getStoryById,
  promoteStoryImageToCurrent,
} from "../db";
import { canonicalizeShotNo } from "../../shared/imageAsset";
import { parseJsonLoose } from "../_core/llmJson";
import { getStoryMaterialState } from "./storyMaterials";
import { getStoryRevision, prepareStoryBody } from "./storySync";
import {
  persistPreparedStoryBody,
  StoryBodyRevisionConflictError,
} from "./storyBodyPersistence";
import { materializeImageInput } from "./imageAssets";
import { invokeVisionJson, visionChannelConfigured } from "./visionChannel";
import { promptShotCode } from "../../shared/shotIdentity";

export type ImageVideoDirection = {
  videoPrompt: string;
  cameraMove: string;
  durationSec: number;
  motion: "low" | "high";
  emotionalTone: string;
};

export type ImageDirectorAdvice = {
  imageId: number;
  imageUrl: string;
  verdict: "use" | "maybe" | "skip";
  reason: string;
  targetShotNo: number | null;
  targetStableShotId: string | null;
  videoDirection: ImageVideoDirection | null;
  note?: string;
};

export type AdviseImagesResult =
  | { status: "ok"; advices: ImageDirectorAdvice[]; modelLabel: string }
  | { status: "not_configured"; message: string }
  | { status: "error"; message: string };

const MAX_IMAGES_DEFAULT = 6;
const CONCURRENCY = 2;

function buildDirectorPrompt(shotLines: string[]): string {
  return [
    "你是资深短片导演。用户给你一张图片和当前故事的镜头表，",
    "请判断这张图能不能为这个故事服务、怎么服务。",
    "",
    "当前镜头表（序号｜镜头号｜内容｜情绪｜素材状态）：",
    ...shotLines,
    "",
    "从导演视角回答：",
    '- verdict："use"（能明确服务某一镜）/"maybe"（可用但有保留）/"skip"（不建议用，说清为什么）。',
    "- targetEntry：建议服务镜头表里第几条（序号数字）；skip 时为 null。",
    "- reason：导演理由，说人话——这张图给故事带来什么、放这一镜为什么成立",
    "  （画面情绪与镜头情绪的关系、视觉上和前后镜头怎么接）。",
    "- videoDirection：这张图渲染成视频的具体方案：",
    '  {"videoPrompt":"中文，画面怎么动起来+情绪走向，给图生视频模型用",',
    '   "cameraMove":"运镜（如 缓慢推近/横移/手持轻晃/固定）",',
    '   "durationSec":3到10的数字,"motion":"low"或"high",',
    '   "emotionalTone":"一两个词的情绪基调"}；skip 时为 null。',
    "不确定就说不确定，不要为了凑答案硬塞镜头。",
    "严格返回 JSON，不要 markdown：",
    '{"verdict":"use","targetEntry":3,"reason":"...","videoDirection":{...}}',
  ].join("\n");
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

function normalizeDirection(raw: unknown): ImageVideoDirection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const videoPrompt =
    typeof record.videoPrompt === "string" ? record.videoPrompt.trim() : "";
  if (!videoPrompt) return null;
  const durationRaw = Number(record.durationSec);
  return {
    videoPrompt: videoPrompt.slice(0, 800),
    cameraMove:
      typeof record.cameraMove === "string"
        ? record.cameraMove.trim().slice(0, 60)
        : "",
    durationSec: Number.isFinite(durationRaw)
      ? Math.min(10, Math.max(3, Math.round(durationRaw * 10) / 10))
      : 5,
    motion: record.motion === "high" ? "high" : "low",
    emotionalTone:
      typeof record.emotionalTone === "string"
        ? record.emotionalTone.trim().slice(0, 30)
        : "",
  };
}

export async function adviseStoryImages(params: {
  storyId: number;
  userId: number;
  imageIds?: number[];
  maxImages?: number;
}): Promise<AdviseImagesResult> {
  if (!visionChannelConfigured()) {
    return {
      status: "not_configured",
      message:
        "视觉识别通道未配置：在 .env 里加 VISION_302_MODEL，API Key 复用 API302_KEY。",
    };
  }
  const material = await getStoryMaterialState(params.storyId, params.userId);
  if (!material) return { status: "error", message: "故事不存在或无权访问" };

  const wanted = params.imageIds?.length
    ? new Set(params.imageIds)
    : null;
  const candidates = material.unassignedImages
    .filter(image => Boolean(image.imageUrl))
    .filter(image => (wanted ? wanted.has(image.id) : true))
    .slice(0, params.maxImages ?? MAX_IMAGES_DEFAULT);
  if (candidates.length === 0) {
    return {
      status: "error",
      message: "素材仓库里没有待安排的图片：先把图片导入进来（可拖拽），再来问导演。",
    };
  }

  const shots = [...material.shots].sort((a, b) => a.shotNo - b.shotNo);
  const shotLines = shots.map((shot, index) => {
    const parts = [
      `${index + 1}.`,
      promptShotCode(shot),
      shot.currentVideo ? "已有视频" : shot.currentImage ? "已有首帧" : "缺画面",
    ];
    return parts.join("｜");
  });
  // 镜头内容从故事正文取（materialState 不带 subject/dialogue）。
  const story = await getStoryById(params.storyId, params.userId);
  const body =
    story?.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const bodyShots = Array.isArray(body.shots) ? body.shots : [];
  for (const raw of bodyShots) {
    if (!raw || typeof raw !== "object") continue;
    const shot = raw as Record<string, unknown>;
    const canonical = canonicalizeShotNo(
      shot.shotNo as string | number | null | undefined
    );
    const no = canonical ? Number(canonical.slice(2)) : null;
    const index = shots.findIndex(fact => fact.shotNo === no);
    if (index < 0) continue;
    const text = [shot.subject, shot.dialogue || shot.action, shot.emotion]
      .filter(value => typeof value === "string" && value)
      .join("／")
      .slice(0, 60);
    if (text) shotLines[index] = `${shotLines[index]}｜${text}`;
  }

  const systemPrompt = buildDirectorPrompt(shotLines);
  let modelLabel = "";
  const advices = await mapWithConcurrency(
    candidates,
    CONCURRENCY,
    async (image): Promise<ImageDirectorAdvice> => {
      const base = { imageId: image.id, imageUrl: image.imageUrl as string };
      try {
        const input = await materializeImageInput(image.imageUrl as string);
        const { text, modelLabel: label } = await invokeVisionJson({
          system: systemPrompt,
          userText:
            "这张图片是用户的待安排素材。请按规则给出导演判断，严格返回 JSON。",
          imageUrls: [input],
        });
        modelLabel = modelLabel || label;
        const parsed = parseJsonLoose<Record<string, unknown>>(text);
        const verdict =
          parsed.verdict === "use" || parsed.verdict === "skip"
            ? parsed.verdict
            : "maybe";
        const entryRaw = Number(parsed.targetEntry);
        const entry =
          Number.isInteger(entryRaw) && entryRaw >= 1 && entryRaw <= shots.length
            ? entryRaw
            : null;
        const target = entry === null ? null : shots[entry - 1];
        return {
          ...base,
          verdict,
          reason:
            typeof parsed.reason === "string"
              ? parsed.reason.trim().slice(0, 500)
              : "（导演没有给出理由）",
          targetShotNo: target?.shotNo ?? null,
          targetStableShotId: target?.stableShotId ?? null,
          videoDirection:
            verdict === "skip" ? null : normalizeDirection(parsed.videoDirection),
        };
      } catch (error) {
        return {
          ...base,
          verdict: "maybe",
          reason: "这张图分析失败，可以重试。",
          targetShotNo: null,
          targetStableShotId: null,
          videoDirection: null,
          note:
            error instanceof Error ? error.message.slice(0, 160) : "分析失败",
        };
      }
    }
  );

  return { status: "ok", advices, modelLabel: modelLabel || "vision" };
}

export type ApplyAdviceResult =
  | { status: "ok"; shotNo: number }
  | { status: "error"; message: string };

export async function applyImageDirectorAdvice(params: {
  storyId: number;
  userId: number;
  imageId: number;
  targetShotNo: number;
  targetStableShotId: string;
  videoDirection: ImageVideoDirection | null;
  reason?: string;
}): Promise<ApplyAdviceResult> {
  const story = await getStoryById(params.storyId, params.userId);
  if (!story) return { status: "error", message: "故事不存在或无权访问" };

  const assigned = await assignStoryImageToShotDb({
    storyId: params.storyId,
    userId: params.userId,
    imageId: params.imageId,
    shotNo:
      canonicalizeShotNo(params.targetShotNo) ??
      `SH${String(params.targetShotNo).padStart(2, "0")}`,
    shotIdentity: params.targetStableShotId,
    metadata: {
      source: "director_advice",
      targetStableShotId: params.targetStableShotId,
      shotNo: params.targetShotNo,
    },
  });
  if (!assigned) return { status: "error", message: "图片不存在或无权操作" };

  await promoteStoryImageToCurrent({
    userId: params.userId,
    storyId: params.storyId,
    imageId: params.imageId,
    metadata: { source: "director_advice" },
  });

  // 视频参数与导演理由写进镜头：镜头设计表/渲染链路直接消费。
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(body.shots) ? body.shots : [];
  let touched = false;
  const nextShots = shots.map(raw => {
    if (!raw || typeof raw !== "object") return raw;
    const shot = raw as Record<string, unknown>;
    const canonical = canonicalizeShotNo(
      shot.shotNo as string | number | null | undefined
    );
    if (!canonical || Number(canonical.slice(2)) !== params.targetShotNo) {
      return raw;
    }
    touched = true;
    const direction = params.videoDirection;
    return {
      ...shot,
      ...(direction
        ? {
            videoPrompt: direction.videoPrompt,
            cameraMove: direction.cameraMove || shot.cameraMove,
            durationMs: Math.round(direction.durationSec * 1000),
            emotionCharge: direction.emotionalTone || shot.emotionCharge,
          }
        : {}),
      ...(params.reason ? { rationale: params.reason.slice(0, 500) } : {}),
    };
  });
  if (touched) {
    try {
      await persistPreparedStoryBody({
        storyId: params.storyId,
        userId: params.userId,
        expectedRevision: getStoryRevision(story.body),
        body: prepareStoryBody(
        { ...body, shots: nextShots },
        getStoryRevision(story.body) + 1,
        story.body
      ),
      });
    } catch (error) {
      if (error instanceof StoryBodyRevisionConflictError) {
        return { status: "error", message: "镜头已在别处更新，请刷新后重试" };
      }
      throw error;
    }
  }
  return { status: "ok", shotNo: params.targetShotNo };
}
