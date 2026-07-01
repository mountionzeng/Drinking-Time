import { useMemo } from "react";
import { CheckCircle2, History, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import type { PromptRevision } from "@shared/promptLineage";
import type { StoryMaterialState } from "@shared/storyMaterial";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  PromptLineageRevisionPreview,
  PromptLineageRowView,
} from "../promptLineage/viewModel";

type CandidateState = {
  kind: "candidate";
  targetScope: "shot" | "source";
  row: PromptLineageRowView;
  nextValue: string;
  nextWeight: number;
  expectedVersion: number;
  candidateRevisionId: number;
  preview: PromptLineageRevisionPreview;
};

type RestoreState = {
  kind: "restore";
  row: PromptLineageRowView;
  revision: PromptRevision;
  expectedVersion: number;
  preview: PromptLineageRevisionPreview;
};

export type PromptRevisionDialogState = CandidateState | RestoreState;

type Props = {
  open: boolean;
  state: PromptRevisionDialogState | null;
  materialState: StoryMaterialState | null;
  pending?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

const MODALITY_LABELS = {
  dialogue: "台词",
  image: "图片",
  video: "视频",
} as const;

function formatTargets(
  preview: PromptLineageRevisionPreview["shots"][number],
  mode: "current" | "proposed",
) {
  return preview.impactedModalities
    .map(modality => {
      const payload =
        mode === "current" ? preview.current[modality] : preview.proposed[modality];
      return `# ${MODALITY_LABELS[modality]}\n${payload.finalText || "暂无"}`;
    })
    .join("\n\n");
}

function shotLabel(materialState: StoryMaterialState | null, stableShotId: string) {
  const shot = materialState?.shots.find(item => item.stableShotId === stableShotId);
  return shot ? `SH${String(shot.shotNo).padStart(2, "0")}` : stableShotId;
}

function materialSummary(materialState: StoryMaterialState | null, stableShotId: string) {
  const shot = materialState?.shots.find(item => item.stableShotId === stableShotId);
  if (!shot) return "暂无素材";
  const image = shot.currentImage ? "有主图" : "无主图";
  const video = shot.currentVideo ? "已采用视频" : "无采用视频";
  return `${image} / ${video}`;
}

export default function PromptRevisionDialog({
  open,
  state,
  materialState,
  pending = false,
  error = null,
  onOpenChange,
  onConfirm,
}: Props) {
  const impactedShots = useMemo(
    () =>
      state?.preview.shots.filter(shot => shot.impactedModalities.length > 0) ?? [],
    [state],
  );

  if (!state) return null;

  const title =
    state.kind === "candidate"
      ? `预览 ${state.row.label} 的影响`
      : `恢复 ${state.row.label} 的历史版本`;
  const description =
    state.kind === "candidate"
      ? state.targetScope === "shot"
        ? "这次修改只在当前镜头建立局部分支。先看影响，再决定是否正式写入。"
        : "这次修改沿用节点原有共享范围，可能影响其他镜头。请确认影响后再写入。"
      : "恢复不会自动重渲素材，但会立刻刷新过期状态。";
  const currentValue = state.row.value.trim() || "暂无内容";
  const nextValue =
    state.kind === "candidate"
      ? state.nextValue.trim() || "清空"
      : state.revision.content.trim() || "清空";
  const currentWeight = Math.round(state.row.weight * 100);
  const nextWeight = Math.round(
    (state.kind === "candidate" ? state.nextWeight : state.revision.weight) *
      100,
  );
  const confirmLabel = state.kind === "candidate" ? "确认修改" : "恢复这一版";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {state.kind === "candidate" ? (
              <Sparkles className="h-4 w-4 text-primary" />
            ) : (
              <History className="h-4 w-4 text-primary" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
            <div className="text-xs font-semibold text-foreground">当前版本</div>
            <div className="rounded-md border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground">
              {currentValue}
            </div>
            <div className="text-[11px] text-muted-foreground">
              当前权重：{currentWeight}%
            </div>
          </section>
          <section className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-3">
            <div className="text-xs font-semibold text-foreground">
              {state.kind === "candidate" ? "候选内容" : "将要恢复"}
            </div>
            <div className="rounded-md border border-primary/20 bg-background px-3 py-2 text-sm leading-6 text-foreground">
              {nextValue}
            </div>
            <div className="text-[11px] text-muted-foreground">
              变更后权重：{nextWeight}%
            </div>
          </section>
        </div>

        <section className="space-y-3 rounded-md border border-border/70 bg-background p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <TriangleAlert className="h-4 w-4 text-amber-600" />
            影响范围
          </div>
          {impactedShots.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              这次改动不会改变任何已确认的台词 / 图片 / 视频编译结果。
            </div>
          ) : (
            <div className="space-y-3">
              {impactedShots.map(shot => (
                <article
                  key={shot.stableShotId}
                  className="rounded-md border border-border/70 bg-muted/20 p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">
                      {shotLabel(materialState, shot.stableShotId)}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {shot.impactedModalities.map(modality => (
                        <span
                          key={`${shot.stableShotId}-${modality}`}
                          className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                        >
                          {MODALITY_LABELS[modality]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mb-2 text-[11px] text-muted-foreground">
                    当前素材：{materialSummary(materialState, shot.stableShotId)}
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    <div className="rounded-md border border-border bg-background p-2">
                      <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                        当前编译
                      </div>
                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-foreground">
                        {formatTargets(shot, "current") || "暂无"}
                      </pre>
                    </div>
                    <div className="rounded-md border border-primary/20 bg-background p-2">
                      <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                        变更后编译
                      </div>
                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-foreground">
                        {formatTargets(shot, "proposed") || "暂无"}
                      </pre>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
