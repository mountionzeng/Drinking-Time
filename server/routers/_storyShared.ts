import { TRPCError } from "@trpc/server";
import { canonicalizeShotNo } from "@shared/imageAsset";
import { shotIdentityFromShot } from "@shared/shotIdentity";
import { z } from "zod";
import { getStoryById, updateStory } from "../db";
import type { ShotEntry } from "../archive/storyAgent";
import { getStoryImageAssets } from "../services/imageAssets";
import { toPublicImageUrl } from "../services/imageGen";
import { migrateStoryPromptLineage } from "../services/promptLineageMigration";
import { resolveGenerationPromptCompilation } from "../services/promptLineage";
import {
  PromptLineageConflictError,
  PromptLineageOwnershipError,
  PromptLineageValidationError,
} from "../services/promptLineageStore";
import { getStoryRevision, prepareStoryBody } from "../services/storySync";
import {
  normalizeStoryArtDirection,
  type ArtRecipeDNA,
} from "../../shared/artDirection";

type StoryRow = NonNullable<Awaited<ReturnType<typeof getStoryById>>>;

export function storyPromptLineageBody(
  story: Pick<StoryRow, "title" | "theme" | "arc" | "body">
): Record<string, unknown> {
  const body =
    story.body && typeof story.body === "object"
      ? { ...(story.body as Record<string, unknown>) }
      : {};
  return {
    ...body,
    title: story.title,
    theme: story.theme,
    arc: story.arc,
  };
}

export function shotIdentityForStoryShot(
  story: Pick<StoryRow, "body">,
  shotNo: string | number | null | undefined
): string | null {
  const canonical = canonicalizeShotNo(shotNo);
  if (!canonical) return null;
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(body.shots) ? body.shots : [];
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    if (!shot || typeof shot !== "object") continue;
    const obj = shot as Record<string, unknown>;
    if (
      canonicalizeShotNo(obj.shotNo as string | number | null | undefined) ===
      canonical
    ) {
      return shotIdentityFromShot(obj, index);
    }
  }
  return null;
}

export async function resolveStoryImageCompilationId(params: {
  story: Pick<StoryRow, "id" | "title" | "theme" | "arc" | "body">;
  storyId: number;
  userId: number;
  shotIdentity: string | null;
}): Promise<number | null> {
  if (!params.shotIdentity) return null;
  await migrateStoryPromptLineage({
    storyId: params.story.id,
    userId: params.userId,
    body: storyPromptLineageBody(params.story),
  });
  const resolved = await resolveGenerationPromptCompilation({
    storyId: params.storyId,
    userId: params.userId,
    stableShotId: params.shotIdentity,
    modality: "image",
  });
  return resolved.compilationId;
}

export type ConfirmedScriptIntent = {
  purpose: string;
  audience: string;
  platform: string;
  tone?: string | null;
  desiredEffect?: string | null;
  targetRole?: string | null;
  channel?: string | null;
};

function cleanIntentText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildConfirmedIntentLine(
  confirmedIntent: ConfirmedScriptIntent | null | undefined
): string {
  if (!confirmedIntent) return "";

  const desiredEffect = cleanIntentText(confirmedIntent.desiredEffect);
  const targetRole = cleanIntentText(confirmedIntent.targetRole);
  const channel = cleanIntentText(confirmedIntent.channel);
  const jobDetails =
    confirmedIntent.purpose === "linkedin_job_search" && (targetRole || channel)
      ? [
          targetRole ? `目标岗位=${targetRole}` : "",
          channel ? `投放=${channel}` : "",
          `剧本优先服务${targetRole ? "这个岗位的竞争力" : "求职竞争力"}与${channel ? "该平台的时长/正式度" : "招聘者的阅读效率"}`,
        ].filter(Boolean)
      : [];
  const fictionDetails =
    confirmedIntent.purpose === "fiction"
      ? [
          "剧本优先服务虚构短片：把已确认故事卡拆成 3-5 镜",
          "强调世界规则、主角欲望、冲突、视觉风格和余味",
          "不要使用求职、简历、JD、招聘者或个人优势证明话术",
        ]
      : [];

  return `【用户已确认意图】用途=${confirmedIntent.purpose}；给谁看=${confirmedIntent.audience}；平台=${confirmedIntent.platform}；调性=${cleanIntentText(confirmedIntent.tone)}${desiredEffect ? `；想要的效果=${desiredEffect}` : ""}${jobDetails.length ? `；${jobDetails.join("；")}` : ""}${fictionDetails.length ? `；${fictionDetails.join("；")}` : ""}。剧本的叙事方式、节奏、精致度都严格贴合这个意图。`;
}

