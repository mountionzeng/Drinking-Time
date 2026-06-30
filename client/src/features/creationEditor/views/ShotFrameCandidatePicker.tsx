import * as React from "react";
import { useEffect, useState } from "react";
import { Check, Loader2, Maximize2, ScanLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CreationEditorShot } from "../CreationEditorContext";
import type { FrameCandidateSource } from "../frameCandidate";
import {
  cropFrameQuadrant,
  FRAME_QUADRANTS,
  type FrameQuadrant,
} from "../video/frameCrop";

type Props = {
  shot: CreationEditorShot;
  candidate?: FrameCandidateSource;
  compareOpen?: boolean;
  onCompareOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  onPromote: (input: {
    shotNo: number;
    imageBase64: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    parentImageId?: number;
    quadrant?: FrameQuadrant;
  }) => Promise<{ imageId: number; imageUrl: string }>;
};

function quadrantImageStyle(quadrant: FrameQuadrant): React.CSSProperties {
  const right = quadrant === "top-right" || quadrant === "bottom-right";
  const bottom = quadrant === "bottom-left" || quadrant === "bottom-right";
  return {
    width: "200%",
    height: "200%",
    maxWidth: "none",
    left: right ? "-100%" : "0",
    top: bottom ? "-100%" : "0",
  };
}

export default function ShotFrameCandidatePicker({
  shot,
  candidate,
  compareOpen: controlledCompareOpen,
  onCompareOpenChange,
  disabled = false,
  onPromote,
}: Props) {
  const candidateUrl = candidate?.imageUrl ?? shot.promptRun?.imageUrl;
  const candidateImageId = candidate?.imageId ?? shot.promptRun?.imageId;
  const candidateLabel = candidate?.label ?? "最新生成";
  const [busyQuadrant, setBusyQuadrant] = useState<FrameQuadrant | null>(null);
  const [selectedQuadrant, setSelectedQuadrant] =
    useState<FrameQuadrant | null>(null);
  const [internalCompareOpen, setInternalCompareOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compareOpen = controlledCompareOpen ?? internalCompareOpen;
  const setCompareOpen = (open: boolean) => {
    setInternalCompareOpen(open);
    onCompareOpenChange?.(open);
  };

  useEffect(() => {
    setBusyQuadrant(null);
    setSelectedQuadrant(null);
    setError(null);
  }, [candidateImageId, candidateUrl]);

  if (!candidateUrl) return null;

  const selectCandidate = async (quadrant: FrameQuadrant) => {
    setError(null);
    setBusyQuadrant(quadrant);
    try {
      const cropped = await cropFrameQuadrant(candidateUrl, quadrant);
      await onPromote({
        shotNo: shot.shotNo,
        imageBase64: cropped.imageBase64,
        mimeType: cropped.mimeType,
        parentImageId: candidateImageId,
        quadrant,
      });
      setSelectedQuadrant(quadrant);
      setCompareOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "候选主图保存失败");
    } finally {
      setBusyQuadrant(null);
    }
  };

  const candidateGrid = (large: boolean) => (
    <div
      className={`grid grid-cols-2 ${large ? "gap-4" : "gap-2"}`}
      aria-label={`${candidateLabel}的四张候选图`}
    >
      {FRAME_QUADRANTS.map(item => {
        const busy = busyQuadrant === item.value;
        const selected = selectedQuadrant === item.value;
        return (
          <button
            key={item.value}
            type="button"
            data-frame-candidate={item.value}
            disabled={disabled || busyQuadrant != null}
            onClick={() => void selectCandidate(item.value)}
            aria-label={`选择${item.label}作为当前主图`}
            className="group relative min-w-0 overflow-hidden rounded-md border border-border bg-muted text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-65"
          >
            <div className="relative aspect-video overflow-hidden bg-black/5">
              <img
                src={candidateUrl}
                alt={`${candidateLabel} ${item.label}候选图`}
                className="absolute object-fill transition-opacity group-hover:opacity-95"
                style={quadrantImageStyle(item.value)}
                loading="eager"
              />
            </div>
            <span className="flex h-9 items-center justify-between gap-2 border-t border-border bg-background px-3 text-xs">
              <span className="font-medium">{item.label}</span>
              <span className="inline-flex items-center gap-1 text-primary">
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : selected ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
                {busy ? "正在设为主图" : selected ? "已选" : "设为主图"}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <section className="border-b border-border/70 px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScanLine className="h-4 w-4 text-primary" />
          <div>
            <p className="text-xs font-semibold">从四张候选中选择当前主图</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {candidateLabel} · 选择后才进入视频阶段
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCompareOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          放大比较
        </button>
      </div>

      {candidateGrid(false)}

      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        点击其中一张会保存为独立图片，并成为这个镜头唯一的当前主图；四宫格原图只保留在版本历史里。
      </p>
      {error ? (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto p-5 sm:max-w-[min(1180px,calc(100vw-2rem))]">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base">
              选择 SH{String(shot.shotNo).padStart(2, "0")} 当前主图
            </DialogTitle>
            <DialogDescription>
              四张候选已分别放大。点击画面即可设为当前主图。
            </DialogDescription>
          </DialogHeader>
          {candidateGrid(true)}
          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
