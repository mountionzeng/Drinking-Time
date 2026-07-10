import path from "node:path";
import { z } from "zod";
import { IMAGE_PROVIDER_VALUES } from "@shared/imageProvider";
import { canonicalizeShotNo } from "@shared/imageAsset";
import {
  VIDEO_CONFORM_MODES,
  VIDEO_TARGET_ASPECT_RATIOS,
} from "@shared/videoConform";
import {
  normalizeShotIdentity,
  shotIdentityFromShot,
} from "@shared/shotIdentity";
import { protectedProcedure, router } from "../_core/trpc";
import {
  assignStoryImageToShot as assignStoryImageToShotDb,
  createVideoTake,
  getProjectById,
  replaceDirectorShotsForStory,
  getStoryById,
  createGeneratedImage,
  getGeneratedImageById,
  createImageSignal,
  promoteStoryImageToCurrent,
  reassignImage,
  updateStoryTimeline as persistStoryTimeline,
  updateVideoTake,
} from "../db";
import { synthesizeShotList } from "../archive/storyAgent";
import {
  replyFromCreationAgent,
  generateNextImage,
  type CreateCharacterFromPhotoToolCall,
  type SetCharacterAnchorToolCall,
  type ShotContext,
} from "../services/creationAgent";
import {
  CREATION_GOALS,
  goalGuidance,
  detectGoalFromText,
} from "../services/creationGoal";
import { segmentAtPoint } from "../services/segmentation";
import {
  editImage as editMobileImage,
  inpaintImage,
  storeImageBytes,
} from "../services/imageGen";
import { localVideoDir, storeVideoBytesForTake } from "../services/videoMedia";
import { renderViaGate } from "../services/renderGate";
import {
  getProjectImageAssets,
  getStoryImageAssets,
} from "../services/imageAssets";
import {
  analyzeDerivationDraft,
  confirmDerivedShot,
  createDerivationDraft,
  generateDerivedCandidates,
  undoDerivedShot,
} from "../services/shotDerivation";
import {
  refreshVideoTakeStatus,
  startShotVideoJob,
} from "../services/videoJobs";
import { getShotVideoProviderStatus } from "../services/videoGen";
import {
  conformVideoTake,
  probeVideoFileMetadata,
} from "../services/videoConform";
import {
  clearVideoTimelineSegment,
  createUsableVideoRange,
  selectVideoTimelineSegment,
  adoptVideoTake,
  markVideoTakeUnusable,
  moveVideoTakeToShot,
  reuseVideoTakeForShot,
} from "../services/videoTimeline";
import { defaultArtRecipe } from "../../shared/artDirection";
import {
  artRecipePrompt,
  resolveStoryImageCompilationId,
  shotIdentityForStoryShot,
  storyArtRecipe,
  storyArtReferenceImages,
  storyShotToDbRow,
  writeCharacterAnchor,
} from "./_storyShared";

type StoryShotTarget = {
  shotNo: string;
  stableShotId: string;
  durationSec: number;
};

function decodeBase64File(value: string): Buffer {
  const payload = value.includes(",") ? (value.split(",").pop() ?? "") : value;
  return Buffer.from(payload, "base64");
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index]!);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

function isImportImageMime(mimeType: string): boolean {
  return ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(
    mimeType.toLowerCase()
  );
}

function isImportVideoMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith("video/") || normalized === "application/octet-stream"
  );
}

function storyShotTargets(
  story: Awaited<ReturnType<typeof getStoryById>>
): StoryShotTarget[] {
  const body =
    story?.body && typeof story.body === "object"
      ? (story.body as Record<string, unknown>)
      : {};
  const shots = Array.isArray(body.shots) ? body.shots : [];
  return shots.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const shot = raw as Record<string, unknown>;
    const shotNo =
      canonicalizeShotNo(
        (shot.shotNo ?? index + 1) as string | number | null | undefined
      ) ?? `SH${String(index + 1).padStart(2, "0")}`;
    const stableShotId =
      normalizeShotIdentity(shot.stableShotId) ??
      normalizeShotIdentity(shot.shotIdentity) ??
      shotIdentityFromShot(shot, index) ??
      `legacy-${shotNo}`;
    const rawDurationMs =
      typeof shot.durationMs === "number" && Number.isFinite(shot.durationMs)
        ? shot.durationMs
        : null;
    const rawDurationSec =
      typeof shot.durationSec === "number" && Number.isFinite(shot.durationSec)
        ? shot.durationSec
        : null;
    return [
      {
        shotNo,
        stableShotId,
        durationSec: Math.max(
          0.1,
          rawDurationMs ? rawDurationMs / 1000 : (rawDurationSec ?? 3)
        ),
      },
    ];
  });
}

