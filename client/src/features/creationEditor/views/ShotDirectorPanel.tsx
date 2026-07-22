import {
  AlertTriangle,
  BrainCircuit,
  Check,
  CircleDollarSign,
  Film,
  GitCompare,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StoryShotEditableField } from "@/features/storyAgent/StoryAgentContext";
import {
  estimateShotVideoCost,
  SHOT_VIDEO_ASPECT_RATIO,
  type ShotDirectorResult,
  type ShotVideoMotion,
} from "@shared/shotDirector";
import type { VideoTakeAsset } from "@shared/videoAsset";
import { displayShotCode } from "@shared/shotIdentity";

import type { ChatCutTimelineClip } from "../chatCutTimeline";
import {
  useCreationEditor,
  type CreationEditorShot,
} from "../CreationEditorContext";
import {
  videoTakeAffordance,
  videoTakeErrorMessage,
  videoTakeFrameUrl,
} from "../videoAssetViewModel";

type DirectorField = {
  field: StoryShotEditableField;
  label: string;
  placeholder?: string;
  rows?: number;
};

const FIELD_GROUPS: Array<{ title: string; fields: DirectorField[] }> = [
  {
    title: "叙事与表演",
    fields: [
      { field: "dialogue", label: "台词 / 旁白", rows: 2 },
      { field: "intent", label: "观众需要感受到什么", rows: 2 },
      { field: "emotion", label: "情绪变化" },
      { field: "beat", label: "叙事节拍" },
      { field: "subject", label: "主体" },
      { field: "action", label: "动作", rows: 2 },
      { field: "performance", label: "表演细节", rows: 2 },
      { field: "environmentMotion", label: "环境变化", rows: 2 },
    ],
  },
  {
    title: "摄影与运动路径",
    fields: [
      { field: "shotType", label: "景别" },
      { field: "cameraAngle", label: "机位 / 角度" },
      { field: "cameraHeight", label: "镜头高度" },
      { field: "lens", label: "焦段 / 景深" },
      { field: "cameraMove", label: "摄影机运动" },
      { field: "cameraPath", label: "摄影机开始与结束路径", rows: 2 },
      { field: "subjectPath", label: "主体运动路径", rows: 2 },
      { field: "videoStart", label: "开始画面", rows: 2 },
      { field: "videoEnd", label: "结束画面", rows: 2 },
    ],
  },
  {
    title: "光线、场景与质感",
    fields: [
      { field: "location", label: "场景" },
      { field: "timeLight", label: "时间 / 基础光线" },
      { field: "lighting", label: "灯光变化" },
      { field: "colorPalette", label: "色彩 / 饱和度" },
      { field: "materialTexture", label: "材质 / 画面质感" },
      { field: "mood", label: "氛围" },
      { field: "styleRef", label: "整体风格约束", rows: 2 },
    ],
  },
  {
    title: "声音与进出镜",
    fields: [
      { field: "sound", label: "环境声 / 音效" },
      { field: "soundBridge", label: "声音桥" },
      { field: "transitionIn", label: "与上一镜的进入关系", rows: 2 },
      { field: "transitionOut", label: "与下一镜的退出关系", rows: 2 },
      { field: "transitionIntent", label: "转场意图", rows: 2 },
    ],
  },
  {
    title: "一致性参考",
    fields: [
      { field: "characterReference", label: "人物 / 脸部参考" },
      { field: "wardrobeReference", label: "服装参考" },
      { field: "hairReference", label: "发型参考" },
      { field: "sceneReference", label: "场景参考" },
      { field: "textureReference", label: "质感参考" },
    ],
  },
];

const EDITABLE_FIELDS = FIELD_GROUPS.flatMap(group =>
  group.fields.map(item => item.field)
).concat([
  "cueCode",
  "actNo",
  "videoPrompt",
  "negativePrompt",
  "generationModel",
  "generationParams",
] satisfies StoryShotEditableField[]);

function shotStableId(shot: CreationEditorShot): string {
  return shot.stableShotId ?? shot.shotIdentity ?? `shot-${shot.shotNo}`;
}

function shotLabel(shot: CreationEditorShot): string {
  return displayShotCode(shot);
}

