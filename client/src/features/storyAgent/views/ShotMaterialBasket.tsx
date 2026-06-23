import { Loader2, Video } from "lucide-react";
import type { CreationEditorShot } from "@/features/creationEditor/CreationEditorContext";
import { buildPromptTable } from "@/features/creationEditor/promptTable/buildPromptTable";
import { compileVideoShotRecipe } from "@/features/creationEditor/promptTable/videoRecipe";
import { videoTakeAffordance } from "@/features/creationEditor/videoAssetViewModel";
import type { ShotVideoProviderStatus } from "@shared/videoAsset";

function compactSnapshot(snapshot: Record<string, unknown> | null | undefined) {
  if (!snapshot) return "";
  const model = typeof snapshot.model === "string" ? snapshot.model : "";
  const duration =
    typeof snapshot.durationSec === "number" ? `${snapshot.durationSec}s` : "";
  const aspect =
    typeof snapshot.aspectRatio === "string" ? snapshot.aspectRatio : "";
  return [model, duration, aspect].filter(Boolean).join(" · ");
}

function shotLabel(shot: CreationEditorShot) {
  return shot.shotKey || `SH${String(shot.shotNo).padStart(2, "0")}`;
}

type ShotMaterialBasketProps = {
  shot: CreationEditorShot;
  previousShots: CreationEditorShot[];
  generating: boolean;
  onGenerateShotVideo?: (input: {
    shotNo: number;
    imageId: number;
    prompt: string;
    subtitle?: string;
    durationSec?: number;
  }) => Promise<unknown>;
  onRefreshShotVideoStatus?: (takeId: number) => Promise<void>;
  shotVideoProviderStatus?: ShotVideoProviderStatus | null;
};

export default function ShotMaterialBasket({
  shot,
  previousShots,
  generating,
  onGenerateShotVideo,
  onRefreshShotVideoStatus,
  shotVideoProviderStatus = null,
}: ShotMaterialBasketProps) {
  const rows = buildPromptTable(shot, { previousShots });
  const recipe = compileVideoShotRecipe({ shot, rows });
  const hasTraceableKeyframe = typeof shot.imageId === "number";
  const hasSelectedKeyframe = shot.imageSelectionSource === "explicit";
  const missing = [
    ...recipe.missing,
    ...(recipe.sourceImageUrl && !hasTraceableKeyframe ? ["可追踪首帧"] : []),
    ...(recipe.sourceImageUrl && hasTraceableKeyframe && !hasSelectedKeyframe
      ? ["已选首帧"]
      : []),
  ];
  const providerMissing = shotVideoProviderStatus?.missing ?? [];
  const providerWarnings = shotVideoProviderStatus?.warnings ?? [];
  const providerReady = shotVideoProviderStatus?.ready ?? false;
  const canGenerate =
    hasTraceableKeyframe &&
    hasSelectedKeyframe &&
    missing.length === 0 &&
    providerReady &&
    Boolean(onGenerateShotVideo);
  const processingTake = shot.videoTakes?.find(take =>
    ["submitted", "processing"].includes(take.status)
  );
  const latestTake = shot.videoTakes?.[0];

  const generate = async () => {
    if (!canGenerate || shot.imageId == null) return;
    await onGenerateShotVideo?.({
      shotNo: shot.shotNo,
      imageId: shot.imageId,
      prompt: recipe.finalPrompt,
      subtitle: shot.dialogue || undefined,
      durationSec: Math.max(
        3,
        Math.min(10, Math.round((shot.durationMs ?? 5000) / 1000))
      ),
    });
  };

  return (
    <div
      className="mt-2 rounded-md border p-2"
      style={{
        borderColor: "var(--panel-border)",
        background: "var(--panel-header)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Video className="h-3.5 w-3.5 text-nayin-bright" />
          <span className="text-[9px] font-semibold text-foreground">
            镜头素材篮
          </span>
        </div>
        <button
          type="button"
          disabled={generating || (!canGenerate && !processingTake)}
          onClick={() => {
            if (processingTake) {
              void onRefreshShotVideoStatus?.(processingTake.id);
              return;
            }
            void generate();
          }}
          className="flex h-7 items-center gap-1 rounded-md border px-2 text-[9px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          style={{ borderColor: "var(--panel-border)" }}
        >
          {generating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Video className="h-3 w-3" />
          )}
          {processingTake
            ? "刷新视频"
            : generating
              ? "提交中"
              : !providerReady
                ? "配置模型"
                : "生成视频"}
        </button>
      </div>
      <div className="mt-2 grid gap-1.5 text-[9px] text-muted-foreground sm:grid-cols-2">
        <div
          className="rounded-md border px-2 py-1.5"
          style={{ borderColor: "var(--panel-border)" }}
        >
          首帧：
          {hasTraceableKeyframe
            ? hasSelectedKeyframe
              ? `已选 image #${shot.imageId}`
              : "候选图待选择"
            : recipe.sourceImageUrl
              ? "候选图待确认"
              : "缺失"}
        </div>
        <div
          className="rounded-md border px-2 py-1.5"
          style={{ borderColor: "var(--panel-border)" }}
        >
          视频包：
          {missing.length > 0 ? `还缺 ${missing.join(" / ")}` : "可提交"}
        </div>
        <div
          className="rounded-md border px-2 py-1.5 sm:col-span-2"
          style={{ borderColor: "var(--panel-border)" }}
        >
          后端：
          {!shotVideoProviderStatus
            ? "检查配置中"
            : providerMissing.length > 0
              ? `缺 ${providerMissing.join(" / ")}`
              : providerWarnings.length > 0
                ? `可提交；提醒 ${providerWarnings.join(" / ")} 未配置`
                : `302 ${shotVideoProviderStatus.model}`}
        </div>
      </div>
      {latestTake ? (
        <div className="mt-2 space-y-1.5">
          {shot.videoTakes?.slice(0, 3).map(take => {
            const affordance = videoTakeAffordance(take.status);
            return (
              <div
                key={take.id}
                className="rounded-md border px-2 py-1.5 text-[9px]"
                style={{
                  borderColor: "var(--panel-border)",
                  background: "var(--background)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    Take {take.id} · {affordance.label}
                  </span>
                  {take.isTimelineSelected ? (
                    <span className="text-muted-foreground">时间轴</span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-muted-foreground">
                  {compactSnapshot(take.parameterSnapshot) ||
                    take.prompt ||
                    shotLabel(shot)}
                </p>
                {take.errorMessage ? (
                  <p className="mt-0.5 text-destructive">{take.errorMessage}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p
          className="mt-2 rounded-md border px-2 py-1.5 text-[9px] text-muted-foreground"
          style={{ borderColor: "var(--panel-border)" }}
        >
          还没有视频 take。先确认首帧和视频提示，再从这里提交。
        </p>
      )}
    </div>
  );
}
