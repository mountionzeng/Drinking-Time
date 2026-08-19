import { useEffect, useMemo, useState } from "react";

import { storyboardAudioPeaks, storyboardEditPlayheadPct } from "../storyboardEditRow";

export type StoryboardAudioClip = {
  id: string;
  name: string;
  kind: "voice" | "music" | "source";
  audioUrl: string | null;
  startMs: number;
  endMs: number;
  sourceInMs: number;
  sourceOutMs: number;
};

export function storyboardAudioTimelineTotalMs(
  clips: readonly StoryboardAudioClip[]
): number {
  return clips.reduce((total, clip) => Math.max(total, clip.endMs), 0);
}

const decodedAudioCache = new Map<string, Promise<AudioBuffer>>();
let audioDecodeContext: AudioContext | null = null;

function sharedAudioDecodeContext(): AudioContext {
  audioDecodeContext ??= new AudioContext();
  return audioDecodeContext;
}

function decodedAudio(url: string): Promise<AudioBuffer> {
  const cached = decodedAudioCache.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`Audio ${response.status}`);
      return response.arrayBuffer();
    })
    .then(bytes => sharedAudioDecodeContext().decodeAudioData(bytes.slice(0)))
    .catch(error => {
      decodedAudioCache.delete(url);
      throw error;
    });
  decodedAudioCache.set(url, pending);
  return pending;
}

function clipPeaks(buffer: AudioBuffer, clip: StoryboardAudioClip): number[] {
  const sourceStart = Math.max(0, clip.sourceInMs);
  const requestedEnd =
    clip.sourceOutMs > sourceStart
      ? clip.sourceOutMs
      : sourceStart + Math.max(0, clip.endMs - clip.startMs);
  const sourceEnd = Math.min(buffer.duration * 1000, requestedEnd);
  const startSample = Math.min(
    buffer.length,
    Math.floor((sourceStart / 1000) * buffer.sampleRate)
  );
  const endSample = Math.max(
    startSample,
    Math.min(
      buffer.length,
      Math.ceil((sourceEnd / 1000) * buffer.sampleRate)
    )
  );
  const channelPeaks = Array.from(
    { length: Math.max(1, buffer.numberOfChannels) },
    (_, channel) =>
      storyboardAudioPeaks(
        buffer.getChannelData(channel).subarray(startSample, endSample),
        96
      )
  );
  return channelPeaks[0].map((_, index) =>
    Math.max(...channelPeaks.map(peaks => peaks[index] ?? 0))
  );
}

function useStoryboardAudioPeaks(clip: StoryboardAudioClip): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let active = true;
    setPeaks(null);
    if (!clip.audioUrl) return () => undefined;
    void decodedAudio(clip.audioUrl)
      .then(buffer => {
        if (active) setPeaks(clipPeaks(buffer, clip));
      })
      .catch(() => {
        if (active) setPeaks([]);
      });
    return () => {
      active = false;
    };
  }, [
    clip.audioUrl,
    clip.endMs,
    clip.sourceInMs,
    clip.sourceOutMs,
    clip.startMs,
  ]);

  return peaks;
}

function clipTone(kind: StoryboardAudioClip["kind"]): string {
  if (kind === "voice") {
    return "border-emerald-500/45 bg-emerald-500/10 text-emerald-600";
  }
  if (kind === "music") {
    return "border-teal-500/45 bg-teal-500/10 text-teal-600";
  }
  return "border-amber-500/45 bg-amber-500/10 text-amber-600";
}

function clipKindLabel(kind: StoryboardAudioClip["kind"]): string {
  if (kind === "voice") return "旁白";
  if (kind === "music") return "音乐";
  return "原声";
}

function AudioClipWaveform({
  clip,
  totalMs,
}: {
  clip: StoryboardAudioClip;
  totalMs: number;
}) {
  const peaks = useStoryboardAudioPeaks(clip);
  const placement = useMemo(() => {
    if (!(totalMs > 0)) return null;
    const startMs = Math.max(0, Math.min(totalMs, clip.startMs));
    const endMs = Math.max(startMs, Math.min(totalMs, clip.endMs));
    if (endMs <= startMs) return null;
    return {
      leftPct: (startMs / totalMs) * 100,
      widthPct: ((endMs - startMs) / totalMs) * 100,
    };
  }, [clip.endMs, clip.startMs, totalMs]);
  if (!placement) return null;

  return (
    <div
      className={`absolute bottom-1 top-1 overflow-hidden rounded-[2px] border ${clipTone(clip.kind)}`}
      style={{
        left: `${placement.leftPct}%`,
        width: `${placement.widthPct}%`,
      }}
      title={`${clipKindLabel(clip.kind)} · ${clip.name}`}
      data-testid={`storyboard-audio-clip-${clip.id}`}
    >
      <span className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-current opacity-20" />
      {peaks && peaks.length > 0 ? (
        <svg
          viewBox={`0 0 ${peaks.length * 2} 32`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full opacity-80"
          aria-hidden="true"
        >
          {peaks.map((peak, index) => {
            const height = Math.max(1, peak * 28);
            return (
              <rect
                key={index}
                x={index * 2 + 0.35}
                y={16 - height / 2}
                width="1.3"
                height={height}
                rx="0.65"
                fill="currentColor"
              />
            );
          })}
        </svg>
      ) : null}
      <span className="pointer-events-none absolute bottom-0 left-1 max-w-full truncate bg-[var(--background)]/70 px-1 font-mono text-[7px] leading-3">
        {clipKindLabel(clip.kind)} · {clip.name.replace(/\.[^.]+$/, "")}
      </span>
    </div>
  );
}

export function StoryboardAudioTrack({
  clips,
  totalMs,
  playheadMs,
}: {
  clips: readonly StoryboardAudioClip[];
  totalMs: number;
  playheadMs: number;
}) {
  const playheadPct = storyboardEditPlayheadPct(playheadMs, totalMs);
  return (
    <div
      className="relative h-12 min-w-0 overflow-hidden border-b border-r bg-muted/15"
      style={{
        borderColor:
          "color-mix(in srgb, var(--panel-border) 62%, transparent)",
      }}
      aria-label="声音强弱与停顿波形"
      data-testid="storyboard-audio-track"
    >
      {clips.length > 0 ? (
        clips.map(clip => (
          <AudioClipWaveform key={clip.id} clip={clip} totalMs={totalMs} />
        ))
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[8px] text-muted-foreground/70">
          导入旁白、音乐或原声后显示声音变化
        </span>
      )}
      {playheadPct != null ? (
        <span
          className="pointer-events-none absolute bottom-0 top-0 z-30 w-px -translate-x-1/2 bg-rose-500"
          style={{ left: `${playheadPct}%` }}
          data-testid="storyboard-audio-playhead"
        />
      ) : null}
    </div>
  );
}