function resolveStoryShotTarget(
  story: Awaited<ReturnType<typeof getStoryById>>,
  targetStableShotId?: string | null
): StoryShotTarget | null {
  const targets = storyShotTargets(story);
  if (targets.length === 0) return null;
  const normalizedTarget = normalizeShotIdentity(targetStableShotId);
  if (!normalizedTarget) return targets[0];
  return (
    targets.find(target => target.stableShotId === normalizedTarget) ?? null
  );
}

export const creationAgentRouter = router({
  shotVideoProviderStatus: protectedProcedure.query(() =>
    getShotVideoProviderStatus()
  ),

  /** Conversational chat with the creation agent */
  chat: protectedProcedure
    .input(
      z.object({
        message: z.string().min(1),
        projectId: z.number(),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .optional(),
        cards: z
          .array(
            z.object({
              content: z.string(),
              emotion: z.string().optional(),
            })
          )
          .optional(),
        currentScript: z.string().optional(),
        shots: z
          .array(
            z.object({
              shotNo: z.string(),
              subject: z.string(),
              action: z.string(),
              dialogue: z.string(),
              shotType: z.string(),
              mood: z.string(),
              promptDraft: z.string().optional(),
            })
          )
          .optional(),
        currentFocusShotNo: z.string().optional(),
        imageProvider: z.enum(IMAGE_PROVIDER_VALUES).optional(),
        goal: z.enum(CREATION_GOALS).optional(),
        storyId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 故事来源改为传入的当前故事（U3），getStoryById 带 userId 验归属。
      // assets：图片资产层（codex 合并）按 projectId 取，与镜头(storyId)正交。
      const [story, assets] = await Promise.all([
        input.storyId
          ? getStoryById(input.storyId, ctx.user.id)
          : Promise.resolve(null),
        // 图片按当前故事独立：有 storyId 取该故事的图，无则空（故事间不共享）
        input.storyId
          ? getStoryImageAssets(input.storyId, ctx.user.id)
          : Promise.resolve([]),
      ]);
      // 自动识别意图：用户没手动选目标时，从这句话+最近用户消息自动认出求职/社媒/记录。
      const effectiveGoal =
        input.goal && input.goal !== "unset"
          ? input.goal
          : detectGoalFromText(
              [
                input.message,
                ...(input.history ?? [])
                  .filter(t => t.role === "user")
                  .slice(-4)
                  .map(t => t.content ?? ""),
              ].join("\n")
            );
      const result = await replyFromCreationAgent({
        message: input.message,
        projectId: input.projectId,
        history: input.history,
        cards: input.cards,
        currentScript: input.currentScript,
        shots: input.shots as ShotContext[] | undefined,
        currentFocusShotNo: input.currentFocusShotNo,
        imageProvider: input.imageProvider,
        goal: effectiveGoal,
        storyId: story?.id ?? null,
        userId: ctx.user.id,
        assets,
        artDirection: story ? storyArtRecipe(story) : undefined,
        referenceImages: story ? storyArtReferenceImages(story) : undefined,
        story,
      });

      let characterAnchorChanged = false;
      const anchorCall = result.toolCalls.find(
        (toolCall): toolCall is SetCharacterAnchorToolCall =>
          toolCall.tool === "setCharacterAnchor"
      );
      if (anchorCall) {
        const anchorUrl =
          typeof anchorCall.imageUrl === "string" && anchorCall.imageUrl.trim()
            ? anchorCall.imageUrl.trim()
            : typeof anchorCall.imageId === "number"
              ? assets.find(
                  asset =>
                    asset.id === anchorCall.imageId &&
                    asset.kind === "story_frame" &&
                    asset.availability !== "missing"
                )?.imageUrl
              : undefined;
        if (!story) {
          result.reply = [
            result.reply,
            "还没有可写入锚点的故事，先保存故事后我再设人物锚点。",
          ]
            .filter(Boolean)
            .join("\n\n");
        } else if (!anchorUrl) {
          result.reply = [
            result.reply,
            "我没有找到这张可用图片，暂时不能设为人物锚点。",
          ]
            .filter(Boolean)
            .join("\n\n");
        } else {
          const anchorResult = await writeCharacterAnchor(
            story,
            ctx.user.id,
            anchorUrl
          );
          if (anchorResult.status === "ok") {
            characterAnchorChanged = true;
            result.reply = [
              result.reply,
              "已把这张图设为人物锚点，后续人物镜头会优先按这张脸和整体画风延续。",
            ]
              .filter(Boolean)
              .join("\n\n");
          } else {
            result.reply = [result.reply, anchorResult.error]
              .filter(Boolean)
              .join("\n\n");
          }
        }
      }
      const photoCall = result.toolCalls.find(
        (toolCall): toolCall is CreateCharacterFromPhotoToolCall =>
          toolCall.tool === "createCharacterFromPhoto"
      );
      if (photoCall) {
        if (!story) {
          result.reply = [
            result.reply,
            "还没有可写入锚点的故事，先保存故事后我再把照片重绘成锚点。",
          ]
            .filter(Boolean)
            .join("\n\n");
        } else if (!photoCall.photoUrl?.trim()) {
          result.reply = [
            result.reply,
            "我没有拿到可用照片，暂时不能创建人物锚点。",
          ]
            .filter(Boolean)
            .join("\n\n");
        } else {
          const recipePrompt = artRecipePrompt(
            storyArtRecipe(story) ?? defaultArtRecipe()
          );
          const stylized = await editMobileImage(
            photoCall.photoUrl.trim(),
            [
              "Stylize the provided person photo into this story's visual style.",
              "Preserve the person's recognizable face, hairstyle, clothing color, clothing material, and overall identity.",
              "Create a clean character reference portrait suitable for future story frames.",
              recipePrompt,
            ]
              .filter(Boolean)
              .join(" "),
            {
              provider: input.imageProvider,
              requireInputImage: true,
            }
          );
          if (stylized.status !== "ok" || !stylized.imageUrl) {
            result.reply = [
              result.reply,
              `这次没能基于照片重绘人物锚点：${stylized.message ?? "图片服务没有返回结果"}。我不会把无关文生图或原始照片设为锚点。`,
            ]
              .filter(Boolean)
              .join("\n\n");
          } else {
            const anchorResult = await writeCharacterAnchor(
              story,
              ctx.user.id,
              stylized.imageUrl
            );
            if (anchorResult.status === "ok") {
              characterAnchorChanged = true;
              result.reply = [
                result.reply,
                "已把照片重绘成风格化人物图，并设为人物锚点；后续人物镜头会按这张锚点延续。",
              ]
                .filter(Boolean)
                .join("\n\n");
            } else {
              result.reply = [result.reply, anchorResult.error]
                .filter(Boolean)
                .join("\n\n");
            }
          }
        }
      }

      // buildShotList：小酌请求铺整张镜头表 → 用现成 synthesizeShotList 合成、
      // 按 goal 注入求职等目标、写到当前故事（按 storyId 归属，story 已验归属）。
      let builtShotCount = 0;
      if (result.shotBuild && story && input.storyId) {
        const resonanceContext = goalGuidance(effectiveGoal) || undefined;
        const synth = await synthesizeShotList({
          cards: [{ content: result.shotBuild.storyDigest }],
          ...(resonanceContext ? { resonanceContext } : {}),
        });
        if (!("error" in synth)) {
          await replaceDirectorShotsForStory(
            input.storyId,
            ctx.user.id,
            synth.shots.map((shot, index) =>
              storyShotToDbRow({
                projectId: input.projectId,
                storyId: input.storyId!,
                userId: ctx.user.id,
                shot,
                index,
              })
            )
          );
          builtShotCount = synth.shots.length;
        }
      }

      return { ...result, builtShotCount, characterAnchorChanged };
    }),

  /** Unified project image assets, including history and selection state. */
  getProjectAssets: protectedProcedure
    // 图片按当前故事独立（故事为唯一单位）：显示层用 storyId 取，故事间不共享图片。
    .input(z.object({ storyId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getStoryImageAssets(input.storyId, ctx.user.id);
    }),

  /** Confirm or restore an image as the selected primary for its shot. */
  selectImage: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        imageId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId, ctx.user.id);
      if (!project)
        return {
          success: false as const,
          reason: "project_not_found" as const,
        };
      const assets = await getProjectImageAssets(input.projectId, ctx.user.id);
      const asset = assets.find(candidate => candidate.id === input.imageId);
      if (
        !asset ||
        asset.kind !== "story_frame" ||
        asset.availability === "missing"
      ) {
        return {
          success: false as const,
          reason: "image_not_found" as const,
        };
      }
      // 故事为唯一单位后弃用 getLatestStoryForProject：图片信号的 storyId 取该资产自身归属
      if (asset.storyId == null) {
        return {
          success: false as const,
          reason: "image_not_found" as const,
        };
      }
      const promoted = await promoteStoryImageToCurrent({
        userId: ctx.user.id,
        storyId: asset.storyId,
        imageId: asset.id,
        metadata: {
          source: "creation",
          projectId: input.projectId,
          shotNo: asset.canonicalShotNo,
        },
      });
      return promoted
        ? { success: true as const }
        : { success: false as const, reason: "image_not_found" as const };
    }),

  /**
   * 把前端从四宫格候选图里裁出的单张画面，提升为该镜头的正式首帧。
   * 裁切发生在浏览器 canvas；后端只负责鉴权、稳定存图、入库并标记为主图。
   */
  promoteFrameCrop: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        shotNo: z.number(),
        imageBase64: z.string().min(1),
        mimeType: z
          .enum(["image/png", "image/jpeg", "image/webp"])
          .default("image/png"),
        parentImageId: z.number().optional(),
        quadrant: z
          .enum(["top-left", "top-right", "bottom-left", "bottom-right"])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return { status: "error" as const, error: "故事不存在或无权操作" };
      }

      if (input.parentImageId != null) {
        const parent = await getGeneratedImageById(input.parentImageId);
        if (
          !parent ||
          parent.storyId !== input.storyId ||
          (parent.userId != null && parent.userId !== ctx.user.id)
        ) {
          return { status: "error" as const, error: "原图不存在或无权操作" };
        }
      }

      const buffer = Buffer.from(input.imageBase64, "base64");
      if (buffer.byteLength === 0) {
        return { status: "error" as const, error: "裁切图片为空" };
      }
      if (buffer.byteLength > 12 * 1024 * 1024) {
        return {
          status: "error" as const,
          error: "裁切图片过大，请先压缩或重渲单张首帧",
        };
      }

      const stored = await storeImageBytes(buffer, input.mimeType);
      if (stored.status !== "ok" || !stored.imageUrl) {
        return {
          status: "error" as const,
          error: stored.message ?? "首帧保存失败",
        };
      }

      const shotNo = canonicalizeShotNo(input.shotNo);
      const shotIdentity = shotIdentityForStoryShot(story, input.shotNo);
      const image = await createGeneratedImage({
        projectId: story.projectId ?? null,
        storyId: input.storyId,
        userId: ctx.user.id,
        shotNo,
        shotIdentity,
        imageKey: stored.imageKey ?? null,
        imageUrl: stored.imageUrl,
        prompt: `从四宫格候选图裁出单张首帧${input.quadrant ? `（${input.quadrant}）` : ""}`,
        parentImageId: input.parentImageId ?? null,
        generationType: "initial",
        isCurrent: false,
      });

      const promoted = await promoteStoryImageToCurrent({
        userId: ctx.user.id,
        storyId: input.storyId,
        imageId: image.id,
        metadata: {
          source: "frame_crop",
          projectId: story.projectId,
          shotNo,
          shotIdentity,
          parentImageId: input.parentImageId ?? null,
          quadrant: input.quadrant ?? null,
        },
      });
      if (!promoted) {
        return {
          status: "error" as const,
          error: "候选首帧保存成功，但设为当前主图失败",
        };
      }

      return {
        status: "ok" as const,
        imageId: image.id,
        imageUrl: image.imageUrl,
        imageKey: image.imageKey,
        image: {
          id: image.id,
          projectId: image.projectId,
          storyId: image.storyId,
          userId: image.userId,
          shotNo,
          shotIdentity,
          imageKey: image.imageKey,
          imageUrl: image.imageUrl,
          prompt: image.prompt,
          parentImageId: image.parentImageId,
          isCurrent: true,
          isPrimary: true,
          selectionSource: "explicit" as const,
          status: "selected" as const,
          generationType: image.generationType,
          maskKey: image.maskKey,
          createdAt: image.createdAt,
        },
      };
    }),

  promoteStoryImage: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        imageId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const promoted = await promoteStoryImageToCurrent({
        storyId: input.storyId,
        userId: ctx.user.id,
        imageId: input.imageId,
        metadata: { source: "material_drawer" },
      });
      if (!promoted) {
        return { status: "error" as const, error: "图片不存在或无权操作" };
      }
      return { status: "ok" as const, imageId: promoted.image.id };
    }),

  assignStoryImageToShot: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        imageId: z.number().int().positive(),
        targetStableShotId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return { status: "error" as const, error: "故事不存在或无权操作" };
      }
      const target = resolveStoryShotTarget(story, input.targetStableShotId);
      if (!target) {
        return { status: "error" as const, error: "目标镜头不存在" };
      }
      const assigned = await assignStoryImageToShotDb({
        storyId: input.storyId,
        userId: ctx.user.id,
        imageId: input.imageId,
        shotNo: target.shotNo,
        shotIdentity: target.stableShotId,
        metadata: {
          source: "material_warehouse",
          targetStableShotId: target.stableShotId,
          shotNo: target.shotNo,
        },
      });
      if (!assigned) {
        return { status: "error" as const, error: "图片不存在或无权操作" };
      }
      return {
        status: "ok" as const,
        imageId: assigned.image.id,
        shotNo: target.shotNo,
        stableShotId: target.stableShotId,
      };
    }),

  importStoryMaterial: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        fileName: z.string().min(1).max(300),
        mimeType: z.string().min(1).max(120),
        fileBase64: z.string().min(1),
        targetStableShotId: z.string().min(1).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return { status: "error" as const, error: "故事不存在或无权操作" };
      }
      const bytes = decodeBase64File(input.fileBase64);
      if (bytes.byteLength === 0) {
        return { status: "error" as const, error: "文件为空" };
      }
      if (isImportImageMime(input.mimeType)) {
        if (bytes.byteLength > 30 * 1024 * 1024) {
          return { status: "error" as const, error: "图片超过 30MB" };
        }
        const stored = await storeImageBytes(bytes, input.mimeType);
        if (stored.status !== "ok" || !stored.imageUrl) {
          return {
            status: "error" as const,
            error: stored.message ?? "图片保存失败",
          };
        }
        const image = await createGeneratedImage({
          projectId: story.projectId ?? null,
          storyId: input.storyId,
          userId: ctx.user.id,
          shotNo: null,
          shotIdentity: null,
          imageKey: stored.imageKey ?? null,
          imageUrl: stored.imageUrl,
          prompt: `导入素材：${input.fileName}`,
          promptCompilationId: null,
          parentImageId: null,
          isCurrent: false,
          generationType: "initial",
          maskKey: null,
        });
        return {
          status: "ok" as const,
          kind: "image" as const,
          imageId: image.id,
          imageUrl: image.imageUrl,
        };
      }

      if (isImportVideoMime(input.mimeType)) {
        if (bytes.byteLength > 200 * 1024 * 1024) {
          return { status: "error" as const, error: "视频超过 200MB" };
        }
        const target = resolveStoryShotTarget(
          story,
          input.targetStableShotId ?? null
        );
        if (!target) {
          return { status: "error" as const, error: "导入视频前需要先有镜头" };
        }
        const take = await createVideoTake({
          storyId: input.storyId,
          userId: ctx.user.id,
          stableShotId: target.stableShotId,
          sourceImageId: null,
          promptCompilationId: null,
          status: "processing",
          taskId: null,
          provider: "manual",
          model: "local-import",
          prompt: `导入素材：${input.fileName}`,
          subtitle: null,
          durationSec: target.durationSec,
          aspectRatio: "16:9",
          videoKey: null,
          videoUrl: null,
          errorMessage: null,
          parameterSnapshot: {
            source: "material_warehouse",
            fileName: input.fileName,
            mimeType: input.mimeType,
            importedAt: new Date().toISOString(),
          },
          idempotencyKey: null,
          extractionCapability: "available",
        });
        const stored = storeVideoBytesForTake(bytes, take.id, input.mimeType);
        const metadata = await probeVideoFileMetadata(
          path.join(localVideoDir(), stored.videoKey)
        ).catch(() => null);
        const updated = await updateVideoTake(take.id, ctx.user.id, {
          status: "available",
          videoKey: stored.videoKey,
          videoUrl: stored.videoUrl,
          aspectRatio: metadata?.aspectRatio ?? "16:9",
          errorMessage: null,
          parameterSnapshot: {
            source: "material_warehouse",
            fileName: input.fileName,
            mimeType: input.mimeType,
            importedAt: new Date().toISOString(),
            sourceWidth: metadata?.width ?? null,
            sourceHeight: metadata?.height ?? null,
            sourceDurationSec: metadata?.durationSec ?? null,
          },
        });
        return {
          status: "ok" as const,
          kind: "video" as const,
          takeId: take.id,
          videoUrl: stored.videoUrl,
          stableShotId: target.stableShotId,
          plannedDurationSec: updated?.durationSec ?? target.durationSec,
        };
      }

      return {
        status: "error" as const,
        error: "暂时只支持 JPG、PNG、WEBP、MP4、WEBM、MOV",
      };
    }),

  /**
   * 单镜头图生视频：只吃已经确认的首帧图 + 镜头设计表编译出来的视频包。
   * 不在视频里烧字幕；subtitle 只作为模型语义提示和后续合成层输入。
   */
  generateShotVideo: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        shotNo: z.number(),
        stableShotId: z.string().optional(),
        promptCompilationId: z.number().int().positive().nullable().optional(),
        imageId: z.number(),
        previousReferenceImageId: z.number().optional(),
        nextReferenceImageId: z.number().optional(),
        prompt: z.string().min(1),
        subtitle: z.string().optional(),
        durationSec: z.number().min(3).max(10).optional(),
        motion: z.enum(["low", "high"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await startShotVideoJob(
        {
          storyId: input.storyId,
          shotNo: input.shotNo,
          stableShotId: input.stableShotId ?? null,
          promptCompilationId: input.promptCompilationId ?? null,
          imageId: input.imageId,
          previousReferenceImageId: input.previousReferenceImageId,
          nextReferenceImageId: input.nextReferenceImageId,
          prompt: input.prompt,
          subtitle: input.subtitle,
          durationSec: input.durationSec ?? 5,
          aspectRatio: "16:9",
          motion: input.motion,
        },
        ctx.user.id
      );

      if (result.status !== "ok") {
        return {
          status: "error" as const,
          error: result.error,
          take: result.take ?? null,
          takeId: result.take?.id,
          taskId: result.take?.taskId ?? undefined,
        };
      }

      return {
        status: "ok" as const,
        take: result.take,
        takeId: result.take.id,
        videoStatus: result.take.status,
        videoUrl: result.take.videoUrl ?? undefined,
        taskId: result.take.taskId ?? undefined,
        prompt: result.take.prompt,
      };
    }),

  conformVideoTakes: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        takeIds: z.array(z.number().int().positive()).min(1).max(50),
        targetAspectRatio: z.enum(VIDEO_TARGET_ASPECT_RATIOS),
        mode: z.enum(VIDEO_CONFORM_MODES),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const takeIds = Array.from(new Set(input.takeIds));
      const results = await mapWithConcurrency(takeIds, 2, sourceTakeId =>
        conformVideoTake(
          {
            storyId: input.storyId,
            sourceTakeId,
            targetAspectRatio: input.targetAspectRatio,
            mode: input.mode,
          },
          ctx.user.id
        )
      );
      const completed = results.filter(result => result.status === "ok");
      const failed = results.filter(result => result.status === "error");
      return {
        status:
          failed.length === 0
            ? ("ok" as const)
            : completed.length === 0
              ? ("error" as const)
              : ("partial" as const),
        completedCount: completed.length,
        failedCount: failed.length,
        results,
      };
    }),

  adoptVideoTake: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1),
        takeId: z.number(),
        plannedDurationSec: z.number().min(0.1).max(30),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await adoptVideoTake(input, ctx.user.id);
        return { status: "ok" as const, ...result };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "视频采用失败",
        };
      }
    }),

  reuseVideoTake: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        sourceTakeId: z.number().int().positive(),
        targetStableShotId: z.string().min(1),
        plannedDurationSec: z.number().min(0.1).max(30),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await reuseVideoTakeForShot(input, ctx.user.id);
        return { status: "ok" as const, ...result };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "视频 Take 复用失败",
        };
      }
    }),

  moveVideoTake: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        takeId: z.number().int().positive(),
        targetStableShotId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await moveVideoTakeToShot(input, ctx.user.id);
        return { status: "ok" as const, ...result };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "视频 Take 移动失败",
        };
      }
    }),

  updateStoryTimeline: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        expectedVersion: z.number().int().min(0),
        items: z.array(
          z.object({
            stableShotId: z.string().min(1),
            included: z.boolean(),
            position: z.number().int().min(0),
            plannedDurationMs: z.number().min(100),
            transform: z.object({
              cropX: z.number().min(0).max(1),
              cropY: z.number().min(0).max(1),
              cropWidth: z.number().min(0.01).max(1),
              cropHeight: z.number().min(0.01).max(1),
              zoom: z.number().min(1).max(8),
              panX: z.number().min(-1).max(1),
              panY: z.number().min(-1).max(1),
            }),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return { status: "error" as const, error: "故事不存在或无权操作" };
      }
      try {
        const timeline = await persistStoryTimeline({
          storyId: input.storyId,
          userId: ctx.user.id,
          expectedVersion: input.expectedVersion,
          items: [...input.items]
            .sort((left, right) => left.position - right.position)
            .map((item, position) => ({ ...item, position })),
        });
        return { status: "ok" as const, timeline };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "时间轴保存失败",
        };
      }
    }),

  createDerivationDraft: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        sourceStableShotId: z.string().min(1),
        sourceTakeId: z.number(),
        sourceTimeSec: z.number().min(0),
        crop: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0.01).max(1),
          height: z.number().min(0.01).max(1),
        }),
        fullFrameBase64: z.string().min(1),
        cropBase64: z.string().min(1),
        mimeType: z
          .enum(["image/png", "image/jpeg", "image/webp"])
          .default("image/png"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const draft = await createDerivationDraft(input, ctx.user.id);
        return { status: "ok" as const, draft };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "派生草稿保存失败",
        };
      }
    }),

  analyzeDerivationDraft: protectedProcedure
    .input(
      z.object({
        draftId: z.number(),
        instruction: z.string().optional(),
        referenceRole: z
          .enum(["person", "scene", "object", "composition"])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const draft = await analyzeDerivationDraft(input, ctx.user.id);
        return { status: "ok" as const, draft };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "派生分析失败",
        };
      }
    }),

  generateDerivedCandidates: protectedProcedure
    .input(z.object({ draftId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const images = await generateDerivedCandidates(
          input.draftId,
          ctx.user.id
        );
        return {
          status: "ok" as const,
          images: images.map(image => ({
            id: image.id,
            imageUrl: image.imageUrl,
          })),
        };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "派生候选生成失败",
        };
      }
    }),

  confirmDerivedShot: protectedProcedure
    .input(
      z.object({
        draftId: z.number(),
        selectedImageId: z.number(),
        expectedStoryRevision: z.number().int().min(0),
        expectedTimelineVersion: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await confirmDerivedShot(input, ctx.user.id);
        return {
          status: "ok" as const,
          operationId: result.operation.id,
        };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "派生镜头确认失败",
        };
      }
    }),

  undoStoryOperation: protectedProcedure
    .input(z.object({ operationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await undoDerivedShot(input.operationId, ctx.user.id);
        return { status: "ok" as const };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "撤销失败",
        };
      }
    }),

  refreshShotVideoStatus: protectedProcedure
    .input(
      z.object({
        takeId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await refreshVideoTakeStatus(input.takeId, ctx.user.id);
      if (result.status !== "ok") {
        return { status: "error" as const, error: result.error };
      }
      return {
        status: "ok" as const,
        take: result.take,
        takeId: result.take.id,
        videoStatus: result.take.status,
        videoUrl: result.take.videoUrl ?? undefined,
        taskId: result.take.taskId ?? undefined,
        prompt: result.take.prompt,
      };
    }),

  markVideoTakeUnusable: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        takeId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await markVideoTakeUnusable(input, ctx.user.id);
        return { status: "ok" as const, ...result };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "视频 Take 标记失败",
        };
      }
    }),

  createVideoTakeRange: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1),
        takeId: z.number(),
        startSec: z.number().min(0),
        endSec: z.number().min(0),
        label: z.string().optional(),
        useOnTimeline: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await createUsableVideoRange(
          {
            storyId: input.storyId,
            stableShotId: input.stableShotId,
            takeId: input.takeId,
            startSec: input.startSec,
            endSec: input.endSec,
            label: input.label,
            useOnTimeline: input.useOnTimeline,
          },
          ctx.user.id
        );
        return {
          status: "ok" as const,
          range: result.range,
          selection: result.selection,
        };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "片段保存失败",
        };
      }
    }),

  selectVideoTimelineSegment: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1),
        takeId: z.number(),
        rangeId: z.number().nullable().optional(),
        selectionType: z.enum(["full_take", "range"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const selection = await selectVideoTimelineSegment(
          {
            storyId: input.storyId,
            stableShotId: input.stableShotId,
            takeId: input.takeId,
            rangeId: input.rangeId ?? null,
            selectionType: input.selectionType,
          },
          ctx.user.id
        );
        return { status: "ok" as const, selection };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "时间轴选择保存失败",
        };
      }
    }),

  clearVideoTimelineSegment: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await clearVideoTimelineSegment(
          {
            storyId: input.storyId,
            stableShotId: input.stableShotId,
          },
          ctx.user.id
        );
        return { status: "ok" as const };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "时间轴选择清除失败",
        };
      }
    }),

  /**
   * 确定性单图出图：「画出来 / 再来一张」循环的发动机，不经 LLM。
   * rejectImageId 存在时先对该图记 swipe_left（淘汰、进历史），再为焦点镜头出下一张。
   * 配方 = 故事锁定配方，未锁定则零点击默认；失败只返回 error，不动已有资产。
   */
  generateNextImage: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        storyId: z.number(),
        shotNo: z.string(),
        prompt: z.string().min(1),
        rejectImageId: z.number().optional(),
        promptCompilationId: z.number().int().positive().nullable().optional(),
        imageProvider: z.enum(IMAGE_PROVIDER_VALUES).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [story, assets] = await Promise.all([
        getStoryById(input.storyId, ctx.user.id),
        getStoryImageAssets(input.storyId, ctx.user.id),
      ]);
      if (!story) {
        return { status: "error" as const, message: "故事不存在或无权访问" };
      }

      // 「再来一张」：先淘汰当前这张（记 swipe_left），校验该图属于本人本故事。
      if (input.rejectImageId != null) {
        const rejected = assets.find(
          candidate => candidate.id === input.rejectImageId
        );
        if (rejected && rejected.kind === "story_frame") {
          await createImageSignal({
            userId: ctx.user.id,
            storyId: rejected.storyId ?? input.storyId,
            imageId: rejected.id,
            action: "swipe_left",
            metadata: {
              source: "creation",
              projectId: input.projectId,
              shotNo: rejected.canonicalShotNo,
              rejectedRecipe: storyArtRecipe(story) ?? null,
            },
          });
        }
      }

      const result = await generateNextImage({
        prompt: input.prompt,
        shotNo: input.shotNo,
        projectId: input.projectId,
        storyId: input.storyId,
        userId: ctx.user.id,
        promptCompilationId: input.promptCompilationId ?? null,
        imageProvider: input.imageProvider,
        // 锁定配方优先，未锁定用零点击默认，保证单张也够漂亮、风格一致。
        artDirection: storyArtRecipe(story) ?? defaultArtRecipe(),
        referenceImages: storyArtReferenceImages(story),
        story,
        assets,
      });
      return result;
    }),

  /** Reassign an image to a different shot */
  reassignImage: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        imageId: z.number(),
        newShotNo: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const assets = await getProjectImageAssets(input.projectId, ctx.user.id);
      if (!assets.some(asset => asset.id === input.imageId)) {
        return { success: false as const };
      }
      await reassignImage(input.imageId, input.newShotNo);
      return { success: true };
    }),

  /** SAM 2 segmentation — click a point on an image to get a mask */
  segment: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
    )
    .mutation(async ({ input }) => {
      return segmentAtPoint(input.imageUrl, input.x, input.y);
    }),

  /** Inpaint — replace a masked region with a new generation */
  inpaint: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        maskUrl: z.string().url(),
        prompt: z.string().min(1),
        shotNo: z.string(),
        projectId: z.number(),
        // 美术风格跟随当前故事（U3）：取该故事的 artReferences；getStoryById 带 userId 验归属
        storyId: z.number().optional(),
        parentImageId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = input.storyId
        ? await getStoryById(input.storyId, ctx.user.id)
        : null;
      const storyReferences = story ? storyArtReferenceImages(story) : [];
      const result = await renderViaGate(
        {
          prompt: input.prompt,
          referenceImages: Array.from(
            new Set([input.imageUrl, ...storyReferences])
          ),
          shotNo: input.shotNo,
          projectId: input.projectId,
          artDirection: story ? storyArtRecipe(story) : undefined,
          styleIndex:
            story &&
            typeof (story.body as Record<string, unknown>)?.styleIndex ===
              "number"
              ? ((story.body as Record<string, unknown>).styleIndex as number)
              : undefined,
        },
        prompt => inpaintImage(input.imageUrl, input.maskUrl, prompt)
      );
      if (result.status === "error" || !result.imageUrl) {
        return {
          status: "error" as const,
          message: result.message ?? "No image returned",
        };
      }
      // Save the inpainted image to DB
      const shotIdentity = story
        ? shotIdentityForStoryShot(story, input.shotNo)
        : null;
      const promptCompilationId =
        story && story.id
          ? await resolveStoryImageCompilationId({
              story,
              storyId: story.id,
              userId: ctx.user.id,
              shotIdentity,
            })
          : null;
      const saved = await createGeneratedImage({
        projectId: input.projectId,
        storyId: story?.id ?? null,
        userId: ctx.user.id,
        shotNo: canonicalizeShotNo(input.shotNo),
        shotIdentity,
        imageKey: `inpaint-${Date.now()}`,
        imageUrl: result.imageUrl,
        prompt: input.prompt,
        promptCompilationId,
        parentImageId: input.parentImageId ?? null,
        generationType: "inpaint",
        maskKey: input.maskUrl,
      });
      return {
        status: "ok" as const,
        image: saved,
      };
    }),
});