function mobileShotNo(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = /^(?:SH)?0*(\d+)$/i.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

export async function composeStoryWorkspace(
  story: StoryRow,
  userId: number,
  syncConflict = false
) {
  const revision = getStoryRevision(story.body);
  try {
    const assets = await getStoryImageAssets(story.id, userId);
    const mobileImages = assets
      .filter(asset => asset.kind === "story_frame")
      .filter(asset => asset.assignment === "shot")
      .filter(asset => asset.isPrimary)
      .filter(asset => asset.status !== "rejected")
      .filter(asset => asset.availability !== "missing")
      .filter(asset => asset.imageUrl)
      .filter(image => image.imageUrl)
      .map(image => ({
        id: image.id,
        imageUrl: image.imageUrl,
        prompt: image.prompt || "画面",
        shotNo: mobileShotNo(image.canonicalShotNo ?? image.rawShotNo),
        storyId: image.storyId,
        status: "ready" as const,
      }));
    const body =
      story.body && typeof story.body === "object"
        ? (story.body as Record<string, unknown>)
        : {};
    return {
      ...story,
      revision,
      syncConflict,
      body: mobileImages.length > 0 ? { ...body, mobileImages } : body,
    };
  } catch (err) {
    console.warn(
      "[story workspace] 读取 generatedImages 失败，按正文返回：",
      err
    );
    return { ...story, revision, syncConflict };
  }
}

export function storyArtRecipe(story: {
  body: unknown;
}): ArtRecipeDNA | undefined {
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  return direction.phase === "locked" ? direction.recipe : undefined;
}

export function artRecipeFromStyleHint(
  styleHint: string | null | undefined
): ArtRecipeDNA | undefined {
  const style = Array.from(
    new Set(
      (styleHint ?? "")
        .split(/[,，;；、\n]/)
        .map(part => part.trim())
        .filter(Boolean)
    )
  ).slice(0, 12);
  if (style.length === 0) return undefined;
  return {
    style,
    palette: [],
    light: [],
    composition: [],
    material: [],
    negative: [],
  };
}

export function storyArtReferenceImages(story: { body: unknown }): string[] {
  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  const selected = direction.references
    .filter(
      reference =>
        reference.selected &&
        reference.imageUrl &&
        (reference.purpose === "fact" || reference.purpose === "both")
    )
    .map(reference => reference.imageUrl!);
  const canvas = Array.isArray(body.visualCanvasItems)
    ? body.visualCanvasItems.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const imageUrl =
          typeof record.originalImageUrl === "string"
            ? record.originalImageUrl
            : typeof record.imageUrl === "string"
              ? record.imageUrl
              : "";
        return imageUrl ? [imageUrl] : [];
      })
    : [];
  return Array.from(new Set([...selected, ...canvas])).slice(0, 4);
}

export async function writeCharacterAnchor(
  story: StoryRow,
  userId: number,
  imageUrl: string
) {
  const publicUrl = await toPublicImageUrl(imageUrl);
  if (!publicUrl) {
    return {
      status: "error" as const,
      error: "这张图还不能作为人物锚点：需要可公开访问的图片 URL。",
    };
  }

  const body =
    story.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const direction = normalizeStoryArtDirection(body.artDirection);
  const now = Date.now();
  const nextDirection = {
    ...direction,
    phase:
      direction.phase === "empty" ? ("references" as const) : direction.phase,
    references: [
      ...direction.references.filter(
        reference => reference.role !== "character"
      ),
      {
        id: `character-${now}`,
        label: "人物锚点",
        source: "visual-anchor" as const,
        purpose: "fact" as const,
        selected: true,
        role: "character" as const,
        imageUrl: publicUrl,
      },
    ],
    updatedAt: now,
  };
  const nextBody = prepareStoryBody(
    {
      ...body,
      artDirection: nextDirection,
    },
    getStoryRevision(story.body) + 1,
    story.body
  );

  await updateStory(story.id, userId, { body: nextBody });
  const saved = await getStoryById(story.id, userId);
  return {
    status: "ok" as const,
    publicUrl,
    story: await composeStoryWorkspace(
      saved ?? { ...story, body: nextBody },
      userId
    ),
  };
}

