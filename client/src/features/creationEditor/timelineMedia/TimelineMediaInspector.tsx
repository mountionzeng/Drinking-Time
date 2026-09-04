/**
 * 选中一个时间线媒体对象后的简短属性面板。
 *
 * U4 只有字幕：改字、拆分、与上一条/下一条合并、删除。启用条件与禁用原因都来自
 * shared/timelineSubtitleModel 的同一套规则，界面不自己判断能不能做。
 * U6 会把音频类型接进同一个外壳（能力矩阵投影），这里不预先造万能字段。
 */
import { useMemo, useRef, useState } from "react";
import {
  subtitleCueEndFrame,
  subtitleMergeAvailability,
  subtitleSplitAvailability,
  type SubtitleCue,
  type TimelineSubtitleState,
} from "@shared/timelineSubtitleModel";
import { timelineFramesToMs } from "@shared/storyMaterial";

function timecode(frame: number): string {
  const ms = timelineFramesToMs(frame);
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.round((ms % 1000) / (1000 / 30));
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
}

export function TimelineMediaInspector({
  subtitleState,
  selectedCue,
  playheadFrame,
  pending,
  onSplit,
  onMerge,
  onDelete,
}: {
  subtitleState: TimelineSubtitleState;
  selectedCue: SubtitleCue | null;
  playheadFrame: number;
  pending: boolean;
  onSplit: (input: {
    cueId: string;
    splitFrame: number;
    caretIndex: number;
    expectedTextRevision: number;
  }) => Promise<void> | void;
  onMerge: (input: {
    cueId: string;
    direction: "previous" | "next";
  }) => Promise<void> | void;
  onDelete: (cueId: string) => Promise<void> | void;
}) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [caretIndex, setCaretIndex] = useState(0);

  const split = useMemo(
    () =>
      selectedCue
        ? subtitleSplitAvailability(subtitleState, {
            cueId: selectedCue.id,
            splitFrame: playheadFrame,
            caretIndex,
          })
        : { enabled: false, reason: "先选中一条字幕" },
    [caretIndex, playheadFrame, selectedCue, subtitleState]
  );
  const mergePrevious = useMemo(
    () =>
      selectedCue
        ? subtitleMergeAvailability(subtitleState, {
            cueId: selectedCue.id,
            direction: "previous",
          })
        : { enabled: false, reason: "先选中一条字幕" },
    [selectedCue, subtitleState]
  );
  const mergeNext = useMemo(
    () =>
      selectedCue
        ? subtitleMergeAvailability(subtitleState, {
            cueId: selectedCue.id,
            direction: "next",
          })
        : { enabled: false, reason: "先选中一条字幕" },
    [selectedCue, subtitleState]
  );

  if (!selectedCue) {
    return (
      <div
        className="rounded-md border border-border/60 p-2 text-[10px] text-muted-foreground"
        data-testid="timeline-media-inspector-empty"
      >
        选中字幕块后可以在这里拆分、合并或删除。
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border/60 p-2"
      data-testid="timeline-media-inspector"
    >
      <div className="flex items-baseline justify-between text-[10px]">
        <span className="font-semibold text-foreground">字幕</span>
        <span className="font-mono text-[9px] text-muted-foreground">
          {timecode(selectedCue.startFrame)} –{" "}
          {timecode(subtitleCueEndFrame(selectedCue))}
        </span>
      </div>

      <label className="flex flex-col gap-1 text-[9px] text-muted-foreground">
        在文字里点一下决定拆分位置
        <textarea
          ref={textRef}
          readOnly
          value={selectedCue.text}
          rows={2}
          data-testid="timeline-media-inspector-text"
          className="resize-none rounded-sm border border-border/60 bg-muted/20 px-1 py-0.5 text-[10px] leading-tight text-foreground outline-none"
          onSelect={() =>
            setCaretIndex(textRef.current?.selectionStart ?? 0)
          }
          onClick={() => setCaretIndex(textRef.current?.selectionStart ?? 0)}
          onKeyUp={() => setCaretIndex(textRef.current?.selectionStart ?? 0)}
        />
      </label>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          disabled={pending || !split.enabled}
          title={split.reason ?? "在播放头与光标处拆成两条"}
          data-testid="timeline-media-inspector-split"
          onClick={() =>
            void onSplit({
              cueId: selectedCue.id,
              splitFrame: playheadFrame,
              caretIndex,
              expectedTextRevision: selectedCue.textRevision,
            })
          }
          className="rounded-sm border border-border px-2 py-0.5 text-[10px] transition enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          在播放头拆分
        </button>
        <button
          type="button"
          disabled={pending || !mergePrevious.enabled}
          title={mergePrevious.reason ?? "与上一条合并"}
          data-testid="timeline-media-inspector-merge-previous"
          onClick={() =>
            void onMerge({ cueId: selectedCue.id, direction: "previous" })
          }
          className="rounded-sm border border-border px-2 py-0.5 text-[10px] transition enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          与上一条合并
        </button>
        <button
          type="button"
          disabled={pending || !mergeNext.enabled}
          title={mergeNext.reason ?? "与下一条合并"}
          data-testid="timeline-media-inspector-merge-next"
          onClick={() =>
            void onMerge({ cueId: selectedCue.id, direction: "next" })
          }
          className="rounded-sm border border-border px-2 py-0.5 text-[10px] transition enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          与下一条合并
        </button>
        <button
          type="button"
          disabled={pending}
          data-testid="timeline-media-inspector-delete"
          onClick={() => void onDelete(selectedCue.id)}
          className="rounded-sm border border-destructive/50 px-2 py-0.5 text-[10px] text-destructive transition enabled:hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          删除
        </button>
      </div>

      {!split.enabled && split.reason ? (
        <p
          className="m-0 text-[9px] text-muted-foreground"
          data-testid="timeline-media-inspector-split-reason"
        >
          {split.reason}
        </p>
      ) : null}
    </div>
  );
}
