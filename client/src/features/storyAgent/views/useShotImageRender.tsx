import { toast } from "sonner";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import type { PromptRow } from "@/features/creationEditor/promptTable/types";
import type { StoryMaterialState } from "@shared/storyMaterial";
import { STORYBOARD_IMAGE_CANDIDATE_COUNT, estimateStoryboardMaskedEditCost } from "@shared/imageRenderCost";
import {
  shotRenderReferenceOptions,
  selectedReferenceKeys,
} from "./ShotImageRenderControl";
import { storyboardExplicitImageInstruction } from "./storyboardReviewModel";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  quoteShotImages,
  renderShotImageBatch,
  type ShotImageRenderSettings,
} from "@shared/shotImageRender";

/** Owns quote dialogs and cancellation for a story's image-render session. */
export function useShotImageRender(
  storyId: number | null | undefined,
  imageConfirmationScope: string
) {
  const [imageCostConfirmation, setImageCostConfirmation] = useState<
    string | null
  >(null);
  const [imageRenderError, setImageRenderError] = useState<string | null>(null);
  const imageCostResolver = useRef<((confirmed: boolean) => void) | null>(null);
  const settleImageCostConfirmation = useCallback((confirmed: boolean) => {
    const resolve = imageCostResolver.current;
    imageCostResolver.current = null;
    setImageCostConfirmation(null);
    resolve?.(confirmed);
  }, []);
  // Cancel a pending quote when its story/shot set disappears, including unmount.
  const imageBatchScope = useRef(0);
  useEffect(() => {
    setImageCostConfirmation(null);
    setImageRenderError(null);
    return () => {
      imageBatchScope.current += 1;
      imageCostResolver.current?.(false);
      imageCostResolver.current = null;
    };
  }, [storyId, imageConfirmationScope]);
  const confirmImageCost = (message: string) =>
    new Promise<boolean>(resolve => {
      imageCostResolver.current?.(false);
      imageCostResolver.current = resolve;
      setImageCostConfirmation(message);
    });

  const render = async (input: {
    label: string;
    revisionInstruction?: string;
    revisionProvider?: "midjourney" | "gpt-image";
    /** A parent batch already confirmed the same one-task quote. */
    skipCostConfirmation?: boolean;
    settings: ShotImageRenderSettings;
    shot: CreationEditorShot;
    previousShots: CreationEditorShot[];
    material?: StoryMaterialState | null;
    canStart: () => boolean;
    start: () => void;
    finish: () => void;
    generate: (request: {
      shotNo: number;
      rows: PromptRow[];
      explicitInstruction: string;
      imageProvider: "midjourney" | "gpt-image";
      candidateCount?: 4;
      reference: { selection: ShotImageRenderSettings["references"]; referenceRevision?: boolean };
      costConfirmation: { accepted: true; estimatedCny: number };
    }) => Promise<{
      generatedCount: number;
      imageId?: number;
      imageUrl?: string;
    }>;
  }) => {
    const scope = imageBatchScope.current;
    const { label, settings, shot, material } = input;
    const isRevision = Boolean(input.revisionInstruction?.trim());
    const provider = isRevision ? input.revisionProvider ?? "midjourney" : "midjourney";
    const isGptRevision = provider === "gpt-image";
    const choices = material ? shotRenderReferenceOptions(material) : [];
    const chosen = selectedReferenceKeys(settings.references).map(key =>
      choices.find(choice => choice.key === key)
    );
    const issue =
      !input.revisionInstruction?.trim() && !shot.promptDraft?.trim()
        ? "请先填写图片要求"
        : isRevision && (settings.references.imageIds.length !== 1 || Object.keys(settings.references.assets).length !== 0)
          ? "请选中一张要修改的图片"
        : !material || chosen.some(choice => !choice)
          ? "参考素材尚未加载或已失效，请重新选择参考"
          : null;
    if (issue) {
      setImageRenderError(issue);
      return { status: "error" as const, message: issue };
    }
    const names = chosen.map(choice => choice!.label);
    const instruction = input.revisionInstruction
      ? `以所选参考图片为基础生成新版，保留未要求修改的主体与画面内容。用户修改要求：\n${input.revisionInstruction}`
      : storyboardExplicitImageInstruction(shot);
    const rows = buildPromptTable(shot, { previousShots: input.previousShots });
    // Legacy saved settings may request eight; this entry always buys one task.
    const quote = isGptRevision ? estimateStoryboardMaskedEditCost() : quoteShotImages(STORYBOARD_IMAGE_CANDIDATE_COUNT);
    const estimatedCny = quote.estimatedCny;
    const confirmed = (!isRevision && input.skipCostConfirmation) || await confirmImageCost(
      `${label} · ${isGptRevision ? "重新生成图（GPT Image 1.5）" : isRevision ? "重新生成图（MJ）" : "生成4张图（MJ）"}\n${isRevision ? "原图" : "参考素材"}：${names.join("、") || "无"}\n\n${isRevision ? input.revisionInstruction : instruction}\n\n${isGptRevision ? "按要求修改原图，返回1张新版；原图保留。\n" : isRevision ? "参考原图重绘4张候选，细节可能变化；原图保留。\n" : ""}预计费用 ¥${estimatedCny.toFixed(2)}，最终以服务商实际扣费为准。`
    );
    if (!confirmed || scope !== imageBatchScope.current || !input.canStart())
      return { status: "cancelled" as const, message: "已取消，未提交生成" };
    input.start();
    try {
      const generate = async () => {
        if (scope !== imageBatchScope.current)
          throw new Error("已离开当前故事，未提交后续图片");
        const image = await input.generate({
          shotNo: shot.shotNo,
          rows,
          explicitInstruction: instruction,
          imageProvider: provider,
          candidateCount: isRevision ? undefined : 4,
          reference: { selection: settings.references, ...(isRevision ? { referenceRevision: true } : {}) },
          costConfirmation: { accepted: true, estimatedCny },
        });
        if (!image.imageId || !image.imageUrl)
          throw new Error("服务端未返回图片，停止后续生成");
        return image;
      };
      let batch;
      if (isGptRevision) {
        const result = await generate();
        batch = { results: [result], generatedCount: result.generatedCount, error: undefined };
      } else {
        batch = await renderShotImageBatch(quote.candidateCount, generate);
      }
      if (scope !== imageBatchScope.current)
        return {
          status: "cancelled" as const,
          message: "已离开当前故事，停止后续生成",
        };
      if (batch.error)
        throw new Error(
          `${label} 已生成 ${batch.generatedCount}/${quote.candidateCount} 张，剩余任务已停止。${batch.error}`
        );
      const message = isRevision
        ? `${label} 新图已放到上方图层，全部版本已保存在仓库`
        : `${label} 已生成 ${batch.generatedCount} 张图片，已放入画面行`;
      toast.success(message);
      const last = batch.results.at(-1);
      return {
        status: "success" as const,
        message,
        imageId: last?.imageId,
        imageUrl: last?.imageUrl,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "图片生成失败";
      if (scope === imageBatchScope.current) setImageRenderError(message);
      return { status: "error" as const, message };
    } finally {
      if (scope === imageBatchScope.current) input.finish();
    }
  };
  return {
    confirmImageCost,
    setImageRenderError,
    render,
    dialogs: (
      <>
        <Dialog
          open={imageCostConfirmation !== null}
          onOpenChange={open => {
            if (!open) settleImageCostConfirmation(false);
          }}
        >
          <DialogContent className="z-[160] max-w-lg">
            <DialogHeader>
              <DialogTitle>确认图片渲染费用</DialogTitle>
              <DialogDescription className="max-h-[55vh] overflow-y-auto whitespace-pre-wrap leading-6">
                {imageCostConfirmation}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                type="button"
                className="rounded-md border px-4 py-2 text-sm"
                onClick={() => settleImageCostConfirmation(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
                onClick={() => settleImageCostConfirmation(true)}
              >
                确认费用并渲染
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={imageRenderError !== null}
          onOpenChange={open => {
            if (!open) setImageRenderError(null);
          }}
        >
          <DialogContent className="z-[160] max-w-lg">
            <DialogHeader>
              <DialogTitle>图片渲染未完成</DialogTitle>
              <DialogDescription className="whitespace-pre-wrap">
                {imageRenderError}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <button
                type="button"
                className="rounded-md border px-4 py-2 text-sm"
                onClick={() => setImageRenderError(null)}
              >
                知道了
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    ),
  };
}
