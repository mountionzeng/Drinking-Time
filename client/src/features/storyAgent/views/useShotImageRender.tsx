import { toast } from "sonner";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import type { PromptRow } from "@/features/creationEditor/promptTable/types";
import type { StoryMaterialState } from "@shared/storyMaterial";
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
      imageProvider: "gpt-image";
      reference: { selection: ShotImageRenderSettings["references"] };
      costConfirmation: { accepted: true; estimatedCny: number };
    }) => Promise<{ imageId?: number; imageUrl?: string }>;
  }) => {
    const scope = imageBatchScope.current;
    const { label, settings, shot, material } = input;
    const choices = material ? shotRenderReferenceOptions(material) : [];
    const chosen = selectedReferenceKeys(settings.references).map(key =>
      choices.find(choice => choice.key === key)
    );
    const issue = !shot.promptDraft?.trim()
      ? "请先填写图片要求"
      : !material || chosen.some(choice => !choice)
        ? "参考素材尚未加载或已失效，请重新选择参考"
        : null;
    if (issue) {
      setImageRenderError(issue);
      return { status: "error" as const, message: issue };
    }
    const names = chosen.map(choice => choice!.label);
    const instruction = storyboardExplicitImageInstruction(shot);
    const rows = buildPromptTable(shot, { previousShots: input.previousShots });
    const quote = quoteShotImages(settings.count);
    const confirmed = await confirmImageCost(
      `${label} · 生成 ${settings.count} 张独立图片\n参考素材：${names.join("、") || "无"}\n\n${instruction}\n\n预计总费用 ¥${quote.estimatedCny.toFixed(2)}（每张约 ¥${quote.unitCny.toFixed(2)}，最终按实际用量）。中途失败即停止，已完成的图片保留。`
    );
    if (!confirmed || scope !== imageBatchScope.current || !input.canStart())
      return { status: "cancelled" as const, message: "已取消，未提交生成" };
    input.start();
    try {
      const batch = await renderShotImageBatch(settings.count, async () => {
        if (scope !== imageBatchScope.current)
          throw new Error("已离开当前故事，未提交后续图片");
        const image = await input.generate({
          shotNo: shot.shotNo,
          rows,
          explicitInstruction: instruction,
          imageProvider: "gpt-image",
          reference: { selection: settings.references },
          costConfirmation: { accepted: true, estimatedCny: quote.unitCny },
        });
        if (!image.imageId || !image.imageUrl)
          throw new Error("服务端未返回图片，停止后续生成");
        return image;
      });
      if (scope !== imageBatchScope.current)
        return {
          status: "cancelled" as const,
          message: "已离开当前故事，停止后续生成",
        };
      if (batch.error)
        throw new Error(
          `${label} 已生成 ${batch.results.length}/${settings.count} 张，剩余任务已停止。${batch.error}`
        );
      const message = `${label} 已生成 ${batch.results.length} 张图片，已放入画面行`;
      toast.success(message);
      return {status: "success" as const, message};
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
