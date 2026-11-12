import type { ComponentProps } from "react";
import { toast } from "sonner";
import { useUiText } from "@/features/uiLanguage/UiLanguage";
import { StoryboardEditRow, STORYBOARD_TRACK_HEADER_WIDTH } from "@/features/creationEditor/views/StoryboardEditRow";
import { StoryboardTimelineRulerRow } from "./StoryboardTimelineRuler";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { latestVideoTakeFailure } from "@/features/creationEditor/videoAssetViewModel";
import type { StoryShotEditableField } from "@shared/shotDirector";
import { displayShotCode } from "@shared/shotIdentity";
import { estimateStoryNarrationCostMinor } from "@shared/narrationCost";
import { formatComputeUnits } from "@shared/computeMoney";
import type { StoryShot } from "../types";
import type { StoryboardTimingRow } from "../storyboardTiming";
import { StoryboardManuscriptTable, type ManuscriptEntry } from "./StoryboardManuscriptTable";
import { storyboardShotFrameImages } from "./storyboardReviewModel";
import type { StoryboardMediaPreview } from "./StoryboardMediaPreview";

type EditRowProps = ComponentProps<typeof StoryboardEditRow>;
type Props = {
  visible: boolean;
  timeline: EditRowProps["timeline"] | undefined;
  viewport: NonNullable<EditRowProps["viewport"]>;
  shots: EditRowProps["shots"];
  selectedShotNo: number | null;
  selectMatrixShot: EditRowProps["onSelectShot"];
  shotActions: EditRowProps["shotActions"];
  updateShotTimingPreview: EditRowProps["onShotTimingPreviewChange"];
  entries: readonly ManuscriptEntry[];
  timings: readonly StoryboardTimingRow[];
  onSelectShot?: (shotNo: number | null) => void;
  onUpdateShotFields?: (id: string, patch: Partial<Record<StoryShotEditableField, string>>) => Promise<void>;
  isShotRenderActive: (shotNo: number) => boolean;
  generatingVoiceShotIds: readonly string[];
  voiceGenerationErrors: Readonly<Record<string, string>>;
  storyId?: number | null;
  creationShots: Map<number, CreationEditorShot>;
  setPreviewMedia: (preview: StoryboardMediaPreview) => void;
  renderImage: (shot: StoryShot, creation: CreationEditorShot, index: number) => Promise<unknown>;
  renderVideo: (shot: StoryShot, creation: CreationEditorShot) => Promise<unknown>;
  onGenerateShotVoice?: (id: string, text: string) => void | Promise<void>;
};

/** Both presentations share the same timeline and shot data; this only renders the manuscript view. */
export function StoryboardManuscriptSection(props: Props) {
  const t = useUiText();
  const { visible, timeline, viewport, entries, timings } = props;
  return <div hidden={!visible} className="min-h-0 flex-1 overflow-auto custom-scrollbar">
    {visible && timeline && <div className="overflow-x-auto border-b" aria-label={t("分镜稿剪辑栏")}>
      <div className="grid" style={{ gridTemplateColumns: `${STORYBOARD_TRACK_HEADER_WIDTH}px ${viewport.contentWidth}px` }}>
        <StoryboardTimelineRulerRow viewport={viewport} columnSpan={1} />
        <StoryboardEditRow timeline={timeline} viewport={viewport} shots={props.shots} selectedShotNo={props.selectedShotNo}
          onSelectShot={props.selectMatrixShot} columnSpan={1} shotActions={props.shotActions}
          onShotTimingPreviewChange={props.updateShotTimingPreview} />
      </div>
    </div>}
    <StoryboardManuscriptTable visible={visible} entries={entries} selectedShotNo={props.selectedShotNo}
      timingLabel={entry => {
        const timing = timings.find(row => row.stableShotId === entry.stableShotId);
        return timing ? `${(timing.startFrame / 30).toFixed(1)}–${((timing.startFrame + timing.durationFrames) / 30).toFixed(1)}s` : t("未放入时间轴");
      }}
      onSelect={shotNo => {
        const timing = timings.find(row => row.shotNo === shotNo);
        if (timing && timeline) {
          const startMs = timing.startFrame / 30 * 1000;
          const endMs = (timing.startFrame + timing.durationFrames) / 30 * 1000;
          if (timeline.playheadMs < startMs || timeline.playheadMs >= endMs) {
            timeline.onTogglePlay(false);
            timeline.onSeek(startMs);
          }
        }
        props.onSelectShot?.(shotNo);
      }}
      onSave={async (entry, field, value) => {
        if (!props.onUpdateShotFields) throw new Error("镜头尚不能保存，请重新加载");
        await props.onUpdateShotFields(entry.stableShotId, { [field]: value });
      }}
      isBusy={entry => props.isShotRenderActive(entry.shot.shotNo) || props.generatingVoiceShotIds.includes(entry.stableShotId)}
      voiceError={entry => props.voiceGenerationErrors[`${props.storyId}:${entry.stableShotId}`]}
      renderMedia={entry => {
        const shot = props.creationShots.get(entry.shot.shotNo);
        const frames = shot ? storyboardShotFrameImages(shot) : [];
        const videoFailure = latestVideoTakeFailure(shot?.videoTakes ?? []);
        return <div className="grid grid-cols-2 gap-1">{frames.map(frame => <button type="button" key={frame.id}
          aria-label={`${displayShotCode(entry.shot)} · ${t("查看图片")}`}
          onClick={() => props.setPreviewMedia({ kind: "image", url: frame.imageUrl, label: displayShotCode(entry.shot) })}
          className="overflow-hidden rounded-sm bg-muted focus-visible:ring-2 focus-visible:ring-primary">
          <img src={frame.imageUrl} alt={displayShotCode(entry.shot)} loading="lazy" className="aspect-video w-full object-contain" />
        </button>)}{frames.length === 0 && <span className="col-span-2 text-xs text-muted-foreground">{t("暂无图片")}</span>}
          {(shot?.videoTakes ?? []).filter(take => take.videoUrl).map(take => <video key={take.id} src={take.videoUrl!} controls preload="none" aria-label={`${displayShotCode(entry.shot)} · Take ${take.id}`} className="col-span-2 aspect-video w-full rounded-sm" />)}
          {videoFailure && <p role="alert" className="col-span-2 text-xs text-destructive">{videoFailure}</p>}
        </div>;
      }}
      onGenerate={(entry, kind) => {
        const shot = props.creationShots.get(entry.shot.shotNo);
        props.onSelectShot?.(entry.shot.shotNo);
        if (!shot) { toast.error("镜头尚未加载，请稍后重试"); return; }
        if (kind === "image") void props.renderImage(entry.shot, shot, entry.originalIndex);
        else if (kind === "video") void props.renderVideo(entry.shot, shot);
        else if (props.onGenerateShotVoice && entry.shot.dialogue.trim() && window.confirm(
          `${displayShotCode(entry.shot)} · 生成旁白\n\n${entry.shot.dialogue}\n\n预计 ${formatComputeUnits(estimateStoryNarrationCostMinor(entry.shot.dialogue))}，确认生成？`
        )) void props.onGenerateShotVoice(entry.stableShotId, entry.shot.dialogue.trim());
      }} />
  </div>;
}