function shotValue(
  shot: CreationEditorShot,
  field: StoryShotEditableField
): string {
  const value = shot[field];
  return typeof value === "string" ? value : "";
}

function initialDrafts(shot: CreationEditorShot): Record<string, string> {
  return Object.fromEntries(
    EDITABLE_FIELDS.map(field => [field, shotValue(shot, field)])
  );
}

function currentTake(shot: CreationEditorShot): VideoTakeAsset | null {
  return (
    shot.selectedVideoTake ??
    shot.videoTakes?.find(take => take.isTimelineSelected) ??
    null
  );
}

function shotReferenceFrame(
  shot: CreationEditorShot | null,
  role: "start" | "end"
): string | null {
  if (!shot) return null;
  const take = currentTake(shot);
  return (take ? videoTakeFrameUrl(take, role) : null) ?? shot.imageUrl ?? null;
}

function formatSeconds(ms: number | undefined): string {
  return ((ms ?? 3000) / 1000).toFixed(1);
}

function compactSnapshot(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) return "";
  return [snapshot.model, snapshot.durationSec, snapshot.aspectRatio]
    .filter(value => value !== undefined && value !== null && value !== "")
    .map(value =>
      typeof value === "number" && value <= 10 ? `${value}s` : String(value)
    )
    .join(" · ");
}

function AdjacentShotButton({
  label,
  shot,
  role,
  active = false,
  onSelect,
}: {
  label: string;
  shot: CreationEditorShot | null;
  role: "start" | "end";
  active?: boolean;
  onSelect: (shotNo: number) => void;
}) {
  const frame = shotReferenceFrame(shot, role);
  return (
    <button
      type="button"
      disabled={!shot}
      onClick={() => shot && onSelect(shot.shotNo)}
      className={`min-w-0 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
        active ? "text-primary" : "text-muted-foreground hover:text-foreground"
      } disabled:opacity-35`}
    >
      <span className="mb-1 block text-[8px] font-semibold uppercase tracking-normal">
        {label}
      </span>
      <span
        className={`relative block aspect-square overflow-hidden rounded-md border bg-muted/40 ${
          active ? "border-primary" : "border-border"
        }`}
      >
        {frame ? (
          <img src={frame} alt="" className="h-full w-full object-cover" />
        ) : (
          <Film className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 opacity-40" />
        )}
      </span>
      <span className="mt-1 block truncate font-mono text-[9px] font-semibold">
        {shot ? shotLabel(shot) : "无"}
      </span>
    </button>
  );
}

function FieldInput({
  config,
  value,
  dirty,
  onChange,
  onCommit,
}: {
  config: DirectorField;
  value: string;
  dirty: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const base = `mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-[10px] leading-4 text-foreground outline-none transition focus:border-primary/55 focus:ring-2 focus:ring-primary/15 ${
    dirty ? "border-amber-500/60" : "border-border"
  }`;
  return (
    <label className="min-w-0 text-[9px] font-medium text-muted-foreground">
      <span className="flex items-center justify-between gap-2">
        <span>{config.label}</span>
        {dirty ? <span className="text-amber-700">未保存</span> : null}
      </span>
      {config.rows && config.rows > 1 ? (
        <textarea
          value={value}
          rows={config.rows}
          placeholder={config.placeholder}
          onChange={event => onChange(event.currentTarget.value)}
          onBlur={onCommit}
          className={`${base} resize-y`}
        />
      ) : (
        <input
          value={value}
          placeholder={config.placeholder}
          onChange={event => onChange(event.currentTarget.value)}
          onBlur={onCommit}
          onKeyDown={event => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className={`${base} h-8`}
        />
      )}
    </label>
  );
}

function AnalysisRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 border-b border-border/60 py-2 text-[10px] leading-4 last:border-b-0">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value || "待分析"}</span>
    </div>
  );
}

