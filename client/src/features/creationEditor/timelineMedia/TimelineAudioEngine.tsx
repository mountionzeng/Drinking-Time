import { useEffect, useRef, useState } from "react";
import { STORY_TIMELINE_FPS } from "@shared/storyMaterial";
import {
  audioMixInputGainAtFrame,
  audioMixInputSourceFrameAt,
  resolveAudioMixPlanAtFrame,
  type AudioMixPlan,
  type AudioMixPlanInput,
} from "@shared/timelineAudioModel";

export type TimelineAudioBufferLike = {
  duration: number;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  getChannelData: (channel: number) => Float32Array;
};

export type TimelineAudioSourceLike = {
  buffer: TimelineAudioBufferLike | null;
  playbackRate: { value: number };
  onended: (() => void) | null;
  connect: (destination: unknown) => void;
  disconnect: () => void;
  start: (when: number, offset: number, duration: number) => void;
  stop: () => void;
};

export type TimelineGainLike = {
  gain: { setValueAtTime: (value: number, when: number) => void };
  connect: (destination: unknown) => void;
  disconnect: () => void;
};

export type TimelineAudioContextLike = {
  currentTime: number;
  state: AudioContextState;
  destination: unknown;
  resume: () => Promise<void>;
  close?: () => Promise<void>;
  decodeAudioData: (bytes: ArrayBuffer) => Promise<TimelineAudioBufferLike>;
  createBufferSource: () => TimelineAudioSourceLike;
  createGain: () => TimelineGainLike;
  createBuffer?: (
    channels: number,
    length: number,
    sampleRate: number
  ) => TimelineAudioBufferLike;
};

export type TimelineAudioRuntimeSync = {
  storySessionKey: string;
  plan: AudioMixPlan;
  playheadFrame: number;
  isPlaying: boolean;
  resolveSourceUrl: (input: AudioMixPlanInput) => string | null;
};

type ActiveNode = {
  inputId: string;
  url: string;
  playbackSignature: string;
  source: TimelineAudioSourceLike;
  gain: TimelineGainLike;
  startedTimelineFrame: number;
  startedContextTime: number;
};

const DRIFT_RESTART_FRAMES = Math.round(STORY_TIMELINE_FPS * 0.35);

function inputPlaybackSignature(input: AudioMixPlanInput): string {
  const sourceIdentity =
    input.source.kind === "asset"
      ? `asset:${input.source.assetId}`
      : `visual:${input.source.visualSourceId}`;
  return [
    sourceIdentity,
    input.timelineStartFrame,
    input.sourceInFrame,
    input.sourceOutFrame,
    input.durationFrames,
    input.playbackRate,
    input.reverse ? 1 : 0,
  ].join(":");
}

function reverseBuffer(
  context: TimelineAudioContextLike,
  buffer: TimelineAudioBufferLike
): TimelineAudioBufferLike {
  if (!context.createBuffer) return buffer;
  const reversed = context.createBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate
  );
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = reversed.getChannelData(channel);
    for (let index = 0; index < source.length; index += 1) {
      target[index] = source[source.length - index - 1];
    }
  }
  return reversed;
}

/**
 * Stateful Web Audio executor. React supplies the latest canonical frame; the
 * runtime owns decode caching and graph lifecycle. Every async completion
 * rechecks the current Story epoch and active plan before it may make sound.
 */