export function artRecipePrompt(recipe: ArtRecipeDNA | undefined): string {
  if (!recipe) return "";
  return [
    recipe.style.length ? `style: ${recipe.style.join(", ")}` : "",
    recipe.palette.length ? `palette: ${recipe.palette.join(", ")}` : "",
    recipe.light.length ? `lighting: ${recipe.light.join(", ")}` : "",
    recipe.composition.length
      ? `composition: ${recipe.composition.join(", ")}`
      : "",
    recipe.material.length ? `materials: ${recipe.material.join(", ")}` : "",
    recipe.negative.length ? `avoid: ${recipe.negative.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function shotStatusFromBeat(beat: string) {
  if (beat === "收束") return "production_ready" as const;
  if (beat === "转折") return "structured" as const;
  return "idea_pool" as const;
}

function shotPriorityFromBeat(beat: string) {
  return beat === "转折" ? ("high" as const) : ("medium" as const);
}

export function storyShotToDbRow(params: {
  projectId: number;
  storyId: number;
  userId: number;
  shot: ShotEntry;
  index: number;
}) {
  const { projectId, storyId, userId, shot, index } = params;
  const shotNo = `SH${String(shot.shotNo || index + 1).padStart(2, "0")}`;
  const sceneNo =
    shot.sceneNo?.trim() ||
    `SC${String(Math.ceil((index + 1) / 6)).padStart(2, "0")}`;
  const filledFields = [
    shot.sceneTitle,
    shot.sceneArtBrief,
    shot.subject,
    shot.action,
    shot.dialogue,
    shot.shotType,
    shot.location,
    shot.timeLight,
    shot.mood,
    shot.styleRef,
    shot.promptDraft,
  ].filter(
    value => typeof value === "string" && value.trim().length > 0
  ).length;

  return {
    projectId,
    storyId,
    userId,
    sceneNo,
    shotNo,
    sourceSummary: [shot.sceneTitle, shot.beat, shot.sourceCardContent || shot.subject]
      .filter(Boolean)
      .join(" · "),
    intentType: "director_note" as const,
    status: shotStatusFromBeat(shot.beat),
    readinessScore: Math.min(0.95, 0.35 + filledFields * 0.055),
    priority: shotPriorityFromBeat(shot.beat),
    autoRender: false,
    blockingIssues: null,
    nextAction: shot.note || null,
    sceneType: shot.sceneTitle || shot.location || shot.beat || null,
    timeOfDay: shot.timeLight || null,
    weather: null,
    lighting: shot.timeLight || null,
    cameraFocalLength: shot.shotType || null,
    cameraMovement: shot.cameraMove || null,
    spatialLayers: shot.cameraAngle || null,
    mood:
      [shot.mood, shot.emotion, shot.emotionDelta]
        .filter(Boolean)
        .join(" / ") || null,
    colorPalette:
      [shot.sceneArtBrief, shot.styleRef, shot.visualAnchorText]
        .filter(Boolean)
        .join(" / ") ||
      null,
    promptDraft:
      shot.promptDraft ||
      [
        shot.subject,
        shot.action,
        shot.sceneTitle ? `场次：${shot.sceneTitle}` : "",
        shot.sceneArtBrief ? `场景美术库：${shot.sceneArtBrief}` : "",
        shot.location ? `场景：${shot.location}` : "",
        shot.mood ? `情绪：${shot.mood}` : "",
      ]
        .filter(Boolean)
        .join("，"),
    negativePrompt: shot.negativePrompt || "",
  };
}

export async function ensureStoryPromptLineage(
  storyId: number,
  userId: number
) {
  const story = await getStoryById(storyId, userId);
  if (!story) {
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  }
  await migrateStoryPromptLineage({
    storyId,
    userId,
    body: storyPromptLineageBody(story),
  });
}

export function throwPromptLineageError(error: unknown): never {
  if (error instanceof PromptLineageConflictError) {
    throw new TRPCError({
      code: "CONFLICT",
      message: error.message,
      cause: { currentVersion: error.currentVersion },
    });
  }
  if (
    error instanceof PromptLineageValidationError ||
    error instanceof PromptLineageOwnershipError
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
    });
  }
  throw error;
}

const selectionRegionSchema = z.union([
  z
    .object({
      kind: z.literal("text"),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .refine(value => value.end >= value.start, {
      message: "文字选区结束位置不能早于开始位置",
    }),
  z
    .object({
      kind: z.literal("rect"),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .refine(value => value.x + value.width <= 1, {
      message: "图片选区不能超出画面宽度",
    })
    .refine(value => value.y + value.height <= 1, {
      message: "图片选区不能超出画面高度",
    }),
  z
    .object({
      kind: z.literal("time"),
      startSec: z.number().nonnegative(),
      endSec: z.number().positive(),
    })
    .refine(value => value.endSec > value.startSec, {
      message: "视频选区结束时间必须晚于开始时间",
    }),
]);

const selectionMaterialStatusSchema = z.enum([
  "current-image",
  "candidate-image",
  "current-video",
  "failed-video",
  "unadopted-video",
  "stale-video",
  "timeline-range",
  "timeline-material",
  "derivation-draft",
  "fallback-image",
  "unknown",
]);

export const selectionContextSchema = z.object({
  sourceType: z.enum([
    "card",
    "script-scene",
    "script-meta",
    "shot",
    "storyboard-image",
    "animatic-video",
    "timeline-range",
    "chat",
  ]),
  sourceId: z.string().trim().min(1),
  selectedText: z.string().trim().min(1),
  fullText: z.string(),
  objectVersion: z.string().nullable().optional(),
  selection: selectionRegionSchema.nullable().optional(),
  materialStatus: selectionMaterialStatusSchema.optional(),
  storyId: z.number().int().positive().nullable().optional(),
  stableShotId: z.string().nullable().optional(),
  shotNo: z.number().int().positive().nullable().optional(),
  imageId: z.number().int().positive().nullable().optional(),
  videoTakeId: z.number().int().positive().nullable().optional(),
  rangeId: z.number().int().positive().nullable().optional(),
});
