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
import {
  AUDIO_TRACK_KINDS,
  audioClipEndFrame,
  type AudioTrackKind,
  type TimelineAudioState,
} from "@shared/timelineAudioModel";
import { timelineMediaKindProfile } from "./timelineMediaCapabilities";

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
  audioState,
  selectedAudioClipId = null,
  playheadFrame,
  pending,
  onSplit,
  onMerge,
  onDelete,
  onSetAudioGain,
  onSetAudioMuted,
  onSetAudioFade,
  onReclassifyAudio,
  onDeleteAudio,
}: {
  subtitleState: TimelineSubtitleState;
  selectedCue: SubtitleCue | null;
  audioState?: TimelineAudioState;
  selectedAudioClipId?: string | null;
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
  onSetAudioGain?: (input: {
    clipId: string;
    gain: number;
  }) => Promise<void> | void;
  onSetAudioMuted?: (input: {
    clipId: string;
    muted: boolean;
  }) => Promise<void> | void;
  onSetAudioFade?: (input: {
    clipId: string;
    fadeInFrames?: number;
    fadeOutFrames?: number;
  }) => Promise<void> | void;
  onReclassifyAudio?: (input: {
    clipId: string;
    toKind: AudioTrackKind;
  }) => Promise<void> | void;
  onDeleteAudio?: (clipId: string) => Promise<void> | void;
}) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const [caretIndex, setCaretIndex] = useState(0);
  const selectedAudio = useMemo(() => {
    if (!audioState || !selectedAudioClipId) return null;
    for (const track of audioState.tracks) {
      const clip = track.clips.find(clip => clip.id === selectedAudioClipId);
      if (clip) return { kind: track.kind, clip };
    }
    return null;
  }, [audioState, selectedAudioClipId]);

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

  if (selectedAudio) {
    const { clip, kind } = selectedAudio;
    const profile = timelineMediaKindProfile(kind);
    const commitNumber = (
      event: React.FocusEvent<HTMLInputElement>,
      submit: (value: number) => void
    ) => {
      const value = Number(event.currentTarget.value);
      if (Number.isFinite(value)) submit(value);
    };
    return (
      <div
        className="flex flex-col gap-2 rounded-md border border-border/60 p-2"
        data-testid="timeline-media-inspector-audio"
      >
        <div className="flex items-baseline justify-between text-[10px]">
          <span className="font-semibold text-foreground">
            {profile.label} · 素材 #{clip.assetId}
          </span>
          <span className="font-mono text-[9px] text-muted-foreground">
            {timecode(clip.timelineStartFrame)} –{" "}
            {timecode(audioClipEndFrame(clip))}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[9px] text-muted-foreground">
          <label className="flex flex-col gap-1">
            类型
            <select
              value={kind}
              disabled={pending || !onReclassifyAudio}
              data-testid="timeline-media-inspector-audio-kind"
              className="rounded-sm border border-border/60 bg-background px-1 py-0.5 text-foreground"
              onChange={event =>
                void onReclassifyAudio?.({
                  clipId: clip.id,
                  toKind: event.currentTarget.value as AudioTrackKind,
                })
              }
            >
              {AUDIO_TRACK_KINDS.map(value => (
                <option key={value} value={value}>
                  {timelineMediaKindProfile(value).label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            音量（0–400%）
            <input
              type="number"
              min={0}
              max={400}
              step={5}
              defaultValue={Math.round(clip.gain * 100)}
              disabled={pending || !onSetAudioGain}
              data-testid="timeline-media-inspector-audio-gain"
              className="rounded-sm border border-border/60 bg-background px-1 py-0.5 text-foreground"
              onBlur={event =>
                commitNumber(
                  event,
                  value =>
                    void onSetAudioGain?.({
                      clipId: clip.id,
                      gain: value / 100,
                    })
                )
              }
              onKeyDown={event => {
                event.stopPropagation();
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={clip.muted}
              disabled={pending || !onSetAudioMuted}
              data-testid="timeline-media-inspector-audio-muted"
              onChange={event =>
                void onSetAudioMuted?.({
                  clipId: clip.id,
                  muted: event.currentTarget.checked,
                })
              }
            />
            静音这段
          </label>
          <span className="self-center">时长 {clip.durationFrames} 帧</span>
          <label className="flex flex-col gap-1">
            淡入（帧）
            <input
              type="number"
              min={0}
              step={1}
              defaultValue={clip.fadeInFrames}
              disabled={pending || !onSetAudioFade}
              data-testid="timeline-media-inspector-audio-fade-in"
              className="rounded-sm border border-border/60 bg-background px-1 py-0.5 text-foreground"
              onBlur={event =>
                commitNumber(
                  event,
                  value =>
                    void onSetAudioFade?.({
                      clipId: clip.id,
                      fadeInFrames: Math.max(0, Math.round(value)),
                    })
                )
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            淡出（帧）
            <input
              type="number"
              min={0}
              step={1}
              defaultValue={clip.fadeOutFrames}
              disabled={pending || !onSetAudioFade}
              data-testid="timeline-media-inspector-audio-fade-out"
              className="rounded-sm border border-border/60 bg-background px-1 py-0.5 text-foreground"
              onBlur={event =>
                commitNumber(
                  event,
                  value =>
                    void onSetAudioFade?.({
                      clipId: clip.id,
                      fadeOutFrames: Math.max(0, Math.round(value)),
                    })
                )
              }
            />
          </label>
        </div>

        {kind === "narration" ? (
          <p
            className="m-0 text-[9px] text-muted-foreground"
            data-testid="timeline-media-inspector-narration-state"
          >
            {clip.textStale
              ? "字幕文字已变化，可试听旧旁白；重新生成不会自动发生。"
              : clip.speechBindingId
                ? "已与字幕绑定"
                : "尚未与字幕绑定"}
          </p>
        ) : null}

        <button
          type="button"
          disabled={pending || !onDeleteAudio}
          data-testid="timeline-media-inspector-audio-delete"
          onClick={() => void onDeleteAudio?.(clip.id)}
          className="self-start rounded-sm border border-destructive/50 px-2 py-0.5 text-[10px] text-destructive transition enabled:hover:bg-destructive/10 disabled:opacity-40"
        >
          删除引用
        </button>
      </div>
    );
  }

  if (!selectedCue) {
    return (
      <div
        className="rounded-md border border-border/60 p-2 text-[10px] text-muted-foreground"
        data-testid="timeline-media-inspector-empty"
      >
        选中字幕或声音块后可以在这里继续调整。
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
          onSelect={() => setCaretIndex(textRef.current?.selectionStart ?? 0)}
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