export function createTimelineAudioRuntime(input: {
  audioContext: TimelineAudioContextLike;
  loadArrayBuffer: (url: string) => Promise<ArrayBuffer>;
  onAutoplayBlocked?: (blocked: boolean) => void;
  onInputError?: (input: AudioMixPlanInput, error: unknown) => void;
}) {
  const context = input.audioContext;
  const decoded = new Map<string, Promise<TimelineAudioBufferLike>>();
  const reversed = new Map<string, TimelineAudioBufferLike>();
  const failedUrls = new Set<string>();
  const retryAfterByUrl = new Map<string, number>();
  const nodes = new Map<string, ActiveNode>();
  let latest: TimelineAudioRuntimeSync | null = null;
  let sessionKey: string | null = null;
  let epoch = 0;
  let disposed = false;
  let autoplayBlocked = false;

  const stopNode = (id: string) => {
    const active = nodes.get(id);
    if (!active) return;
    nodes.delete(id);
    try {
      active.source.stop();
    } catch {
      // A source may already have ended between the frame tick and cleanup.
    }
    active.source.disconnect();
    active.gain.disconnect();
  };

  const stopAll = () => {
    for (const id of [...nodes.keys()]) stopNode(id);
  };

  const ensureRunning = async (force = false): Promise<boolean> => {
    if (context.state === "running") return true;
    if (context.state === "closed") return false;
    if (autoplayBlocked && !force) return false;
    try {
      await context.resume();
      if ((context.state as AudioContextState) !== "running") {
        throw new Error("AudioContext suspended");
      }
      if (autoplayBlocked) {
        autoplayBlocked = false;
        input.onAutoplayBlocked?.(false);
      }
      return true;
    } catch {
      if (!autoplayBlocked) {
        autoplayBlocked = true;
        input.onAutoplayBlocked?.(true);
      }
      return false;
    }
  };

  const bufferFor = (url: string) => {
    let promise = decoded.get(url);
    if (!promise) {
      const pending = input
        .loadArrayBuffer(url)
        .then(bytes => context.decodeAudioData(bytes.slice(0)))
        .then(buffer => {
          failedUrls.delete(url);
          retryAfterByUrl.delete(url);
          return buffer;
        })
        .catch(error => {
          if (decoded.get(url) === pending) decoded.delete(url);
          throw error;
        });
      promise = pending;
      decoded.set(url, pending);
    }
    return promise;
  };

  const currentWantedInput = (
    inputId: string,
    url: string,
    expectedEpoch: number
  ): AudioMixPlanInput | null => {
    if (disposed || epoch !== expectedEpoch || !latest?.isPlaying) return null;
    const current = resolveAudioMixPlanAtFrame(
      latest.plan,
      latest.playheadFrame
    ).find(candidate => candidate.id === inputId);
    if (
      !current ||
      current.muted ||
      current.baseGain <= 0 ||
      latest.resolveSourceUrl(current) !== url
    ) {
      return null;
    }
    return current;
  };

  const startInput = async (
    planned: AudioMixPlanInput,
    url: string,
    expectedEpoch: number
  ) => {
    if ((retryAfterByUrl.get(url) ?? 0) > Date.now()) return;
    try {
      const decodedBuffer = await bufferFor(url);
      const currentPlanned = currentWantedInput(planned.id, url, expectedEpoch);
      if (!currentPlanned || nodes.has(planned.id)) {
        return;
      }
      const currentFrame = latest!.playheadFrame;
      const sourceFrame = audioMixInputSourceFrameAt(
        currentPlanned,
        currentFrame
      );
      const playbackBuffer = currentPlanned.reverse
        ? (reversed.get(url) ??
          (() => {
            const value = reverseBuffer(context, decodedBuffer);
            reversed.set(url, value);
            return value;
          })())
        : decodedBuffer;
      const offsetSeconds = currentPlanned.reverse
        ? Math.max(
            0,
            playbackBuffer.duration - sourceFrame / STORY_TIMELINE_FPS
          )
        : Math.max(0, sourceFrame / STORY_TIMELINE_FPS);
      const remainingTimelineFrames = Math.max(
        0,
        currentPlanned.timelineStartFrame +
          currentPlanned.durationFrames -
          currentFrame
      );
      const remainingSourceFrames = currentPlanned.reverse
        ? Math.max(0, sourceFrame - currentPlanned.sourceInFrame)
        : Math.max(0, currentPlanned.sourceOutFrame - sourceFrame);
      const sourceDurationSeconds =
        Math.min(
          remainingSourceFrames,
          remainingTimelineFrames * currentPlanned.playbackRate
        ) / STORY_TIMELINE_FPS;
      if (sourceDurationSeconds <= 0) return;

      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = playbackBuffer;
      source.playbackRate.value = currentPlanned.playbackRate;
      gain.gain.setValueAtTime(
        audioMixInputGainAtFrame(currentPlanned, currentFrame),
        context.currentTime
      );
      source.connect(gain);
      gain.connect(context.destination);
      const active: ActiveNode = {
        inputId: planned.id,
        url,
        playbackSignature: inputPlaybackSignature(currentPlanned),
        source,
        gain,
        startedTimelineFrame: currentFrame,
        startedContextTime: context.currentTime,
      };
      nodes.set(planned.id, active);
      source.onended = () => {
        if (nodes.get(planned.id) !== active) return;
        nodes.delete(planned.id);
        source.disconnect();
        gain.disconnect();
      };
      source.start(0, offsetSeconds, sourceDurationSeconds);
    } catch (error) {
      retryAfterByUrl.set(url, Date.now() + 2_000);
      if (!failedUrls.has(url)) {
        failedUrls.add(url);
        input.onInputError?.(planned, error);
      }
    }
  };

  const sync = async (next: TimelineAudioRuntimeSync): Promise<void> => {
    if (disposed) return;
    latest = next;
    if (sessionKey !== next.storySessionKey) {
      sessionKey = next.storySessionKey;
      epoch += 1;
      stopAll();
    }
    if (!next.isPlaying) {
      stopAll();
      return;
    }
    const expectedEpoch = epoch;
    if (!(await ensureRunning())) return;
    if (disposed || epoch !== expectedEpoch || latest !== next) return;

    const activeInputs = resolveAudioMixPlanAtFrame(
      next.plan,
      next.playheadFrame
    ).filter(planned => !planned.muted && planned.baseGain > 0);
    const wanted = new Map(
      activeInputs.flatMap(planned => {
        const url = next.resolveSourceUrl(planned);
        return url ? [[planned.id, { planned, url }] as const] : [];
      })
    );

    for (const [id, active] of nodes) {
      const current = wanted.get(id);
      if (
        !current ||
        current.url !== active.url ||
        inputPlaybackSignature(current.planned) !== active.playbackSignature
      ) {
        stopNode(id);
        continue;
      }
      const inferredTimelineFrame = Math.round(
        active.startedTimelineFrame +
          (context.currentTime - active.startedContextTime) * STORY_TIMELINE_FPS
      );
      if (
        Math.abs(inferredTimelineFrame - next.playheadFrame) >
        DRIFT_RESTART_FRAMES
      ) {
        stopNode(id);
        continue;
      }
      active.gain.gain.setValueAtTime(
        audioMixInputGainAtFrame(current.planned, next.playheadFrame),
        context.currentTime
      );
    }

    await Promise.all(
      [...wanted.values()].map(({ planned, url }) =>
        nodes.has(planned.id)
          ? Promise.resolve()
          : startInput(planned, url, expectedEpoch)
      )
    );
  };

  return {
    sync,
    retryFromUserGesture: async () => {
      if (disposed || !latest) return;
      if (!(await ensureRunning(true))) return;
      retryAfterByUrl.clear();
      await sync(latest);
    },
    activeInputIds: () => [...nodes.keys()].sort(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      epoch += 1;
      stopAll();
      void context.close?.().catch(() => undefined);
    },
  };
}

