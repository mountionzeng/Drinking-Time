import { useEffect, useMemo, useRef } from "react";
import {
  chatCutPlaybackAudioTracks,
  type ChatCutTimelineClip,
  type ChatCutTimelineManifest,
} from "./chatCutTimeline";

/**
 * 时间线的声音。
 *
 * 它以前长在底部时间线组件里，于是「删掉底部时间线」会连声音一起删掉——
 * 故事版没有自己的音频播放。声音不该属于某一个界面，所以搬到这里，由持有
 * 播放时钟的那一层渲染，谁在播就跟着谁。
 *
 * 本身不渲染任何可见内容：一组隐藏的 <audio>，靠播放头对齐。
 */

/** 这一刻这条音频该播到第几秒；播放头不在片段区间内时返回 null。 */
export function timelineAudioTargetSeconds(
  clip: Pick<
    ChatCutTimelineClip,
    "startMs" | "endMs" | "sourceInMs" | "sourceOutMs"
  >,
  playheadMs: number
): number | null {
  if (playheadMs < clip.startMs || playheadMs >= clip.endMs) return null;
  const timelineOffsetMs = Math.max(0, playheadMs - clip.startMs);
  const sourceDurationMs = Math.max(0, clip.sourceOutMs - clip.sourceInMs);
  return (
    (clip.sourceInMs +
      (sourceDurationMs > 0
        ? Math.min(timelineOffsetMs, sourceDurationMs)
        : timelineOffsetMs)) /
    1000
  );
}

/** 配乐压到 18%，人声保持原音量。 */
export function timelineAudioVolume(name: string): number {
  return /bgm|music|配乐|音乐/i.test(name) ? 0.18 : 1;
}

export function TimelineAudioPlayback({
  manifest,
  playheadMs,
  isPlaying,
}: {
  manifest: ChatCutTimelineManifest | null;
  playheadMs: number;
  isPlaying: boolean;
}) {
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const clips = useMemo(
    () =>
      (manifest ? chatCutPlaybackAudioTracks(manifest) : [])
        .flatMap(track => track.clips)
        .filter(clip => Boolean(clip.audioUrl)),
    [manifest]
  );

  useEffect(() => {
    for (const clip of clips) {
      const audio = audioRefs.current.get(clip.id);
      if (!audio) continue;
      const targetSeconds = timelineAudioTargetSeconds(clip, playheadMs);
      if (targetSeconds == null) {
        audio.pause();
        continue;
      }
      audio.volume = timelineAudioVolume(clip.name);
      // 播放中允许更大的漂移：每帧强行校正 currentTime 会让声音卡顿。
      const drift = Math.abs(audio.currentTime - targetSeconds);
      if (drift > (isPlaying ? 0.35 : 0.004)) {
        try {
          audio.currentTime = targetSeconds;
        } catch {
          // 元数据可能还没加载完；下一次播放刻度会再试。
        }
      }
      if (isPlaying) {
        if (audio.paused) void audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    }
  }, [clips, isPlaying, playheadMs]);

  useEffect(
    () => () => {
      audioRefs.current.forEach(audio => audio.pause());
    },
    []
  );

  return (
    <div className="hidden" aria-hidden="true">
      {clips.map(clip => (
        <audio
          key={clip.id}
          ref={element => {
            if (element) audioRefs.current.set(clip.id, element);
            else audioRefs.current.delete(clip.id);
          }}
          src={clip.audioUrl ?? undefined}
          preload="auto"
        />
      ))}
    </div>
  );
}
