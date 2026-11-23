import { describe, expect, it, vi } from "vitest";
import {
  buildAudioMixPlan,
  emptyAudioState,
  insertAudioClip,
  type AudioMixPlan,
} from "@shared/timelineAudioModel";
import {
  createTimelineAudioRuntime,
  type TimelineAudioContextLike,
} from "./TimelineAudioEngine";
import { isVideoOnlyMp4 } from "./embeddedAudio";

function movieWithTracks(...handlers: string[]) {
  const box = (type: string, ...contents: Buffer[]) => {
    const body = Buffer.concat(contents);
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + body.length);
    header.write(type, 4);
    return Buffer.concat([header, body]);
  };
  const tracks = handlers.map(type => {
    const fields = Buffer.alloc(24);
    fields.write(type, 8);
    return box("trak", box("mdia", box("hdlr", fields)));
  });
  return Uint8Array.from(box("moov", ...tracks)).buffer;
}

class FakeAudioBuffer {
  duration = 20;
  length = 960_000;
  numberOfChannels = 1;
  sampleRate = 48_000;
  private channel = new Float32Array(4);
  getChannelData() {
    return this.channel;
  }
}

class FakeSource {
  buffer: FakeAudioBuffer | null = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  starts: Array<{ offset: number; duration: number }> = [];
  stops = 0;
  connect() {}
  disconnect() {}
  start(_when: number, offset: number, duration: number) {
    this.starts.push({ offset, duration });
  }
  stop() {
    this.stops += 1;
  }
}

class FakeGain {
  gain = {
    values: [] as number[],
    setValueAtTime: (value: number) => this.gain.values.push(value),
  };
  connect() {}
  disconnect() {}
}

class FakeAudioContext implements TimelineAudioContextLike {
  currentTime = 0;
  state: AudioContextState = "running";
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  decodeAudioData = vi.fn(async () => new FakeAudioBuffer());
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBuffer() {
    return new FakeAudioBuffer();
  }
}

function planWithClip(
  input: {
    id?: string;
    startFrame?: number;
    sourceInFrame?: number;
    sourceOutFrame?: number;
  } = {}
): AudioMixPlan {
  const inserted = insertAudioClip(emptyAudioState(), {
    id: input.id ?? "music",
    kind: "music",
    assetId: 7,
    timelineStartFrame: input.startFrame ?? 0,
    sourceInFrame: input.sourceInFrame ?? 30,
    sourceOutFrame: input.sourceOutFrame ?? 330,
  });
  if (inserted.status !== "ok") throw new Error(inserted.message);
  return buildAudioMixPlan({ audioState: inserted.state });
}

const emptyPlan = buildAudioMixPlan({ audioState: emptyAudioState() });

function syncInput(
  plan: AudioMixPlan,
  overrides: Partial<{
    storySessionKey: string;
    playheadFrame: number;
    isPlaying: boolean;
  }> = {}
) {
  return {
    storySessionKey: overrides.storySessionKey ?? "story-a:epoch-1",
    plan,
    playheadFrame: overrides.playheadFrame ?? 0,
    isPlaying: overrides.isPlaying ?? true,
    resolveSourceUrl: () => "/api/story-audio-asset/1/7",
  };
}

