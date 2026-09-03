import path from "node:path";
import { imageAdoptionCaptureIfEnabled } from "../services/personalMemoryAdoption";
import { z } from "zod";
import { IMAGE_PROVIDER_VALUES } from "@shared/imageProvider";
import { canonicalizeShotNo } from "@shared/imageAsset";
import {
  normalizePublishingAlbumTypographyLayout,
  type PublishingAlbumTypographyLayout,
} from "@shared/publishingAlbum";
import {
  VIDEO_CROP_ANCHORS,
  VIDEO_CONFORM_MODES,
  VIDEO_TARGET_ASPECT_RATIOS,
} from "@shared/videoConform";
import {
  normalizeShotIdentity,
  shotIdentityFromShot,
} from "@shared/shotIdentity";
import {
  estimateShotVideoCost,
  SHOT_VIDEO_ASPECT_RATIO,
} from "@shared/shotDirector";
import { protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { assertOptionalProjectOwner } from "./_projectAccess";
import {
  assignStoryImageToShot as assignStoryImageToShotDb,
  createVideoTake,
  getProjectById,
  replaceDirectorShotsForStory,
  getStoryById,
  createGeneratedImage,
  getGeneratedImageById,
  getLatestSucceededPreviewMaskedImageOperationForTarget,
  createImageSignal,
  claimPreviewMaskedImageOperation,
  failPreviewMaskedImageOperation,
  getSucceededPreviewMaskedImageOperationForCandidate,
  promoteStoryImageToCurrent,
  markPreviewMaskedImageOperationAccepted,
  reassignImage,
  settlePreviewMaskedImageOperationSuccess,
  updateStoryTimeline as persistStoryTimeline,
  updateVideoTake,
} from "../db";
import {
  addTimelineAnchorForStory,
  applyVisualLayerActionForStory,
  patchImageTransformForStory,
  previewMaskedImageTargetIsCurrent,
  replaceVisualImageClipImageForStory,
  pasteVisualImageForStory,
  deleteVisualObjectForStory,
  splitOwnedVideoClipForStory,
  setShotDurationForStory,
  undoVisualEditForStory,
  withPlayheadShot,
  updateVideoEditForStory,
  withVisualEditServiceLock,
  includeAllShotsForStory,
  moveShotOrderForStory,
  removeInnerVideoClipForStory,
  reorderShotToTargetForStory,
  setShotIncludedForStory,
  insertVisualImageClipForStory,
  magnetDetachForStory,
  moveShotGroupForStory,
  moveShotSingleForStory,
  moveVisualClipForStory,
  removeTimelineAnchorForStory,
  removeVisualClipForStory,
  rollingTrimForStory,
  trimShotForStory,
} from "../services/visualClipEditing";
import {
  copyStoryVisualObject,
  deleteStoryVisualShot,
  pasteStoryVisualObject,
  retireStoryVisualClipboardScope,
  splitStoryVisualShot,
} from "../services/storyVisualObjectEditing";
import { activateVisualEditSession } from "../services/visualEditSessionRegistry";
import { retireVisualEditUndoScope } from "../services/visualEditUndoJournal";
import { runSponsoredSegmentation } from "../services/segmentationRequestGuard";
import {
  previewMaskedImageInputHash,
  previewMaskedImageQuoteIsValid,
  quotePreviewMaskedImageEdit,
  runPreviewMaskedImageOperation,
} from "../services/previewMaskedImageEditing";

const visualEditOperationSchema = z
  .object({
    editorSessionEpoch: z.string().min(1).max(160),
    operationId: z.string().min(1).max(160),
  })
  .strict();

const visualObjectRefSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("story-shot"),
      stableShotId: z.string().min(1).max(240),
      shotNo: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("owned-video-clip"),
      clipId: z.string().min(1).max(240),
      ownerStableShotId: z.string().min(1).max(240),
    })
    .strict(),
  z
    .object({
      type: z.literal("image-clip"),
      clipId: z.string().min(1).max(240),
      ownerStableShotId: z.string().min(1).max(240),
    })
    .strict(),
]);
const timelineTransformSchema = z.object({
  cropX: z.number().min(0).max(1),
  cropY: z.number().min(0).max(1),
  cropWidth: z.number().min(0.01).max(1),
  cropHeight: z.number().min(0.01).max(1),
  zoom: z.number().min(0.25).max(8),
  panX: z.number().min(-1).max(1),
  panY: z.number().min(-1).max(1),
  rotationDeg: z.number().min(-180).max(180).optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
});
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
import {
  resolveStoredMaskUrl,
  semanticObjectSelectionConfigured,
  segmentAtPoint,
  segmentWithinPolygon,
} from "../services/segmentation";
import { analyzeStoryShotConsistency } from "../services/shotConsistency";
import {
  proposeExtractedFrameTransition,
  proposeGapTransition,
  runTimelineEditCommand,
} from "../services/timelineEditAgent";
import { confirmEditingTransition } from "../services/editingTransitionWorkflow";
import { extractTimelineFrameForStory } from "../services/timelineFrameExtraction";
import { exportStoryTimeline } from "../services/videoExport";
import {
  adviseStoryImages,
  applyImageDirectorAdvice,
} from "../services/directorAdvice";
import {
  editImage as editMobileImage,
  getImageProviderStatus,
  resume302GptImageTask,
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
  resolveShotVideoRenderDecision,
  startShotVideoJob,
} from "../services/videoJobs";
import { getShotVideoProviderStatus } from "../services/videoGen";
import { analyzeShotVideoDirection } from "../services/shotVideoDirection";
import {
  estimateStartEndShotVideo,
  startEndShotVideoJob,
} from "../services/startEndShotVideoWorkflow";
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
  appendVideoTakeToTimeline,
} from "../services/videoTimeline";
import {
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

const timelineImageTypographySchema = z
  .custom<PublishingAlbumTypographyLayout>(
    value => normalizePublishingAlbumTypographyLayout(value) != null,
    "文字排版路径无效，请重新绘制"
  )
  .transform(value => normalizePublishingAlbumTypographyLayout(value)!);

const timelineImageTextOverlaySchema = z.object({
  text: z.string().min(1).max(2_000),
  typography: timelineImageTypographySchema,
});

const timelineTransitionImageEndpointInput = z
  .object({
    mediaKind: z.literal("image").optional(),
    stableShotId: z.string().trim().min(1).max(128),
    shotNo: z.number().int().positive(),
    imageId: z.number().int().positive(),
    // 确认请求不需要回传预览 URL；服务端会按 imageId 重新读取当前归属资产。
    imageUrl: z.string().trim().min(1).max(4096).optional(),
  })
  .transform(endpoint => ({ ...endpoint, mediaKind: "image" as const }));

const timelineTransitionVideoEndpointInput = z.object({
  mediaKind: z.literal("video"),
  stableShotId: z.string().trim().min(1).max(128),
  shotNo: z.number().int().positive(),
  videoTakeId: z.number().int().positive(),
  rangeId: z.number().int().positive().nullable(),
  selectionType: z.enum(["full_take", "range"]),
  atSec: z.number().finite().min(0).max(30),
  mediaRevision: z.string().trim().min(1).max(1024),
  // 只用于卡片预览；付费提交按当前 Take/range 重新生成 canonical URL。
  imageUrl: z.string().trim().min(1).max(4096).optional(),
});

const timelineTransitionEndpointInput = z.union([
  timelineTransitionVideoEndpointInput,
  timelineTransitionImageEndpointInput,
]);

const timelineTransitionCandidateInput = z.object({
  candidateId: z.string().regex(/^transition-[a-f0-9]{16}$/),
  provisionalStableShotId: z.string().regex(/^transition-shot-[a-f0-9]{16}$/),
  storyId: z.number().int().positive(),
  source: timelineTransitionEndpointInput,
  target: timelineTransitionEndpointInput,
  instruction: z.string().trim().min(1).max(500),
  movementAmplitude: z.enum(["auto", "small", "medium", "large"]).optional(),
  prompt: z.string().trim().min(1).max(5_000),
  durationSec: z.number().int().min(1).max(8),
  resolution: z.literal("720p"),
  cutAtSec: z.union([z.literal(1.4), z.null()]),
  estimatedCredits: z.number().int().positive(),
  estimatedCny: z.number().positive(),
  expectedTimelineVersion: z.number().int().min(0),
  placement: z
    .union([
      z.object({
        kind: z.literal("timeline-overlay"),
        startFrame: z.number().int().min(0),
        targetEndFrame: z.number().int().positive(),
        leftImageId: z.number().int().positive(),
        rightImageId: z.number().int().positive(),
      }),
      z.object({
        kind: z.literal("story-shot"),
        left: z.object({
          clipId: z.string().min(1).max(256),
          imageId: z.number().int().positive(),
          timelineFrame: z.number().int().min(0),
          visualLayer: z.number().int().min(0),
        }),
        right: z.object({
          clipId: z.string().min(1).max(256),
          imageId: z.number().int().positive(),
          timelineFrame: z.number().int().min(0),
          visualLayer: z.number().int().min(0),
        }),
      }),
    ])
    .optional(),
});

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
  imageProviderStatus: protectedProcedure.query(() => getImageProviderStatus()),

  shotVideoProviderStatus: protectedProcedure.query(() =>
    getShotVideoProviderStatus()
  ),

  analyzeShotVideoDirection: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        shotNo: z.number().int().positive(),
        stableShotId: z.string().trim().min(1).max(128),
        draftPrompt: z.string().trim().min(1).max(8_000),
        subtitle: z.string().max(2_000).optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      analyzeShotVideoDirection(input, ctx.user.id)
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
      // projectId 会被喂进 renderGate 去捞该项目的编辑偏好与聊天修正，是访问键
      // 而不是标签；不校验归属就会把别人项目的文字带进本次出图提示词。
      await assertOptionalProjectOwner(input.projectId, ctx.user.id);
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
          const stylized = await renderViaGate(
            {
              prompt:
                "Create a clean character reference portrait of the supplied person for future story frames.",
              userInstructions: [
                "Preserve the person's recognizable face, hairstyle, clothing color, clothing material, and overall identity.",
              ],
              storyId: story.id,
              projectId: story.projectId ?? undefined,
              artDirection: storyArtRecipe(story),
              outputPurpose: "image-edit",
              referencePolicy: "preserve-identity",
              referenceImages: [photoCall.photoUrl.trim()],
            },
            prompt =>
              editMobileImage(photoCall.photoUrl.trim(), prompt, {
                provider: input.imageProvider,
                requireInputImage: true,
              })
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

      // buildShotList：聊聊请求铺整张镜头表 → 用现成 synthesizeShotList 合成、
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
      // 上面已经挡掉 storyId 为空的情况；提出来是为了让回调里也拿到窄化后的类型。
      const assetStoryId = asset.storyId;
      const promoted = await promoteStoryImageToCurrent({
        userId: ctx.user.id,
        storyId: assetStoryId,
        imageId: asset.id,
        metadata: {
          source: "creation",
          projectId: input.projectId,
          shotNo: asset.canonicalShotNo,
        },
        // 用户在资产面板里点选这张图作为该镜头首帧——包括重新选回旧图，
        // 那同样是一次新的采用（计划：撤销后再采用产生有序的新动作）。
        adoption: signalId =>
          imageAdoptionCaptureIfEnabled({
            userId: ctx.user.id,
            storyId: assetStoryId,
            imageId: asset.id,
            signalId,
            context: { entry: "select_image", display: { shotNo: asset.canonicalShotNo } },
          }),
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
        return {
          status: "error" as const,
          error: "故事不存在或无权操作",
          errorKind: "invalid" as const,
        };
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
        // 用户从四宫格里裁出这一张并设为首帧：是在候选之间做过选择的。
        adoption: signalId =>
          imageAdoptionCaptureIfEnabled({
            userId: ctx.user.id,
            storyId: input.storyId,
            imageId: image.id,
            signalId,
            context: { entry: "promote_frame_crop", display: { shotNo, quadrant: input.quadrant ?? null } },
          }),
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
        // 素材抽屉里直接把这张图设为当前：明确的用户选择。
        adoption: signalId =>
          imageAdoptionCaptureIfEnabled({
            userId: ctx.user.id,
            storyId: input.storyId,
            imageId: input.imageId,
            signalId,
            context: { entry: "promote_story_image" },
          }),
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
        return {
          status: "error" as const,
          error: "故事不存在或无权操作",
          errorKind: "invalid" as const,
        };
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
        // 导入时交代给下游模型的信息：人物/镜头怎么运动、场景道具、色调基准。
        // 写进素材 prompt，视频包编译时随素材一起进入模型上下文。
        note: z.string().trim().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return {
          status: "error" as const,
          error: "故事不存在或无权操作",
          errorKind: "invalid" as const,
        };
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
        const target = input.targetStableShotId
          ? resolveStoryShotTarget(story, input.targetStableShotId)
          : null;
        if (input.targetStableShotId && !target) {
          return { status: "error" as const, error: "目标镜头不存在" };
        }
        const image = await createGeneratedImage({
          projectId: story.projectId ?? null,
          storyId: input.storyId,
          userId: ctx.user.id,
          shotNo: target?.shotNo ?? null,
          shotIdentity: target?.stableShotId ?? null,
          imageKey: stored.imageKey ?? null,
          imageUrl: stored.imageUrl,
          prompt: input.note?.trim() || `导入素材：${input.fileName}`,
          promptCompilationId: null,
          parentImageId: null,
          isCurrent: false,
          generationType: "initial",
          maskKey: null,
        });
        if (target) {
          const assigned = await assignStoryImageToShotDb({
            storyId: input.storyId,
            userId: ctx.user.id,
            imageId: image.id,
            shotNo: target.shotNo,
            shotIdentity: target.stableShotId,
            metadata: {
              source: "material_warehouse",
              targetStableShotId: target.stableShotId,
              shotNo: target.shotNo,
            },
          });
          if (!assigned) {
            return { status: "error" as const, error: "图片绑定失败" };
          }
        }
        return {
          status: "ok" as const,
          kind: "image" as const,
          imageId: image.id,
          imageUrl: image.imageUrl,
          shotNo: target?.shotNo ?? null,
          stableShotId: target?.stableShotId ?? null,
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
          prompt: input.note?.trim() || `导入素材：${input.fileName}`,
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
            importNote: input.note?.trim() || null,
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
            importNote: input.note?.trim() || null,
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
  estimateStartEndShotVideo: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        stableShotId: z.string().trim().min(1).max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return {
          status: "ok" as const,
          estimate: await estimateStartEndShotVideo(input, ctx.user.id),
        };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "首尾帧视频报价失败",
        };
      }
    }),

  submitStartEndShotVideo: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        stableShotId: z.string().trim().min(1).max(128),
        rerenderRequestId: z.string().trim().min(1).max(128).optional(),
        costConfirmation: z.object({
          accepted: z.literal(true),
          estimatedCny: z.number().nonnegative(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await startEndShotVideoJob(
        {
          storyId: input.storyId,
          stableShotId: input.stableShotId,
          rerenderRequestId: input.rerenderRequestId,
          confirmedEstimatedCny: input.costConfirmation.estimatedCny,
        },
        ctx.user.id
      );
      if (result.status !== "ok") {
        return {
          status: "error" as const,
          error: result.error,
          take: result.take ?? null,
          takeId: result.take?.id,
          estimate: result.estimate,
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
        estimatedCny: result.estimate.estimatedCny,
      };
    }),

  generateShotVideo: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        shotNo: z.number(),
        stableShotId: z.string().optional(),
        promptCompilationId: z.number().int().positive().nullable().optional(),
        imageId: z.number(),
        characterReferenceImageUrl: z.string().trim().min(1).optional(),
        storyStyleReferenceImageUrl: z.string().trim().min(1).optional(),
        previousReferenceImageId: z.number().optional(),
        nextReferenceImageId: z.number().optional(),
        prompt: z.string().min(1),
        subtitle: z.string().optional(),
        durationSec: z.number().min(3).max(10).optional(),
        motion: z.enum(["low", "high"]).optional(),
        aspectRatio: z.literal(SHOT_VIDEO_ASPECT_RATIO).optional(),
        directorPromptApproved: z.boolean().optional(),
        rerenderRequestId: z.string().trim().min(1).max(128).optional(),
        costConfirmation: z.object({
          accepted: z.literal(true),
          estimatedCny: z.number().nonnegative(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const durationSec = input.durationSec ?? 5;
      const motion = input.motion ?? getShotVideoProviderStatus().motion;
      const renderDecision = await resolveShotVideoRenderDecision(
        {
          storyId: input.storyId,
          shotNo: input.shotNo,
          stableShotId: input.stableShotId,
          prompt: input.prompt,
        },
        ctx.user.id
      );
      const paidEstimate = estimateShotVideoCost({ durationSec, motion });
      const estimate = {
        ...paidEstimate,
        estimatedCny:
          renderDecision.strategy === "local-transform"
            ? 0
            : paidEstimate.estimatedCny,
      };
      if (
        Math.abs(input.costConfirmation.estimatedCny - estimate.estimatedCny) >
        0.001
      ) {
        return {
          status: "error" as const,
          error: `费用预估已变化，请重新确认预计 ¥${estimate.estimatedCny.toFixed(2)}`,
        };
      }
      const result = await startShotVideoJob(
        {
          storyId: input.storyId,
          shotNo: input.shotNo,
          stableShotId: input.stableShotId ?? null,
          promptCompilationId: input.promptCompilationId ?? null,
          imageId: input.imageId,
          characterReferenceImageUrl: input.characterReferenceImageUrl,
          storyStyleReferenceImageUrl: input.storyStyleReferenceImageUrl,
          previousReferenceImageId: input.previousReferenceImageId,
          nextReferenceImageId: input.nextReferenceImageId,
          prompt: input.prompt,
          subtitle: input.subtitle,
          durationSec,
          aspectRatio: input.aspectRatio ?? SHOT_VIDEO_ASPECT_RATIO,
          motion,
          directorPromptApproved: input.directorPromptApproved,
          rerenderRequestId: input.rerenderRequestId,
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
        estimatedCny: estimate.estimatedCny,
        renderStrategy: renderDecision.strategy,
        renderReason: renderDecision.reason,
      };
    }),

  /**
   * 导演顾问：逐图判断待安排图片能为故事的哪一镜服务 + 渲染成视频的
   * 具体参数（运镜/时长/情绪/视频提示词）。
   */
  adviseStoryImages: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        imageIds: z.array(z.number().int().positive()).optional(),
        maxImages: z.number().int().min(1).max(12).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return adviseStoryImages({
        storyId: input.storyId,
        userId: ctx.user.id,
        imageIds: input.imageIds,
        maxImages: input.maxImages,
      });
    }),

  /** 采纳导演建议：图绑定目标镜头成为首帧，视频参数与理由写进镜头。 */
  applyImageAdvice: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        imageId: z.number().int().positive(),
        targetShotNo: z.number().int().positive(),
        targetStableShotId: z.string().trim().min(1),
        reason: z.string().trim().max(500).optional(),
        videoDirection: z
          .object({
            videoPrompt: z.string().trim().min(1).max(800),
            cameraMove: z.string().trim().max(60),
            durationSec: z.number().min(3).max(10),
            motion: z.enum(["low", "high"]),
            emotionalTone: z.string().trim().max(30),
          })
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return applyImageDirectorAdvice({
        storyId: input.storyId,
        userId: ctx.user.id,
        imageId: input.imageId,
        targetShotNo: input.targetShotNo,
        targetStableShotId: input.targetStableShotId,
        videoDirection: input.videoDirection,
        reason: input.reason,
        // 用户逐图点「采纳」：采用凭据在这里给出，不由服务层自己造。
        adoption: signalId =>
          imageAdoptionCaptureIfEnabled({
            userId: ctx.user.id,
            storyId: input.storyId,
            imageId: input.imageId,
            signalId,
            context: {
              entry: "director_advice",
              display: { targetShotNo: input.targetShotNo },
            },
          }),
      });
    }),

  /**
   * 成片导出：按时间轴顺序把各镜头当前视频归一化转码后拼成一条 mp4。
   * 所见即所得——界面上每镜头显示什么就导什么。
   */
  exportTimeline: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        targetAspectRatio: z.enum(VIDEO_TARGET_ASPECT_RATIOS).optional(),
        // 素材兜底：镜头没有「当前视频」时退回已选择/最新可用素材再导。
        fallbackToLatestTake: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return exportStoryTimeline({
        storyId: input.storyId,
        userId: ctx.user.id,
        targetAspectRatio: input.targetAspectRatio,
        fallbackToLatestTake: input.fallbackToLatestTake,
      });
    }),

  /**
   * 剪辑指令（对话驱动剪辑）：自然语言 → 时间轴操作（移动/删除/恢复/时长/重排）。
   * 不是剪辑意图时返回 handled=false，由调用方放行回普通聊聊聊天。
   */
  timelineEditCommand: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        instruction: z.string().trim().min(1).max(500),
        selectionContext: z
          .object({
            stableShotId: z
              .string()
              .trim()
              .min(1)
              .max(128)
              .nullable()
              .optional(),
            shotNo: z.number().int().positive().nullable().optional(),
            sourceType: z
              .enum([
                "card",
                "script-scene",
                "script-meta",
                "shot",
                "storyboard-image",
                "animatic-video",
                "timeline-range",
                "chat",
              ])
              .optional(),
            sourceId: z.string().max(200).optional(),
            imageId: z.number().int().positive().nullable().optional(),
            videoTakeId: z.number().int().positive().nullable().optional(),
            rangeId: z.number().int().positive().nullable().optional(),
            selection: z
              .discriminatedUnion("kind", [
                z.object({
                  kind: z.literal("time"),
                  startSec: z.number().min(0),
                  endSec: z.number().min(0),
                }),
                z.object({
                  kind: z.literal("text"),
                  start: z.number().int().min(0),
                  end: z.number().int().min(0),
                }),
                z.object({
                  kind: z.literal("rect"),
                  x: z.number(),
                  y: z.number(),
                  width: z.number(),
                  height: z.number(),
                }),
              ])
              .nullable()
              .optional(),
          })
          .optional(),
        /**
         * 用户此刻看的是第几毫秒。
         *
         * 「把这里改一下」里的「这里」，在没有显式选中素材时就是播放头所在
         * 的那一刻。以前播放头只活在底部时间线的局部 state 里，聊聊拿不到，
         * 于是这类指令只能猜或者要求用户先点一下。
         */
        playheadMs: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 没有显式选中素材时，用播放头所在那一帧的可见素材当作「这里」。
      // 解析走 resolveTimelineVisualFrame——与预览、导出同一个入口，
      // 不会出现「聊聊说的那一镜」和「你看到的那一镜」是两个的情况。
      const selectionContext =
        input.selectionContext?.stableShotId || input.playheadMs === undefined
          ? input.selectionContext
          : await withPlayheadShot(
              input.storyId,
              ctx.user.id,
              input.playheadMs,
              input.selectionContext
            );
      return runTimelineEditCommand({
        storyId: input.storyId,
        userId: ctx.user.id,
        instruction: input.instruction,
        selectionContext,
      });
    }),

  /**
   * 时间轴空档右键「自动创建镜头」的直接入口：跳过聊天里的自然语言解析，
   * 直接拿两个相邻镜头身份建同一份衔接提案卡片。只生成待确认卡片，
   * 真正调用模型和扣费仍然要走下面 confirmTimelineTransition。
   */
  proposeGapTransition: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        beforeStableShotId: z.string().min(1).max(200),
        afterStableShotId: z.string().min(1).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return proposeGapTransition({
        storyId: input.storyId,
        userId: ctx.user.id,
        beforeStableShotId: input.beforeStableShotId,
        afterStableShotId: input.afterStableShotId,
      });
    }),

  /** 抽帧轨道空白处：两张真实抽帧只生成待确认的上层覆盖提案。 */
  proposeExtractedFrameTransition: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        leftImageId: z.number().int().positive(),
        rightImageId: z.number().int().positive(),
        leftClipId: z.string().trim().min(1).max(256),
        rightClipId: z.string().trim().min(1).max(256),
        instruction: z.string().trim().max(2_000).optional(),
        movementAmplitude: z
          .enum(["auto", "small", "medium", "large"])
          .optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      proposeExtractedFrameTransition({
        ...input,
        userId: ctx.user.id,
      })
    ),

  /** 用户明确确认后才进入的付费衔接生成入口；candidateId 负责续查同一任务。 */
  confirmTimelineTransition: protectedProcedure
    .input(z.object({ candidate: timelineTransitionCandidateInput }))
    .mutation(async ({ ctx, input }) => {
      return confirmEditingTransition(
        {
          ...input.candidate,
          source: {
            ...input.candidate.source,
            imageUrl: input.candidate.source.imageUrl ?? "",
          },
          target: {
            ...input.candidate.target,
            imageUrl: input.candidate.target.imageUrl ?? "",
          },
        },
        ctx.user.id
      );
    }),

  /**
   * 一键剪辑 · 视觉一致性识别：锚点图 vs 每镜头当前主图，
   * 视觉模型逐对找五官/发型/服饰/场景/画风差异。未配置视觉通道时返回 not_configured。
   */
  analyzeShotConsistency: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        anchorImageUrl: z.string().trim().min(1).nullable().optional(),
        targetImage: z
          .object({
            imageId: z.number().int().positive(),
            imageUrl: z.string().trim().min(1),
            shotNo: z.string().trim().min(1).nullable().optional(),
          })
          .optional(),
        maxShots: z.number().int().min(1).max(24).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return analyzeStoryShotConsistency({
        storyId: input.storyId,
        userId: ctx.user.id,
        anchorImageUrl: input.anchorImageUrl ?? undefined,
        targetImage: input.targetImage,
        maxShots: input.maxShots,
      });
    }),

  conformVideoTakes: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        // 每个视频带上它在【当前故事】体检行里的镜头身份：跨故事继承的
        // 素材靠别名互认绑定，服务端无法反推，必须由界面直传。
        items: z
          .array(
            z.object({
              takeId: z.number().int().positive(),
              stableShotId: z.string().trim().min(1),
              mode: z.enum(VIDEO_CONFORM_MODES),
              cropPath: z
                .object({
                  start: z.enum(VIDEO_CROP_ANCHORS),
                  end: z.enum(VIDEO_CROP_ANCHORS),
                })
                .optional(),
            })
          )
          .min(1)
          .max(50)
          .superRefine((items, ctx) => {
            const seen = new Set<string>();
            items.forEach((item, index) => {
              const key = `${item.takeId}\u0000${item.stableShotId}`;
              if (seen.has(key)) {
                ctx.addIssue({
                  code: "custom",
                  message: "同一个视频镜头不能重复提交",
                  path: [index],
                });
              }
              seen.add(key);
            });
          }),
        targetAspectRatio: z.enum(VIDEO_TARGET_ASPECT_RATIOS),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const items = input.items;
      const rawResults = await mapWithConcurrency(items, 2, item =>
        conformVideoTake(
          {
            storyId: input.storyId,
            sourceTakeId: item.takeId,
            targetAspectRatio: input.targetAspectRatio,
            mode: item.mode,
            cropPath: item.cropPath,
            targetStableShotId: item.stableShotId,
          },
          ctx.user.id
        )
      );
      const results = rawResults.map((result, index) => ({
        ...result,
        stableShotId: items[index]!.stableShotId,
      }));
      const completed = results.filter(result => result.status === "ok");
      const failed = results.filter(result => result.status === "error");
      const availableCount = completed.filter(
        result => result.take.status === "available"
      ).length;
      const processingCount = completed.filter(
        result => result.take.status === "processing"
      ).length;
      return {
        status:
          failed.length === 0
            ? ("ok" as const)
            : completed.length === 0
              ? ("error" as const)
              : ("partial" as const),
        acceptedCount: completed.length,
        completedCount: availableCount,
        availableCount,
        processingCount,
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

  appendVideoTakeToTimeline: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        sourceTakeId: z.number().int().positive(),
        targetStableShotId: z.string().min(1),
        sourceStartSec: z.number().min(0),
        sourceEndSec: z.number().positive(),
        targetOffsetMs: z.number().min(0).optional(),
        expectedTimelineVersion: z.number().int().min(0),
        effects: z.object({
          playbackRate: z.number().min(0.25).max(4),
          reverse: z.boolean(),
          volume: z.number().min(0).max(2),
          muted: z.boolean(),
        }),
        transform: z.object({
          cropX: z.number().min(0).max(1),
          cropY: z.number().min(0).max(1),
          cropWidth: z.number().min(0.01).max(1),
          cropHeight: z.number().min(0.01).max(1),
          zoom: z.number().min(1).max(8),
          panX: z.number().min(-1).max(1),
          panY: z.number().min(-1).max(1),
          rotationDeg: z.number().min(-180).max(180).optional(),
          flipX: z.boolean().optional(),
          flipY: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await appendVideoTakeToTimeline(input, ctx.user.id);
        return { status: "ok" as const, ...result };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "视频片段追加失败",
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
            durationFrames: z.number().int().min(1).optional(),
            timelineStartFrame: z.number().int().min(0).optional(),
            stackOrder: z.number().int().min(0).optional(),
            visualLayer: z.number().int().min(0).optional(),
            referencedImageId: z.number().int().positive().optional(),
            detachedFromPreviousShotId: z.string().min(1).max(160).optional(),
            anchors: z
              .array(
                z.object({
                  id: z.string().min(1).max(160),
                  timelineFrame: z.number().int().min(0),
                  sourceType: z.enum(["primary-video", "visual-clip", "image"]),
                  sourceId: z.string().min(1).max(240),
                  sourceTimeSec: z.number().min(0).nullable(),
                })
              )
              .optional(),
            transform: z.object({
              cropX: z.number().min(0).max(1),
              cropY: z.number().min(0).max(1),
              cropWidth: z.number().min(0.01).max(1),
              cropHeight: z.number().min(0.01).max(1),
              zoom: z.number().min(1).max(8),
              panX: z.number().min(-1).max(1),
              panY: z.number().min(-1).max(1),
              rotationDeg: z.number().min(-180).max(180).optional(),
              flipX: z.boolean().optional(),
              flipY: z.boolean().optional(),
            }),
            imageTransforms: z
              .record(
                z.string(),
                z.object({
                  cropX: z.number().min(0).max(1),
                  cropY: z.number().min(0).max(1),
                  cropWidth: z.number().min(0.01).max(1),
                  cropHeight: z.number().min(0.01).max(1),
                  zoom: z.number().min(0.25).max(8),
                  panX: z.number().min(-1).max(1),
                  panY: z.number().min(-1).max(1),
                  rotationDeg: z.number().min(-180).max(180).optional(),
                  flipX: z.boolean().optional(),
                  flipY: z.boolean().optional(),
                })
              )
              .optional(),
            imageTextOverlays: z
              .record(z.string(), timelineImageTextOverlaySchema)
              .optional(),
            primaryVideoEdit: z
              .object({
                takeId: z.number().int().positive(),
                sourceStartSec: z.number().min(0),
                sourceEndSec: z.number().positive(),
                effects: z.object({
                  playbackRate: z.number().min(0.25).max(4),
                  reverse: z.boolean(),
                  volume: z.number().min(0).max(2),
                  muted: z.boolean(),
                }),
              })
              .optional(),
            visualClips: z
              .array(
                z.object({
                  id: z.string().min(1).max(160),
                  takeId: z.number().int().positive(),
                  rangeId: z.number().int().positive(),
                  sourceStableShotId: z.string().min(1),
                  videoUrl: z.string().min(1),
                  label: z.string().min(1).max(120),
                  sourceStartSec: z.number().min(0),
                  sourceEndSec: z.number().min(0),
                  offsetMs: z.number().min(0),
                  durationMs: z.number().min(1),
                  effects: z
                    .object({
                      playbackRate: z.number().min(0.25).max(4),
                      reverse: z.boolean(),
                      volume: z.number().min(0).max(2),
                      muted: z.boolean(),
                    })
                    .optional(),
                  transform: z
                    .object({
                      cropX: z.number().min(0).max(1),
                      cropY: z.number().min(0).max(1),
                      cropWidth: z.number().min(0.01).max(1),
                      cropHeight: z.number().min(0.01).max(1),
                      zoom: z.number().min(1).max(8),
                      panX: z.number().min(-1).max(1),
                      panY: z.number().min(-1).max(1),
                      rotationDeg: z.number().min(-180).max(180).optional(),
                      flipX: z.boolean().optional(),
                      flipY: z.boolean().optional(),
                    })
                    .optional(),
                  visualLayer: z.number().int().min(0).optional(),
                })
              )
              .optional(),
            imageClips: z
              .array(
                z.object({
                  id: z.string().min(1).max(160),
                  imageId: z.number().int().positive(),
                  imageUrl: z.string().min(1),
                  label: z.string().min(1).max(120),
                  offsetFrames: z.number().int().min(0),
                  timelineStartFrame: z.number().int().min(0).optional(),
                  durationFrames: z.number().int().min(1),
                  visualLayer: z.number().int().min(0),
                  transform: z
                    .object({
                      cropX: z.number().min(0).max(1),
                      cropY: z.number().min(0).max(1),
                      cropWidth: z.number().min(0.01).max(1),
                      cropHeight: z.number().min(0.01).max(1),
                      zoom: z.number().min(1).max(8),
                      panX: z.number().min(-1).max(1),
                      panY: z.number().min(-1).max(1),
                      rotationDeg: z.number().min(-180).max(180).optional(),
                      flipX: z.boolean().optional(),
                      flipY: z.boolean().optional(),
                    })
                    .optional(),
                })
              )
              .optional(),
            visualClipsReplacePrimary: z.boolean().optional(),
          })
        ),
        overlays: z
          .array(
            z.object({
              id: z.string().min(1),
              kind: z.literal("generated-video"),
              takeId: z.number().int().positive(),
              sourceStableShotId: z.string().min(1),
              videoUrl: z.string().min(1),
              startFrame: z.number().int().min(0),
              targetEndFrame: z.number().int().min(1),
              mediaEndFrame: z.number().int().min(1),
              endFrame: z.number().int().min(1),
              stackOrder: z.number().int().min(0),
              visualLayer: z.number().int().min(0).optional(),
              leftImageId: z.number().int().positive(),
              rightImageId: z.number().int().positive(),
              transform: z.object({
                cropX: z.number().min(0).max(1),
                cropY: z.number().min(0).max(1),
                cropWidth: z.number().min(0.01).max(1),
                cropHeight: z.number().min(0.01).max(1),
                zoom: z.number().min(1).max(8),
                panX: z.number().min(-1).max(1),
                panY: z.number().min(-1).max(1),
                rotationDeg: z.number().min(-180).max(180).optional(),
                flipX: z.boolean().optional(),
                flipY: z.boolean().optional(),
              }),
              effects: z
                .object({
                  playbackRate: z.number().min(0.25).max(4),
                  reverse: z.boolean(),
                  volume: z.number().min(0).max(2),
                  muted: z.boolean(),
                })
                .optional(),
            })
          )
          .optional(),
        visualLayerState: z
          .object({
            count: z.number().int().min(1),
            hidden: z.array(z.number().int().min(0)),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return {
          status: "error" as const,
          error: "故事不存在或无权操作",
          errorKind: "invalid" as const,
        };
      }
      try {
        const timeline = await persistStoryTimeline({
          storyId: input.storyId,
          userId: ctx.user.id,
          expectedVersion: input.expectedVersion,
          items: [...input.items]
            .sort((left, right) => left.position - right.position)
            .map((item, position) => ({ ...item, position })),
          overlays: input.overlays,
          visualLayerState: input.visualLayerState,
        });
        return { status: "ok" as const, timeline };
      } catch (error) {
        return {
          status: "error" as const,
          error: error instanceof Error ? error.message : "时间轴保存失败",
        };
      }
    }),

  /**
   * 多轨剪辑的唯一移动命令。
   *
   * 一次斜向拖动只调用一次：服务端自己读取时间线、只改这一个 clip、再写回。
   * 客户端不再上传整份 items，也不再持有 expectedVersion。
   */
  moveVisualClip: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        clipId: z.string().min(1).max(240),
        toTrackId: z.string().min(1).max(64),
        toStartFrame: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return {
          status: "error" as const,
          error: "故事不存在或无权操作",
          errorKind: "invalid" as const,
        };
      }
      return moveVisualClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        clipId: input.clipId,
        toTrackId: input.toTrackId,
        toStartFrame: input.toStartFrame,
      });
    }),

  /**
   * 权威时间线抽帧。客户端只交代播放头与操作层；赢家解析、视频解码、
   * 仓库备份、相邻可见层规划和图片落位全部由服务端完成并可幂等重放。
   */
  extractTimelineFrame: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        requestId: z.string().trim().min(1).max(160),
        timelineFrame: z.number().int().min(0),
        operationLayer: z.number().int().min(0),
      })
    )
    .mutation(({ ctx, input }) =>
      extractTimelineFrameForStory({
        ...input,
        userId: ctx.user.id,
      })
    ),

  /**
   * 唯一的图片落位命令。调用方只说「哪张图、去哪条轨、去哪一帧」，
   * 不需要指定它挂在哪个镜头下面；同一个 clipId 重复提交是替换。
   */
  insertVisualImageClip: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        clipId: z.string().min(1).max(240),
        imageId: z.number().int().positive(),
        imageUrl: z.string().min(1),
        label: z.string().min(1).max(160),
        toTrackId: z.string().min(1).max(64),
        toStartFrame: z.number().int().min(0),
        durationFrames: z.number().int().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return {
          status: "error" as const,
          error: "故事不存在或无权操作",
          errorKind: "invalid" as const,
        };
      }
      return insertVisualImageClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        clip: {
          clipId: input.clipId,
          imageId: input.imageId,
          imageUrl: input.imageUrl,
          label: input.label,
          trackId: input.toTrackId,
          startFrame: input.toStartFrame,
          ...(input.durationFrames === undefined
            ? {}
            : { durationFrames: input.durationFrames }),
        },
      });
    }),

  /** 移除一个普通剪辑块（图片 clip、内部片段或遗留 overlay）。 */
  removeVisualClip: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        clipId: z.string().min(1).max(240),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const story = await getStoryById(input.storyId, ctx.user.id);
      if (!story) {
        return {
          status: "error" as const,
          error: "故事不存在或无权操作",
          errorKind: "invalid" as const,
        };
      }
      return removeVisualClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        clipId: input.clipId,
      });
    }),

  // ── 以下七个命令取代了「客户端跑 planner 算出整份 items 再整份写回」──
  // 客户端只说做什么，不说算成什么：rows 与镜头素材信息全部由服务端自己取。

  /** 方向整组移动：只带走与起始镜头同一视觉层的镜头。 */
  moveShotGroup: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        sourceShotId: z.string().min(1).max(240),
        direction: z.enum(["left", "right"]),
        deltaFrames: z.number().int(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      moveShotGroupForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        sourceShotId: input.sourceShotId,
        direction: input.direction,
        deltaFrames: input.deltaFrames,
      })
    ),

  /** 单镜移动：横向位移、换层与遗留 overlay 迁移在同一次写入里完成。 */
  moveShotSingle: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        deltaFrames: z.number().int(),
        snapThresholdFrames: z.number().int().min(0).optional(),
        toVisualLayer: z.number().int().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      moveShotSingleForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        deltaFrames: input.deltaFrames,
        ...(input.snapThresholdFrames === undefined
          ? {}
          : { snapThresholdFrames: input.snapThresholdFrames }),
        ...(input.toVisualLayer === undefined
          ? {}
          : { toVisualLayer: input.toVisualLayer }),
      })
    ),

  /** 滚动接缝：左镜结束与右镜开始必须一起改，任一侧被挡则整次不提交。 */
  rollingTrimTimeline: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        leftStableShotId: z.string().min(1).max(240),
        rightStableShotId: z.string().min(1).max(240),
        requestedBoundaryFrame: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) =>
      rollingTrimForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        leftStableShotId: input.leftStableShotId,
        rightStableShotId: input.rightStableShotId,
        requestedBoundaryFrame: input.requestedBoundaryFrame,
      })
    ),

  /** 取消两个镜头之间的吸附。 */
  detachTimelineMagnet: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        leftStableShotId: z.string().min(1).max(240),
        rightStableShotId: z.string().min(1).max(240),
      })
    )
    .mutation(async ({ ctx, input }) =>
      magnetDetachForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        leftStableShotId: input.leftStableShotId,
        rightStableShotId: input.rightStableShotId,
      })
    ),

  /**
   * 在某一帧打锚点。客户端以前要先自己解析「这一帧是哪个画面」再传过来；
   * 现在只给帧号，服务端用同一个 resolveTimelineVisualFrame 入口解析，
   * 隐藏层规则一并生效，不会两边算出不同答案。
   */
  addTimelineAnchor: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        timelineFrame: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) =>
      addTimelineAnchorForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        timelineFrame: input.timelineFrame,
      })
    ),

  /** 取消某个镜头上的一个锚点。 */
  removeTimelineAnchor: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        anchorId: z.string().min(1).max(240),
      })
    )
    .mutation(async ({ ctx, input }) =>
      removeTimelineAnchorForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        anchorId: input.anchorId,
      })
    ),

  /** 修剪单镜的首或尾。 */
  trimShot: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        edge: z.enum(["start", "end"]),
        requestedBoundaryFrame: z.number().int().min(0),
      })
    )
    .mutation(async ({ ctx, input }) =>
      trimShotForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        edge: input.edge,
        requestedBoundaryFrame: input.requestedBoundaryFrame,
      })
    ),

  /** 图层的插入、整层移动、删除与显隐切换。 */
  applyVisualLayerAction: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        action: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("insert"), at: z.number().int().min(0) }),
          z.object({
            kind: z.literal("move"),
            from: z.number().int().min(0),
            to: z.number().int().min(0),
          }),
          z.object({
            kind: z.literal("remove"),
            layer: z.number().int().min(0),
          }),
          z.object({
            kind: z.literal("toggle-hidden"),
            layer: z.number().int().min(0),
          }),
        ]),
      })
    )
    .mutation(async ({ ctx, input }) =>
      applyVisualLayerActionForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        action: input.action,
      })
    ),

  /** 把某个镜头放进或移出时间线。 */
  setShotIncluded: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        included: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      setShotIncludedForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        included: input.included,
      })
    ),

  /** 相邻交换顺序。 */
  moveShotOrder: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        direction: z.union([z.literal(-1), z.literal(1)]),
      })
    )
    .mutation(async ({ ctx, input }) =>
      moveShotOrderForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        direction: input.direction,
      })
    ),

  /** 拖放重排：把源镜头挪到目标镜头的位置。 */
  reorderShotToTarget: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        sourceShotId: z.string().min(1).max(240),
        targetShotId: z.string().min(1).max(240),
      })
    )
    .mutation(async ({ ctx, input }) =>
      reorderShotToTargetForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        sourceShotId: input.sourceShotId,
        targetShotId: input.targetShotId,
      })
    ),

  /** 把所有镜头放回时间线。 */
  includeAllShots: protectedProcedure
    .input(z.object({ storyId: z.number() }))
    .mutation(async ({ ctx, input }) =>
      includeAllShotsForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
      })
    ),

  /** 移除镜头内部的一个视频片段。 */
  removeInnerVideoClip: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        clipId: z.string().min(1).max(240),
      })
    )
    .mutation(async ({ ctx, input }) =>
      removeInnerVideoClipForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        clipId: input.clipId,
      })
    ),

  /** 改镜头的计划时长。 */
  setShotDuration: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        durationMs: z.number().min(100),
      })
    )
    .mutation(async ({ ctx, input }) =>
      setShotDurationForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        durationMs: input.durationMs,
      })
    ),

  /** 改某张图片在镜头里的构图与文字层。 */
  patchImageTransform: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        imageId: z.number().int().positive(),
        transform: timelineTransformSchema,
        textOverlay: timelineImageTextOverlaySchema.nullable(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      patchImageTransformForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
        stableShotId: input.stableShotId,
        imageId: input.imageId,
        transform: input.transform,
        textOverlay: input.textOverlay,
      })
    ),

  /**
   * 撤销上一次视觉剪辑命令。客户端只说「撤销」，不再持有也不再写回 items。
   * 回退的粒度是整份文档，所以图层与素材天然一起还原。
   */
  pasteVisualImage: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          operation: visualEditOperationSchema,
          pasteId: z.string().min(1).max(160),
          targetFrame: z.number().int().min(0),
          targetLayer: z.number().int().min(0),
          snapshot: z
            .object({
              version: z.literal(1),
              kind: z.literal("image-clip"),
              sourceStoryId: z.number().int().positive(),
              sourceClipId: z.string().min(1).max(240),
              sourceLayer: z.number().int().min(0),
              imageId: z.number().int().positive(),
              label: z.string().max(500),
              durationFrames: z.number().int().positive(),
              transform: timelineTransformSchema.strict().nullable(),
            })
            .strict(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      pasteVisualImageForStory({
        ...input,
        userId: ctx.user.id,
        snapshot: { ...input.snapshot, imageUrl: "" },
      })
    ),

  deleteVisualObject: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          operation: visualEditOperationSchema,
          object: visualObjectRefSchema,
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      deleteVisualObjectForStory({ ...input, userId: ctx.user.id })
    ),

  splitOwnedVideoClip: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          operation: visualEditOperationSchema,
          ownerStableShotId: z.string().min(1).max(240),
          clipId: z.string().min(1).max(240),
          cutFrame: z.number().int().min(0),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      splitOwnedVideoClipForStory({ ...input, userId: ctx.user.id })
    ),

  copyStoryVisualObject: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          editorSessionEpoch: z.string().min(1).max(160),
          clipboardId: z.string().min(1).max(160),
          object: visualObjectRefSchema,
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      copyStoryVisualObject({ ...input, userId: ctx.user.id })
    ),

  activateVisualEditSession: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          editorClientId: z.string().trim().min(1).max(160),
          editorSessionEpoch: z.string().trim().min(1).max(160),
          activationSequence: z.number().int().nonnegative(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await getStoryById(input.storyId, ctx.user.id)))
        return { status: "error" as const, error: "故事不存在或无权访问" };
      return withVisualEditServiceLock(input.storyId, ctx.user.id, async () => {
        const activation = activateVisualEditSession({
          ...input,
          userId: ctx.user.id,
        });
        if (activation.status === "ok" && activation.replacedEpoch) {
          const retired = {
            storyId: input.storyId,
            userId: ctx.user.id,
            editorSessionEpoch: activation.replacedEpoch,
          };
          retireStoryVisualClipboardScope(retired);
          retireVisualEditUndoScope(retired);
        }
        return activation;
      });
    }),

  pasteStoryVisualObject: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          operation: visualEditOperationSchema,
          clipboardId: z.string().min(1).max(160),
          targetFrame: z.number().int().nonnegative(),
          targetLayer: z.number().int().nonnegative(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      pasteStoryVisualObject({ ...input, userId: ctx.user.id })
    ),

  deleteStoryVisualShot: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          operation: visualEditOperationSchema,
          stableShotId: z.string().min(1).max(240),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      deleteStoryVisualShot({ ...input, userId: ctx.user.id })
    ),

  splitStoryVisualShot: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          operation: visualEditOperationSchema,
          stableShotId: z.string().min(1).max(240),
          cutFrame: z.number().int().nonnegative(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      splitStoryVisualShot({ ...input, userId: ctx.user.id })
    ),

  undoVisualEditReceipt: protectedProcedure
    .input(
      z
        .object({
          storyId: z.number().int().positive(),
          operation: visualEditOperationSchema,
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      undoVisualEditForStory({ ...input, userId: ctx.user.id })
    ),

  undoVisualEdit: protectedProcedure
    .input(z.object({ storyId: z.number() }))
    .mutation(async ({ ctx, input }) =>
      undoVisualEditForStory({
        storyId: input.storyId,
        userId: ctx.user.id,
      })
    ),

  /** 改一段视频的入出点、速度、音量与构图；带 clipId 时改的是镜头内部片段。 */
  updateVideoEdit: protectedProcedure
    .input(
      z.object({
        storyId: z.number(),
        stableShotId: z.string().min(1).max(240),
        takeId: z.number().int().positive(),
        clipId: z.string().min(1).max(240).nullable().optional(),
        sourceStartSec: z.number().min(0),
        sourceEndSec: z.number().positive(),
        effects: z.object({
          playbackRate: z.number().min(0.25).max(4),
          reverse: z.boolean(),
          volume: z.number().min(0).max(2),
          muted: z.boolean(),
          motionPreset: z
            .object({
              kind: z.literal("heartbeat"),
              bpm: z.number().min(36).max(180),
              scaleAmount: z.number().min(0.01).max(0.16),
            })
            .nullable()
            .optional(),
        }),
        transform: z.object({
          cropX: z.number().min(0).max(1),
          cropY: z.number().min(0).max(1),
          cropWidth: z.number().min(0.01).max(1),
          cropHeight: z.number().min(0.01).max(1),
          zoom: z.number().min(0.25).max(8),
          panX: z.number().min(-1).max(1),
          panY: z.number().min(-1).max(1),
          rotationDeg: z.number().min(-180).max(180).optional(),
          flipX: z.boolean().optional(),
          flipY: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { storyId, ...edit } = input;
      return updateVideoEditForStory({
        storyId,
        userId: ctx.user.id,
        edit,
      });
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
        visualAssetCostConfirmation: z
          .object({
            accepted: z.literal(true),
            estimatedCny: z.number().nonnegative(),
            fingerprint: z.string().min(1).max(128),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // projectId 会被喂进 renderGate 去捞该项目的编辑偏好与聊天修正，是访问键
      // 而不是标签；不校验归属就会把别人项目的文字带进本次出图提示词。
      await assertOptionalProjectOwner(input.projectId, ctx.user.id);
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
        visualAssetCostConfirmation: input.visualAssetCostConfirmation,
        // 锁定配方优先；未锁定时由统一美术工程按文本信号选择艺术谱系。
        artDirection: storyArtRecipe(story),
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
      // getProjectImageAssets 内部已经 getProjectById 校验过归属，这里再显式挡一道：
      // 让"收 projectId 的 procedure 必须自证归属"这条不变量在本文件里没有例外，
      // 静态守卫也就不需要为它开豁免口子。
      await assertOptionalProjectOwner(input.projectId, ctx.user.id);
      const assets = await getProjectImageAssets(input.projectId, ctx.user.id);
      if (!assets.some(asset => asset.id === input.imageId)) {
        return { success: false as const };
      }
      await reassignImage(input.imageId, input.newShotNo);
      return { success: true };
    }),

  /** Point selection needs SAM; lasso selection can also use the vision contour fallback. */
  maskSelectionCapabilities: protectedProcedure.query(() => ({
    automaticObjectSelection: Boolean(ENV.falApiKey),
    semanticRegionSelection: semanticObjectSelectionConfigured(),
  })),

  segment: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        imageId: z.number().int().positive(),
        x: z.number().finite().min(0).max(32_768),
        y: z.number().finite().min(0).max(32_768),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [story, image] = await Promise.all([
        getStoryById(input.storyId, ctx.user.id),
        getGeneratedImageById(input.imageId),
      ]);
      if (
        !story ||
        !image ||
        image.storyId !== input.storyId ||
        image.userId !== ctx.user.id
      ) {
        return { status: "error" as const, message: "图片不存在或无权操作" };
      }
      return runSponsoredSegmentation({
        userId: ctx.user.id,
        storyId: input.storyId,
        imageId: input.imageId,
        x: input.x,
        y: input.y,
        task: () =>
          segmentAtPoint(image.imageUrl, input.x, input.y, {
            scope: {
              userId: ctx.user.id,
              storyId: input.storyId,
              imageId: input.imageId,
            },
          }),
      });
    }),

  segmentRegion: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        imageId: z.number().int().positive(),
        points: z.array(z.object({
          x: z.number().finite().min(0).max(32_768),
          y: z.number().finite().min(0).max(32_768),
        })).min(3).max(512),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [story, image] = await Promise.all([
        getStoryById(input.storyId, ctx.user.id),
        getGeneratedImageById(input.imageId),
      ]);
      if (
        !story ||
        !image ||
        image.storyId !== input.storyId ||
        image.userId !== ctx.user.id
      ) {
        return { status: "error" as const, message: "图片不存在或无权操作" };
      }
      const center = input.points.reduce(
        (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
        { x: 0, y: 0 }
      );
      return runSponsoredSegmentation({
        userId: ctx.user.id,
        storyId: input.storyId,
        imageId: input.imageId,
        x: center.x / input.points.length,
        y: center.y / input.points.length,
        task: () => segmentWithinPolygon(image.imageUrl, input.points, {
          scope: {
            userId: ctx.user.id,
            storyId: input.storyId,
            imageId: input.imageId,
          },
        }),
      });
    }),

  latestInpaintCandidate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        sourceImageId: z.number().int().positive(),
        targetKind: z.enum(["shot-primary", "timeline-image-clip"]),
        stableShotId: z.string().trim().min(1).max(240),
        clipId: z.string().trim().min(1).max(240).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const [story, source] = await Promise.all([
        getStoryById(input.storyId, ctx.user.id),
        getGeneratedImageById(input.sourceImageId),
      ]);
      if (
        !story ||
        !source ||
        source.storyId !== input.storyId ||
        source.userId !== ctx.user.id ||
        !(await previewMaskedImageTargetIsCurrent({
          storyId: input.storyId,
          userId: ctx.user.id,
          imageId: input.sourceImageId,
          targetKind: input.targetKind,
          stableShotId: input.stableShotId,
          clipId: input.clipId ?? null,
        }))
      ) {
        return { status: "ok" as const, candidate: null };
      }
      const receipt = await getLatestSucceededPreviewMaskedImageOperationForTarget({
        storyId: input.storyId,
        userId: ctx.user.id,
        sourceImageId: input.sourceImageId,
        targetKind: input.targetKind,
        stableShotId: input.stableShotId,
        clipId: input.clipId ?? null,
      });
      if (!receipt?.candidateImageId) {
        return { status: "ok" as const, candidate: null };
      }
      const candidate = await getGeneratedImageById(receipt.candidateImageId);
      if (
        !candidate ||
        candidate.storyId !== input.storyId ||
        candidate.userId !== ctx.user.id ||
        candidate.parentImageId !== source.id ||
        candidate.isCurrent
      ) {
        return { status: "ok" as const, candidate: null };
      }
      return {
        status: "ok" as const,
        candidate: { imageId: candidate.id, imageUrl: candidate.imageUrl },
      };
    }),

  quoteInpaint: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        imageId: z.number().int().positive(),
        maskKey: z.string().trim().min(1).max(512),
        prompt: z.string().trim().min(1).max(2_000),
        targetKind: z.enum(["shot-primary", "timeline-image-clip"]),
        stableShotId: z.string().trim().min(1).max(240),
        clipId: z.string().trim().min(1).max(240).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [story, image] = await Promise.all([
        getStoryById(input.storyId, ctx.user.id),
        getGeneratedImageById(input.imageId),
      ]);
      const expectedMaskPrefix = `masks/${ctx.user.id}/${input.storyId}/${input.imageId}/`;
      if (
        !story ||
        !image ||
        image.storyId !== input.storyId ||
        image.userId !== ctx.user.id ||
        !input.maskKey.startsWith(expectedMaskPrefix) ||
        !input.maskKey.endsWith("-edit.png") ||
        (input.targetKind === "timeline-image-clip" && !input.clipId)
      ) {
        return { status: "error" as const, message: "底图或选区不存在或无权操作" };
      }
      if (
        !(await previewMaskedImageTargetIsCurrent({
          storyId: input.storyId,
          userId: ctx.user.id,
          imageId: input.imageId,
          targetKind: input.targetKind,
          stableShotId: input.stableShotId,
          clipId: input.clipId ?? null,
        }))
      ) {
        return { status: "error" as const, message: "当前图片目标已经变化，请重新点选" };
      }
      return {
        status: "ok" as const,
        quote: quotePreviewMaskedImageEdit({
          ...input,
          userId: ctx.user.id,
        }),
      };
    }),

  /** Paid 302 masked edit. The signed quote and durable receipt are mandatory. */
  inpaint: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        imageId: z.number().int().positive(),
        maskKey: z.string().trim().min(1).max(512),
        prompt: z.string().trim().min(1).max(2_000),
        operationToken: z.string().trim().min(8).max(160),
        targetKind: z.enum(["shot-primary", "timeline-image-clip"]),
        stableShotId: z.string().trim().min(1).max(240),
        clipId: z.string().trim().min(1).max(240).optional(),
        confirmation: z.object({
          quoteId: z.string().regex(/^[a-f0-9]{64}$/),
          storyId: z.number().int().positive(),
          imageId: z.number().int().positive(),
          maskKey: z.string().trim().min(1).max(512),
          targetKind: z.enum(["shot-primary", "timeline-image-clip"]),
          stableShotId: z.string().trim().min(1).max(240),
          clipId: z.string().trim().min(1).max(240).nullable().optional(),
          inputHash: z.string().regex(/^[a-f0-9]{64}$/),
          currency: z.literal("CNY"),
          estimatedCny: z.number().nonnegative(),
          candidateCount: z.literal(1),
          expiresAt: z.number().int().positive(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [story, image] = await Promise.all([
        getStoryById(input.storyId, ctx.user.id),
        getGeneratedImageById(input.imageId),
      ]);
      const expectedMaskPrefix = `masks/${ctx.user.id}/${input.storyId}/${input.imageId}/`;
      if (
        !story ||
        !image ||
        image.storyId !== input.storyId ||
        image.userId !== ctx.user.id ||
        !input.maskKey.startsWith(expectedMaskPrefix) ||
        !input.maskKey.endsWith("-edit.png") ||
        (input.targetKind === "timeline-image-clip" && !input.clipId)
      ) {
        return { status: "error" as const, message: "底图或选区不存在或无权操作" };
      }
      const target = {
        targetKind: input.targetKind,
        stableShotId: input.stableShotId,
        clipId: input.clipId ?? null,
      };
      if (
        !(await previewMaskedImageTargetIsCurrent({
          storyId: input.storyId,
          userId: ctx.user.id,
          imageId: input.imageId,
          ...target,
        }))
      ) {
        return { status: "error" as const, message: "当前图片目标已经变化，请重新确认费用" };
      }
      if (
        !previewMaskedImageQuoteIsValid({
          quote: input.confirmation,
          storyId: input.storyId,
          userId: ctx.user.id,
          imageId: input.imageId,
          maskKey: input.maskKey,
          prompt: input.prompt,
          ...target,
        })
      ) {
        return { status: "error" as const, message: "报价已过期或修改内容已变化，请重新确认费用" };
      }
      const inputHash = previewMaskedImageInputHash({
        storyId: input.storyId,
        userId: ctx.user.id,
        imageId: input.imageId,
        maskKey: input.maskKey,
        prompt: input.prompt,
        ...target,
      });
      return runPreviewMaskedImageOperation({
        operationToken: `${ctx.user.id}:${input.storyId}:${input.operationToken}`,
        inputHash,
        task: async () => {
          if (
            !(await previewMaskedImageTargetIsCurrent({
              storyId: input.storyId,
              userId: ctx.user.id,
              imageId: input.imageId,
              ...target,
            }))
          ) {
            return { status: "error" as const, message: "当前图片目标已经变化，请重新确认费用" };
          }
          const claim = await claimPreviewMaskedImageOperation({
            storyId: input.storyId,
            userId: ctx.user.id,
            operationToken: input.operationToken,
            inputHash,
            sourceImageId: image.id,
            maskKey: input.maskKey,
            ...target,
            quoteId: input.confirmation.quoteId,
            currency: input.confirmation.currency,
            estimatedCny: input.confirmation.estimatedCny,
            quoteExpiresAt: new Date(input.confirmation.expiresAt),
          });
          if (!claim.acquired) {
            if (claim.operation.status === "succeeded" && claim.operation.candidateImageId) {
              const replay = await getGeneratedImageById(claim.operation.candidateImageId);
              if (replay) return { status: "ok" as const, image: replay };
            }
            if (
              claim.operation.status === "provider_accepted" &&
              claim.operation.providerTaskId
            ) {
              try {
                const resumed = await resume302GptImageTask(
                  claim.operation.providerTaskId
                );
                if (resumed.status === "ok" && resumed.imageUrl) {
                  const settled = await settlePreviewMaskedImageOperationSuccess({
                    storyId: input.storyId,
                    userId: ctx.user.id,
                    operationToken: input.operationToken,
                    claimToken: claim.operation.claimToken,
                    image: {
                      projectId: image.projectId,
                      storyId: input.storyId,
                      userId: ctx.user.id,
                      shotNo: image.shotNo,
                      shotIdentity: image.shotIdentity,
                      imageKey: resumed.imageKey ?? `inpaint-${Date.now()}`,
                      imageUrl: resumed.imageUrl,
                      prompt: input.prompt,
                      promptCompilationId: image.promptCompilationId,
                      parentImageId: image.id,
                      generationType: "inpaint",
                      maskKey: input.maskKey,
                      isCurrent: false,
                    },
                  });
                  return { status: "ok" as const, image: settled.image };
                }
              } catch {
                // Keep the accepted receipt protected. A recovery poll must
                // never make a second paid submission possible.
              }
            }
            return {
              status: "error" as const,
              message:
                claim.operation.status === "failed"
                  ? "这次局部修改已明确失败，请重新确认费用后再试"
                  : "这次付费提交正在处理或状态未知，系统不会重复提交",
              submissionUncertain: claim.operation.status !== "failed",
              ...(claim.operation.providerTaskId
                ? { providerTaskId: claim.operation.providerTaskId }
                : {}),
            };
          }
          try {
            const maskUrl = await resolveStoredMaskUrl(input.maskKey);
            const result = await editMobileImage(image.imageUrl, input.prompt, {
              provider: "gpt-image",
              editMaskImageUrl: maskUrl,
              onProviderTaskAccepted: taskId =>
                markPreviewMaskedImageOperationAccepted({
                  storyId: input.storyId,
                  userId: ctx.user.id,
                  operationToken: input.operationToken,
                  claimToken: claim.operation.claimToken,
                  providerTaskId: taskId,
                }).then(() => undefined),
            });
            if (result.status === "error" || !result.imageUrl) {
              await failPreviewMaskedImageOperation({
                storyId: input.storyId,
                userId: ctx.user.id,
                operationToken: input.operationToken,
                claimToken: claim.operation.claimToken,
                errorCode: result.submissionUncertain || result.providerTaskId
                  ? "provider_submission_unknown"
                  : "provider_failed",
                ...(result.providerTaskId ? { providerTaskId: result.providerTaskId } : {}),
                ...(result.submissionUncertain ? { submissionUncertain: true } : {}),
              });
              return {
                status: "error" as const,
                message: result.message ?? "局部图片生成没有返回结果",
                ...(result.providerTaskId ? { providerTaskId: result.providerTaskId } : {}),
                ...(result.submissionUncertain ? { submissionUncertain: true } : {}),
              };
            }
            const settled = await settlePreviewMaskedImageOperationSuccess({
              storyId: input.storyId,
              userId: ctx.user.id,
              operationToken: input.operationToken,
              claimToken: claim.operation.claimToken,
              image: {
                projectId: image.projectId,
                storyId: input.storyId,
                userId: ctx.user.id,
                shotNo: image.shotNo,
                shotIdentity: image.shotIdentity,
                imageKey: result.imageKey ?? `inpaint-${Date.now()}`,
                imageUrl: result.imageUrl,
                prompt: input.prompt,
                promptCompilationId: image.promptCompilationId,
                parentImageId: image.id,
                generationType: "inpaint",
                maskKey: input.maskKey,
                isCurrent: false,
              },
            });
            return { status: "ok" as const, image: settled.image };
          } catch (error) {
            await failPreviewMaskedImageOperation({
              storyId: input.storyId,
              userId: ctx.user.id,
              operationToken: input.operationToken,
              claimToken: claim.operation.claimToken,
              errorCode: "masked_edit_internal_error",
              submissionUncertain: true,
            });
            return {
              status: "error" as const,
              message: error instanceof Error ? error.message : "局部图片修改失败",
              submissionUncertain: true,
            };
          }
        },
      });
    }),

  adoptInpaintCandidate: protectedProcedure
    .input(
      z.object({
        storyId: z.number().int().positive(),
        candidateImageId: z.number().int().positive(),
        expectedSourceImageId: z.number().int().positive(),
        targetKind: z.enum(["shot-primary", "timeline-image-clip"]),
        stableShotId: z.string().trim().min(1).max(240),
        clipId: z.string().trim().min(1).max(240).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [story, candidate, source] = await Promise.all([
        getStoryById(input.storyId, ctx.user.id),
        getGeneratedImageById(input.candidateImageId),
        getGeneratedImageById(input.expectedSourceImageId),
      ]);
      if (
        !story ||
        !candidate ||
        !source ||
        candidate.storyId !== input.storyId ||
        candidate.userId !== ctx.user.id ||
        candidate.parentImageId !== source.id ||
        candidate.generationType !== "inpaint" ||
        !candidate.maskKey ||
        source.storyId !== input.storyId ||
        source.userId !== ctx.user.id
      ) {
        return { status: "error" as const, message: "候选或原图不存在或无权操作" };
      }
      const receipt = await getSucceededPreviewMaskedImageOperationForCandidate({
        storyId: input.storyId,
        userId: ctx.user.id,
        candidateImageId: candidate.id,
      });
      if (
        !receipt ||
        receipt.sourceImageId !== source.id ||
        receipt.targetKind !== input.targetKind ||
        receipt.stableShotId !== input.stableShotId ||
        receipt.clipId !== (input.clipId ?? null)
      ) {
        return { status: "error" as const, message: "候选不属于当前图片目标，请重新审阅" };
      }
      if (input.targetKind === "timeline-image-clip") {
        if (!input.clipId) {
          return { status: "error" as const, message: "缺少时间线图片剪辑身份" };
        }
        const replaced = await replaceVisualImageClipImageForStory({
          storyId: input.storyId,
          userId: ctx.user.id,
          stableShotId: input.stableShotId,
          clipId: input.clipId,
          expectedImageId: source.id,
          replacementImageId: candidate.id,
        });
        return replaced.status === "ok"
          ? { status: "ok" as const, imageId: candidate.id }
          : { status: "error" as const, message: replaced.error };
      }
      if (!source.isCurrent || source.shotIdentity !== input.stableShotId) {
        return { status: "error" as const, message: "当前主图已经变化，请重新审阅候选" };
      }
      const promoted = await promoteStoryImageToCurrent({
        storyId: input.storyId,
        userId: ctx.user.id,
        imageId: candidate.id,
        expectedCurrentImageId: source.id,
        // 用户点「采纳」这张局部重绘结果。
        adoption: signalId =>
          imageAdoptionCaptureIfEnabled({
            userId: ctx.user.id,
            storyId: input.storyId,
            imageId: candidate.id,
            signalId,
            context: {
              entry: "adopt_inpaint_candidate",
              display: { parentImageId: source.id },
            },
          }),
        metadata: {
          source: "preview_object_mask_edit",
          parentImageId: source.id,
          maskKey: candidate.maskKey,
        },
      });
      return promoted
        ? { status: "ok" as const, imageId: candidate.id }
        : { status: "error" as const, message: "候选采用失败" };
    }),
});