export default function ShotDirectorPanel({
  shot,
  previousShot,
  nextShot,
  sourceClip,
  onSelectShot,
}: {
  shot: CreationEditorShot;
  previousShot: CreationEditorShot | null;
  nextShot: CreationEditorShot | null;
  sourceClip: ChatCutTimelineClip | null;
  onSelectShot: (shotNo: number) => void;
}) {
  const {
    updatePersistedShotField,
    updatePersistedShotFields,
    updateShotDuration,
    analyzeShotVideoDirection,
    generateShotVideo,
    refreshShotVideoStatus,
    adoptVideoTake,
    generatingVideoShotNo,
    shotVideoProviderStatus,
  } = useCreationEditor();
  const stableShotId = shotStableId(shot);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    initialDrafts(shot)
  );
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());
  const [savingFields, setSavingFields] = useState<Set<string>>(new Set());
  const [durationSec, setDurationSec] = useState(
    formatSeconds(shot.durationMs)
  );
  const [motion, setMotion] = useState<ShotVideoMotion>("low");
  const [analysis, setAnalysis] = useState<ShotDirectorResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [confirmGenerationOpen, setConfirmGenerationOpen] = useState(false);
  const [adoptingTakeId, setAdoptingTakeId] = useState<number | null>(null);
  const [compareTakeIds, setCompareTakeIds] = useState<number[]>([]);

  useEffect(() => {
    setDrafts(initialDrafts(shot));
    setDirtyFields(new Set());
    setSavingFields(new Set());
    setDurationSec(formatSeconds(shot.durationMs));
    setMotion(
      /快速|冲|跑|甩|剧烈|rapid|fast/i.test(
        [shot.action, shot.cameraMove, shot.cameraPath]
          .filter(Boolean)
          .join(" ")
      )
        ? "high"
        : "low"
    );
    setAnalysis(null);
    setAnalysisError(null);
    setCompareTakeIds([]);
  }, [stableShotId]);

  const parsedDurationSec = Math.max(3, Math.min(10, Number(durationSec) || 5));
  const costEstimate = estimateShotVideoCost({
    durationSec: parsedDurationSec,
    motion,
  });
  const generating = generatingVideoShotNo === shot.shotNo;
  const availableTakes = (shot.videoTakes ?? []).filter(
    take => take.status === "available" && Boolean(take.videoUrl)
  );
  const comparedTakes = compareTakeIds
    .map(id => availableTakes.find(take => take.id === id))
    .filter((take): take is VideoTakeAsset => take != null);
  const updateDraft = (field: StoryShotEditableField, value: string) => {
    setDrafts(current => ({ ...current, [field]: value }));
    setDirtyFields(current => new Set(current).add(field));
  };

  const commitField = async (field: StoryShotEditableField) => {
    if (!dirtyFields.has(field)) return;
    setSavingFields(current => new Set(current).add(field));
    try {
      await updatePersistedShotField(stableShotId, field, drafts[field] ?? "");
      setDirtyFields(current => {
        const next = new Set(current);
        next.delete(field);
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "镜头字段保存失败");
    } finally {
      setSavingFields(current => {
        const next = new Set(current);
        next.delete(field);
        return next;
      });
    }
  };

  const saveDuration = async () => {
    const value = Number(durationSec);
    if (!Number.isFinite(value) || value < 0.1 || value > 12) {
      setDurationSec(formatSeconds(shot.durationMs));
      toast.error("镜头时长请输入 0.1–12 秒");
      return;
    }
    const nextMs = Math.round(value * 1000);
    if (nextMs !== (shot.durationMs ?? 3000)) {
      await updateShotDuration(shot.shotNo, nextMs).catch(error =>
        toast.error(error instanceof Error ? error.message : "时长保存失败")
      );
    }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const result = await analyzeShotVideoDirection({
        shotNo: shot.shotNo,
        stableShotId,
        draftPrompt:
          drafts.videoPrompt?.trim() ||
          [drafts.action, drafts.cameraMove, drafts.videoStart, drafts.videoEnd]
            .filter(Boolean)
            .join("\n") ||
          "根据当前镜头及相邻镜头设计连续、可剪辑的视频动作",
        subtitle: drafts.dialogue || undefined,
      });
      setAnalysis(result);
      setMotion(result.analysis.recommendedMotion);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "镜头衔接分析失败";
      setAnalysisError(message);
      toast.error(message);
    } finally {
      setAnalyzing(false);
    }
  };

  const applyAnalysis = async () => {
    if (!analysis) return;
    const patch = Object.fromEntries(
      Object.entries(analysis.suggestedFields).filter(
        (entry): entry is [StoryShotEditableField, string] =>
          typeof entry[1] === "string" && entry[1].trim().length > 0
      )
    ) as Partial<Record<StoryShotEditableField, string>>;
    try {
      await updatePersistedShotFields(stableShotId, patch);
      setDrafts(current => ({ ...current, ...patch }));
      setDirtyFields(current => {
        const next = new Set(current);
        Object.keys(patch).forEach(field => next.delete(field));
        return next;
      });
      toast.success("导演建议已应用并保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导演建议应用失败");
    }
  };

  const submitGeneration = async () => {
    if (shot.imageId == null) return;
    try {
      await generateShotVideo({
        shotNo: shot.shotNo,
        imageId: shot.imageId,
        prompt: drafts.videoPrompt?.trim() || analysis?.prompt || "自然动作",
        subtitle: drafts.dialogue || undefined,
        durationSec: parsedDurationSec,
        motion,
        aspectRatio: SHOT_VIDEO_ASPECT_RATIO,
        costConfirmation: {
          accepted: true,
          estimatedCny: costEstimate.estimatedCny,
        },
      });
      toast.success("视频任务已提交；完成后会作为新 Take 保留");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视频任务提交失败");
    }
  };

  const adoptTake = async (take: VideoTakeAsset) => {
    setAdoptingTakeId(take.id);
    try {
      await adoptVideoTake({
        stableShotId,
        takeId: take.id,
        plannedDurationSec: Math.max(
          0.1,
          Math.min(take.durationSec ?? parsedDurationSec, parsedDurationSec)
        ),
      });
      toast.success(`Take ${take.id} 已进入时间线`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Take 采用失败");
    } finally {
      setAdoptingTakeId(null);
    }
  };

  const toggleCompare = (takeId: number) => {
    setCompareTakeIds(current => {
      if (current.includes(takeId)) return current.filter(id => id !== takeId);
      return [...current.slice(-1), takeId];
    });
  };

  const saveState = savingFields.size
    ? "保存中"
    : dirtyFields.size
      ? `${dirtyFields.size} 项未保存`
      : "已保存";

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-background"
      aria-label="单镜头导演面板"
      data-testid="shot-director-panel"
    >
      <header className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-primary">
                {shotLabel(shot)}
              </span>
              <span className="truncate text-xs font-semibold">镜头导演</span>
            </div>
            <span
              className="mt-0.5 block truncate font-mono text-[8px] text-muted-foreground"
              title={stableShotId}
            >
              ID {stableShotId}
            </span>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-[9px] ${
              dirtyFields.size ? "text-amber-700" : "text-muted-foreground"
            }`}
          >
            {savingFields.size ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            {saveState}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-[1fr_1.2fr_1fr] gap-2">
          <AdjacentShotButton
            label="前一镜"
            shot={previousShot}
            role="end"
            onSelect={onSelectShot}
          />
          <AdjacentShotButton
            label="当前镜"
            shot={shot}
            role="start"
            active
            onSelect={onSelectShot}
          />
          <AdjacentShotButton
            label="后一镜"
            shot={nextShot}
            role="start"
            onSelect={onSelectShot}
          />
        </div>
      </header>

      <Tabs defaultValue="director" className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-3 mt-2 grid h-8 w-auto grid-cols-3 rounded-md p-0.5">
          <TabsTrigger value="director" className="h-7 rounded text-[10px]">
            导演
          </TabsTrigger>
          <TabsTrigger value="continuity" className="h-7 rounded text-[10px]">
            衔接
          </TabsTrigger>
          <TabsTrigger value="takes" className="h-7 rounded text-[10px]">
            版本 {shot.videoTakes?.length ? `(${shot.videoTakes.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="director"
          className="min-h-0 overflow-auto px-3 pb-4 pt-2 custom-scrollbar"
        >
          <div className="grid grid-cols-2 gap-2 border-b border-border pb-3">
            <FieldInput
              config={{
                field: "cueCode",
                label: "台词编号",
                placeholder: "如 0107",
              }}
              value={drafts.cueCode ?? ""}
              dirty={dirtyFields.has("cueCode")}
              onChange={value => updateDraft("cueCode", value)}
              onCommit={() => void commitField("cueCode")}
            />
            <FieldInput
              config={{ field: "actNo", label: "幕 / 场" }}
              value={drafts.actNo ?? shot.sceneNo ?? ""}
              dirty={dirtyFields.has("actNo")}
              onChange={value => updateDraft("actNo", value)}
              onCommit={() => void commitField("actNo")}
            />
          </div>

          {FIELD_GROUPS.map((group, groupIndex) => (
            <details
              key={group.title}
              open={groupIndex < 2}
              className="border-b border-border py-2"
            >
              <summary className="cursor-pointer list-none text-[10px] font-semibold text-foreground">
                {group.title}
              </summary>
              <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2">
                {group.fields.map(config => (
                  <FieldInput
                    key={config.field}
                    config={config}
                    value={drafts[config.field] ?? ""}
                    dirty={dirtyFields.has(config.field)}
                    onChange={value => updateDraft(config.field, value)}
                    onCommit={() => void commitField(config.field)}
                  />
                ))}
              </div>
            </details>
          ))}

          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 border-b border-border py-3">
            <label className="text-[9px] font-medium text-muted-foreground">
              镜头时长 / 秒
              <input
                type="number"
                min="0.1"
                max="12"
                step="0.1"
                value={durationSec}
                onChange={event => setDurationSec(event.currentTarget.value)}
                onBlur={() => void saveDuration()}
                onKeyDown={event => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-[10px] outline-none focus:border-primary/55 focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <div className="text-[9px] font-medium text-muted-foreground">
              节奏
              <div className="mt-1 grid h-8 grid-cols-2 rounded-md border border-border p-0.5">
                {(["low", "high"] as const).map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={motion === value}
                    onClick={() => setMotion(value)}
                    className={`rounded text-[9px] transition ${
                      motion === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {value === "low" ? "克制 / 低运动" : "快速 / 高运动"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-2 pt-3">
            <FieldInput
              config={{
                field: "videoPrompt",
                label: "正向视频提示词",
                rows: 5,
              }}
              value={drafts.videoPrompt ?? ""}
              dirty={dirtyFields.has("videoPrompt")}
              onChange={value => updateDraft("videoPrompt", value)}
              onCommit={() => void commitField("videoPrompt")}
            />
            <FieldInput
              config={{ field: "negativePrompt", label: "负面提示词", rows: 3 }}
              value={drafts.negativePrompt ?? ""}
              dirty={dirtyFields.has("negativePrompt")}
              onChange={value => updateDraft("negativePrompt", value)}
              onCommit={() => void commitField("negativePrompt")}
            />
          </div>
        </TabsContent>

        <TabsContent
          value="continuity"
          className="min-h-0 overflow-auto px-3 pb-4 pt-2 custom-scrollbar"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <div>
              <h3 className="text-[10px] font-semibold">首尾帧连续性</h3>
              <p className="mt-0.5 text-[9px] text-muted-foreground">
                分析不会提交视频生成
              </p>
            </div>
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void runAnalysis()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-primary/35 bg-primary/5 px-2 text-[9px] font-semibold text-primary transition hover:bg-primary/10 disabled:opacity-50"
            >
              {analyzing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <BrainCircuit className="h-3 w-3" />
              )}
              分析镜头衔接
            </button>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              ["前镜尾帧", previousShot, "end"],
              ["当前首帧", shot, "start"],
              ["后镜首帧", nextShot, "start"],
            ].map(([label, target, role]) => {
              const frame = shotReferenceFrame(
                target as CreationEditorShot | null,
                role as "start" | "end"
              );
              return (
                <div key={String(label)} className="min-w-0">
                  <span className="mb-1 block text-[8px] font-medium text-muted-foreground">
                    {String(label)}
                  </span>
                  <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted/35">
                    {frame ? (
                      <img
                        src={frame}
                        alt={String(label)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/45" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {analysisError ? (
            <div className="mt-3 flex items-start gap-2 border-y border-destructive/25 bg-destructive/5 py-2 text-[10px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {analysisError}
            </div>
          ) : null}

          {analysis ? (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
                <span className="inline-flex items-center gap-1 text-[9px] font-medium text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  {analysis.source === "302-vision"
                    ? `视觉导演 · ${analysis.model}`
                    : "镜头表降级分析"}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmApplyOpen(true)}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[9px] font-semibold text-primary-foreground hover:opacity-90"
                >
                  <Check className="h-3 w-3" />
                  应用建议
                </button>
              </div>
              <AnalysisRow
                label="画面事实"
                value={analysis.analysis.visualSummary}
              />
              <AnalysisRow
                label="叙事目的"
                value={analysis.analysis.narrativeIntent}
              />
              <AnalysisRow
                label="主体位置"
                value={analysis.analysis.subjectPosition}
              />
              <AnalysisRow
                label="朝向 / 视线"
                value={analysis.analysis.facingGazeDirection}
              />
              <AnalysisRow
                label="景别变化"
                value={analysis.analysis.shotScaleChange}
              />
              <AnalysisRow
                label="光色 / 材质"
                value={analysis.analysis.lightColorMaterial}
              />
              <AnalysisRow
                label="动作接续"
                value={analysis.analysis.actionContinuity}
              />
              <AnalysisRow
                label="转场策略"
                value={analysis.analysis.transitionStrategy}
              />
              <AnalysisRow
                label="本镜运镜"
                value={analysis.analysis.cameraMotion}
              />
              <div className="border-b border-border py-2">
                <span className="text-[9px] font-medium text-muted-foreground">
                  风险
                </span>
                <div className="mt-1 space-y-1">
                  {analysis.analysis.risks.map((risk, index) => (
                    <p
                      key={`${risk.kind}-${index}`}
                      className="text-[10px] leading-4"
                    >
                      {risk.detail}
                    </p>
                  ))}
                </div>
              </div>
              <label className="mt-3 block text-[9px] font-medium text-muted-foreground">
                导演生成的视频提示词
                <textarea
                  value={drafts.videoPrompt || analysis.prompt}
                  rows={5}
                  onChange={event =>
                    updateDraft("videoPrompt", event.currentTarget.value)
                  }
                  onBlur={() => void commitField("videoPrompt")}
                  className="mt-1 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[10px] leading-4 outline-none focus:border-primary/55 focus:ring-2 focus:ring-primary/15"
                />
              </label>
            </div>
          ) : (
            <p className="mt-3 border-y border-border py-3 text-[10px] leading-4 text-muted-foreground">
              选择分析后，系统会比较相邻首尾帧；没有画面时只依据真实镜头表给出降级意见，并明确标注。
            </p>
          )}
        </TabsContent>

        <TabsContent
          value="takes"
          className="min-h-0 overflow-auto px-3 pb-4 pt-2 custom-scrollbar"
        >
          <div className="border-b border-border pb-3">
            <h3 className="text-[10px] font-semibold">当前素材</h3>
            <div className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] gap-2">
              <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted/35">
                {shot.imageUrl ? (
                  <img
                    src={shot.imageUrl}
                    alt="当前首帧"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/45" />
                )}
              </div>
              <div className="min-w-0 text-[9px] leading-4 text-muted-foreground">
                <p className="font-medium text-foreground">
                  {shot.imageId
                    ? `首帧 image #${shot.imageId}`
                    : "尚未选择首帧"}
                </p>
                <p>静态图只作参考或占位，不会被当成最终视频。</p>
                {sourceClip ? (
                  <p className="mt-1 truncate" title={sourceClip.name}>
                    原素材：{sourceClip.name} ·{" "}
                    {(sourceClip.sourceInMs / 1000).toFixed(2)}–
                    {(sourceClip.sourceOutMs / 1000).toFixed(2)}s
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="border-b border-border py-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-[10px] font-semibold">生成新 Take</h3>
                <p className="mt-0.5 text-[9px] text-muted-foreground">
                  1080×1080 · 1:1 ·{" "}
                  {shotVideoProviderStatus?.model || "302 视频模型"}
                </p>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">
                ¥{costEstimate.estimatedCny.toFixed(2)} 预计
              </span>
            </div>

            <div className="mt-2 grid grid-cols-[84px_minmax(0,1fr)] gap-2">
              <label className="text-[9px] font-medium text-muted-foreground">
                时长 / 秒
                <input
                  type="number"
                  min="3"
                  max="10"
                  step="1"
                  value={durationSec}
                  onChange={event => setDurationSec(event.currentTarget.value)}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-[10px] outline-none focus:border-primary/55"
                />
              </label>
              <div className="text-[9px] font-medium text-muted-foreground">
                运动量
                <div className="mt-1 grid h-8 grid-cols-2 rounded-md border border-border p-0.5">
                  {(["low", "high"] as const).map(value => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMotion(value)}
                      className={`rounded text-[9px] ${
                        motion === value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {value === "low" ? "低" : "高"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="mt-2 block text-[9px] font-medium text-muted-foreground">
              视频提示词
              <textarea
                value={drafts.videoPrompt ?? ""}
                rows={5}
                onChange={event =>
                  updateDraft("videoPrompt", event.currentTarget.value)
                }
                onBlur={() => void commitField("videoPrompt")}
                className="mt-1 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[10px] leading-4 outline-none focus:border-primary/55 focus:ring-2 focus:ring-primary/15"
              />
            </label>

            {!shotVideoProviderStatus?.ready ? (
              <p className="mt-2 text-[9px] text-amber-700">
                当前 302 视频配置未就绪：
                {shotVideoProviderStatus?.missing.join(" / ") || "正在检查"}
              </p>
            ) : null}
            {!shot.imageId ? (
              <p className="mt-2 text-[9px] text-amber-700">
                先为这个镜头选择一张可追踪首帧，才能生成视频。
              </p>
            ) : null}

            <button
              type="button"
              disabled={
                generating ||
                !shot.imageId ||
                !shotVideoProviderStatus?.ready ||
                !(drafts.videoPrompt?.trim() || analysis?.prompt)
              }
              onClick={() => setConfirmGenerationOpen(true)}
              className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[10px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Video className="h-3.5 w-3.5" />
              )}
              {generating ? "正在提交" : "确认费用并生成视频"}
            </button>
          </div>

          {comparedTakes.length === 2 ? (
            <div className="border-b border-border py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-semibold">并排比较</h3>
                <button
                  type="button"
                  onClick={() => setCompareTakeIds([])}
                  className="text-[9px] text-muted-foreground hover:text-foreground"
                >
                  清除
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {comparedTakes.map(take => (
                  <div key={take.id} className="min-w-0">
                    <video
                      src={take.videoUrl ?? undefined}
                      controls
                      preload="metadata"
                      className="aspect-square w-full rounded-md bg-black object-cover"
                    />
                    <span className="mt-1 block font-mono text-[9px]">
                      Take {take.id}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="pt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[10px] font-semibold">Take 历史</h3>
              <span className="text-[9px] text-muted-foreground">
                {shot.videoTakes?.length ?? 0} 个版本
              </span>
            </div>
            <div className="mt-2 space-y-2">
              {(shot.videoTakes ?? []).map(take => {
                const affordance = videoTakeAffordance(take.status);
                const firstFrame = videoTakeFrameUrl(take, "start");
                const lastFrame = videoTakeFrameUrl(take, "end");
                const comparing = compareTakeIds.includes(take.id);
                return (
                  <article
                    key={take.id}
                    className={`rounded-md border p-2 ${
                      take.isTimelineSelected
                        ? "border-primary/60 bg-primary/[0.035]"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] font-semibold">
                          Take {take.id}
                        </p>
                        <p className="truncate text-[8px] text-muted-foreground">
                          {compactSnapshot(take.parameterSnapshot) ||
                            take.model}
                        </p>
                      </div>
                      <span className="shrink-0 text-[9px] text-muted-foreground">
                        {take.isTimelineSelected
                          ? "时间线采用中"
                          : affordance.label}
                      </span>
                    </div>

                    {take.status === "available" && take.videoUrl ? (
                      <>
                        <video
                          src={take.videoUrl}
                          controls
                          preload="metadata"
                          className="mt-2 aspect-square w-full rounded-md bg-black object-cover"
                        />
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {["首帧", "尾帧"].map((label, index) => (
                            <div key={label}>
                              <span className="mb-1 block text-[8px] text-muted-foreground">
                                {label}
                              </span>
                              <div className="aspect-square overflow-hidden rounded-md border border-border bg-muted/35">
                                {(index === 0 ? firstFrame : lastFrame) ? (
                                  <img
                                    src={
                                      (index === 0 ? firstFrame : lastFrame) ??
                                      ""
                                    }
                                    alt={`Take ${take.id} ${label}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => toggleCompare(take.id)}
                            className={`inline-flex h-7 items-center justify-center gap-1 rounded-md border text-[9px] ${
                              comparing
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <GitCompare className="h-3 w-3" />
                            {comparing ? "对比中" : "加入对比"}
                          </button>
                          <button
                            type="button"
                            disabled={
                              take.isTimelineSelected ||
                              adoptingTakeId === take.id
                            }
                            onClick={() => void adoptTake(take)}
                            className="inline-flex h-7 items-center justify-center gap-1 rounded-md bg-primary text-[9px] font-semibold text-primary-foreground disabled:opacity-45"
                          >
                            {adoptingTakeId === take.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            {take.isTimelineSelected ? "已采用" : "采用此版本"}
                          </button>
                        </div>
                      </>
                    ) : affordance.canRefresh ? (
                      <button
                        type="button"
                        onClick={() => void refreshShotVideoStatus(take.id)}
                        className="mt-2 inline-flex h-7 w-full items-center justify-center gap-1 rounded-md border border-border text-[9px] text-muted-foreground hover:text-foreground"
                      >
                        <RefreshCw className="h-3 w-3" />
                        刷新生成状态
                      </button>
                    ) : null}

                    {take.errorMessage ? (
                      <p className="mt-2 text-[9px] leading-4 text-destructive">
                        {videoTakeErrorMessage(take.errorMessage)}
                      </p>
                    ) : null}
                    <details className="mt-2 text-[8px] text-muted-foreground">
                      <summary className="cursor-pointer">
                        生成参数与失败信息
                      </summary>
                      <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap bg-muted/45 p-2 text-[8px]">
                        {JSON.stringify(
                          {
                            prompt: take.prompt,
                            status: take.status,
                            error: take.errorMessage,
                            parameters: take.parameterSnapshot,
                          },
                          null,
                          2
                        )}
                      </pre>
                    </details>
                  </article>
                );
              })}
              {!shot.videoTakes?.length ? (
                <p className="border-y border-border py-3 text-[10px] text-muted-foreground">
                  还没有视频版本。生成成功后会保留在这里，采用之前不会改动时间线。
                </p>
              ) : null}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmApplyOpen} onOpenChange={setConfirmApplyOpen}>
        <AlertDialogContent className="max-w-md gap-3 rounded-md p-4 duration-0">
          <AlertDialogHeader className="gap-1">
            <AlertDialogTitle className="text-sm">
              应用导演建议？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-5">
              将覆盖当前镜头的运镜、主体路径、起止画面、转场意图和视频提示词。旧的
              take 不会删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 rounded-md text-xs">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void applyAnalysis()}
              className="h-8 rounded-md text-xs"
            >
              确认应用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmGenerationOpen}
        onOpenChange={setConfirmGenerationOpen}
      >
        <AlertDialogContent className="max-w-md gap-3 rounded-md p-4 duration-0">
          <AlertDialogHeader className="gap-1">
            <AlertDialogTitle className="flex items-center gap-2 text-sm">
              <CircleDollarSign className="h-4 w-4 text-primary" />
              确认付费生成
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-5">
              预计人民币 ¥{costEstimate.estimatedCny.toFixed(2)}，生成{" "}
              {parsedDurationSec}
              秒、1080×1080、1:1 的 {motion === "high" ? "高" : "低"}
              运动量视频。确认后才会提交 302；实际结算以供应商为准。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-2 border-y border-border py-2 text-[10px]">
            <span className="text-muted-foreground">镜头</span>
            <span className="text-right font-mono">{shotLabel(shot)}</span>
            <span className="text-muted-foreground">模型</span>
            <span className="truncate text-right">
              {shotVideoProviderStatus?.model || "302 视频模型"}
            </span>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8 rounded-md text-xs">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void submitGeneration()}
              className="h-8 rounded-md text-xs"
            >
              确认并生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