export function TimelineAudioEngine(props: {
  storySessionKey: string;
  plan: AudioMixPlan;
  playheadFrame: number;
  isPlaying: boolean;
  resolveSourceUrl: (input: AudioMixPlanInput) => string | null;
  onInputError?: (input: AudioMixPlanInput, error: unknown) => void;
}) {
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const runtimeRef = useRef<ReturnType<
    typeof createTimelineAudioRuntime
  > | null>(null);

  useEffect(() => {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    runtimeRef.current = createTimelineAudioRuntime({
      audioContext: context as unknown as TimelineAudioContextLike,
      loadArrayBuffer: async url => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15_000);
        try {
          const response = await fetch(url, {
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!response.ok) {
            throw new Error(`音频读取失败（${response.status}）`);
          }
          return response.arrayBuffer();
        } finally {
          window.clearTimeout(timer);
        }
      },
      onAutoplayBlocked: setAutoplayBlocked,
      onInputError: props.onInputError,
    });
    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [props.onInputError]);

  useEffect(() => {
    void runtimeRef.current?.sync({
      storySessionKey: props.storySessionKey,
      plan: props.plan,
      playheadFrame: props.playheadFrame,
      isPlaying: props.isPlaying,
      resolveSourceUrl: props.resolveSourceUrl,
    });
  }, [
    props.isPlaying,
    props.plan,
    props.playheadFrame,
    props.resolveSourceUrl,
    props.storySessionKey,
  ]);

  if (!autoplayBlocked) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-md border border-amber-400/50 bg-background px-3 py-2 text-xs shadow-lg"
    >
      浏览器暂停了声音。
      <button
        type="button"
        className="ml-2 font-medium text-primary underline"
        onClick={() => void runtimeRef.current?.retryFromUserGesture()}
      >
        点一下恢复
      </button>
    </div>
  );
}
