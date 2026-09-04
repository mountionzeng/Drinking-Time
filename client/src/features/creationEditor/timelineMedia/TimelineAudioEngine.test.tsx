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