describe("TimelineAudioEngine runtime", () => {
  it("prepares the parked music without playing it, then reuses the decode on Play", async () => {
    const context = new FakeAudioContext();
    context.state = "suspended";
    const loadArrayBuffer = vi.fn(async () => new ArrayBuffer(8));
    const runtime = createTimelineAudioRuntime({ audioContext: context, loadArrayBuffer });
    const plan = planWithClip();
    await runtime.sync(syncInput(plan, { isPlaying: false }));
    expect(context.sources).toHaveLength(0);
    expect(context.resume).not.toHaveBeenCalled();
    await runtime.sync(syncInput(plan));
    expect(loadArrayBuffer).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(1);
  });
  it("uses current playback time when decoding or UI work finishes late", async () => {
    const context = new FakeAudioContext();
    let frame = 0;
    const readCurrentFrame = () => frame;
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: async () => { frame = 15; return new ArrayBuffer(8); },
    });
    const input = { ...syncInput(planWithClip()), readCurrentFrame };
    await runtime.sync(input);
    expect(context.sources[0].starts[0].offset).toBeCloseTo(1.5);
    context.currentTime += 1;
    frame += 30;
    await runtime.sync(input);
    expect(context.sources).toHaveLength(1);
    frame = 140;
    await runtime.sync(input);
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].starts[0].offset).toBeCloseTo(1 + 140 / 30);
  });

  it("skips confirmed video-only files once, decodes embedded audio and reports real damage", async () => {
    const silent = movieWithTracks("vide");
    const sound = movieWithTracks("vide", "soun");
    const truncated = silent.slice(0, -1);
    expect(isVideoOnlyMp4(silent)).toBe(true);
    expect(isVideoOnlyMp4(sound)).toBe(false);
    expect(isVideoOnlyMp4(truncated)).toBe(false);
    const context = new FakeAudioContext();
    const onInputError = vi.fn();
    const loadArrayBuffer = vi.fn(async () => silent);
    const runtime = createTimelineAudioRuntime({ audioContext: context, loadArrayBuffer, onInputError });
    const plan = planWithClip();
    const visualPlan: AudioMixPlan = { ...plan, inputs: plan.inputs.map(track => ({
      ...track, kind: "visual-source", source: { kind: "visual-source", visualSourceId: "clip" }
    })) };
    const input = syncInput(visualPlan);
    await runtime.sync(input);
    await runtime.sync(input);
    expect(loadArrayBuffer).toHaveBeenCalledTimes(1);
    expect(context.decodeAudioData).not.toHaveBeenCalled();
    expect(onInputError).not.toHaveBeenCalled();
    loadArrayBuffer.mockResolvedValue(sound);
    await runtime.sync({ ...input, resolveSourceUrl: () => "/with-audio.mp4" });
    expect(context.sources).toHaveLength(1);
    loadArrayBuffer.mockResolvedValue(truncated);
    context.decodeAudioData.mockRejectedValueOnce(new Error("unreadable"));
    await runtime.sync({ ...input, resolveSourceUrl: () => "/damaged.mp4" });
    expect(onInputError).toHaveBeenCalledOnce();
  });
  it("plays, pauses, resumes and seeks into the middle with the correct source offset", async () => {
    const context = new FakeAudioContext();
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: async () => new ArrayBuffer(8),
    });
    const plan = planWithClip();

    await runtime.sync(syncInput(plan));
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].starts[0]).toMatchObject({ offset: 1 });

    await runtime.sync(
      syncInput(plan, { playheadFrame: 15, isPlaying: false })
    );
    expect(context.sources[0].stops).toBe(1);

    await runtime.sync(syncInput(plan, { playheadFrame: 15 }));
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1].starts[0].offset).toBeCloseTo(1.5);

    context.currentTime = 0.1;
    await runtime.sync(syncInput(plan, { playheadFrame: 150 }));
    expect(context.sources[1].stops).toBe(1);
    expect(context.sources).toHaveLength(3);
    expect(context.sources[2].starts[0].offset).toBeCloseTo(6);
  });

  it("stops immediately when the Story changes, the clip disappears, or the runtime unmounts", async () => {
    const context = new FakeAudioContext();
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: async () => new ArrayBuffer(8),
    });
    const plan = planWithClip();

    await runtime.sync(syncInput(plan));
    await runtime.sync(
      syncInput(emptyPlan, { storySessionKey: "story-b:epoch-1" })
    );
    expect(context.sources[0].stops).toBe(1);

    await runtime.sync(syncInput(plan, { storySessionKey: "story-b:epoch-1" }));
    await runtime.sync(
      syncInput(emptyPlan, { storySessionKey: "story-b:epoch-1" })
    );
    expect(context.sources[1].stops).toBe(1);

    await runtime.sync(syncInput(plan, { storySessionKey: "story-b:epoch-1" }));
    runtime.dispose();
    expect(context.sources[2].stops).toBe(1);
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("drops a decode that resolves after switching Stories", async () => {
    const context = new FakeAudioContext();
    let release!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(resolve => {
      release = resolve;
    });
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: () => pending,
    });

    const late = runtime.sync(syncInput(planWithClip()));
    await runtime.sync(
      syncInput(emptyPlan, { storySessionKey: "story-b:epoch-1" })
    );
    release(new ArrayBuffer(8));
    await late;

    expect(context.sources).toHaveLength(0);
  });

  it("uses the latest crop when one clip changes while its shared decode is pending", async () => {
    const context = new FakeAudioContext();
    let release!: (value: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(resolve => {
      release = resolve;
    });
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: () => pending,
    });

    const first = runtime.sync(syncInput(planWithClip({ sourceInFrame: 30 })));
    const latest = runtime.sync(
      syncInput(planWithClip({ sourceInFrame: 120, sourceOutFrame: 330 }))
    );
    release(new ArrayBuffer(8));
    await Promise.all([first, latest]);

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].starts[0].offset).toBeCloseTo(4);
  });

  it("does not let a suspended old Story resume with stale source parameters", async () => {
    const context = new FakeAudioContext();
    context.state = "suspended";
    let release!: () => void;
    const pendingResume = new Promise<void>(resolve => {
      release = resolve;
    });
    context.resume.mockImplementation(async () => {
      await pendingResume;
      context.state = "running";
    });
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: async () => new ArrayBuffer(8),
    });

    const oldStory = runtime.sync(
      syncInput(planWithClip({ sourceInFrame: 30 }))
    );
    const newStory = runtime.sync({
      ...syncInput(planWithClip({ sourceInFrame: 120, sourceOutFrame: 330 })),
      storySessionKey: "story-b:epoch-1",
    });
    release();
    await Promise.all([oldStory, newStory]);

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].starts[0].offset).toBeCloseTo(4);
  });

  it("restarts an active node when the clip crop changes without changing its id or URL", async () => {
    const context = new FakeAudioContext();
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: async () => new ArrayBuffer(8),
    });

    await runtime.sync(syncInput(planWithClip({ sourceInFrame: 30 })));
    await runtime.sync(
      syncInput(planWithClip({ sourceInFrame: 120, sourceOutFrame: 330 }))
    );

    expect(context.sources).toHaveLength(2);
    expect(context.sources[0].stops).toBe(1);
    expect(context.sources[1].starts[0].offset).toBeCloseTo(4);
  });

  it("isolates a missing input while the other active input keeps playing", async () => {
    const context = new FakeAudioContext();
    let state = emptyAudioState();
    for (const [id, assetId] of [
      ["missing", 1],
      ["ready", 2],
    ] as const) {
      const inserted = insertAudioClip(state, {
        id,
        kind: "music",
        assetId,
        timelineStartFrame: 0,
        sourceOutFrame: 90,
      });
      if (inserted.status !== "ok") throw new Error(inserted.message);
      state = inserted.state;
    }
    const errors: string[] = [];
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: async url => {
        if (url.endsWith("/1")) throw new Error("404");
        return new ArrayBuffer(8);
      },
      onInputError: input => errors.push(input.id),
    });

    await runtime.sync({
      ...syncInput(buildAudioMixPlan({ audioState: state })),
      resolveSourceUrl: input =>
        input.source.kind === "asset" ? `/asset/${input.source.assetId}` : null,
    });

    expect(errors).toEqual(["missing"]);
    expect(runtime.activeInputIds()).toEqual(["ready"]);
  });

  it("evicts a rejected decode so a user retry can recover a transient fetch failure", async () => {
    const context = new FakeAudioContext();
    const loadArrayBuffer = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary network error"))
      .mockResolvedValue(new ArrayBuffer(8));
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer,
    });
    const input = syncInput(planWithClip());

    await runtime.sync(input);
    expect(context.sources).toHaveLength(0);
    await runtime.retryFromUserGesture();
    expect(loadArrayBuffer).toHaveBeenCalledTimes(2);
    expect(context.sources).toHaveLength(1);
  });

  it("reports an autoplay block once and starts exactly once after a user retry", async () => {
    const context = new FakeAudioContext();
    context.state = "suspended";
    context.resume.mockRejectedValueOnce(new Error("NotAllowedError"));
    const blocked: boolean[] = [];
    const runtime = createTimelineAudioRuntime({
      audioContext: context,
      loadArrayBuffer: async () => new ArrayBuffer(8),
      onAutoplayBlocked: value => blocked.push(value),
    });
    const input = syncInput(planWithClip());

    await runtime.sync(input);
    await runtime.sync(input);
    expect(blocked).toEqual([true]);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(0);

    await runtime.retryFromUserGesture();
    expect(blocked).toEqual([true, false]);
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(context.sources).toHaveLength(1);
  });
});
