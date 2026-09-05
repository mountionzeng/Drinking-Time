import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromYuan } from "../../shared/computeMoney";
import {
  createStory,
  createStoryAudioAssetRow,
  findBillingOperation,
  getStoryTimeline,
  resetMemoryStateForTesting,
  updateStoryTimeline,
  upsertUser,
} from "../db";
import { ENV } from "../_core/env";
import { grantCredit } from "./computeLedger";
import {
  composeStorySceneAudioPrompt,
  generateStorySceneAudio,
  quoteStorySceneAudio,
  resolveStorySceneAudioContext,
} from "./storyAudioGeneration";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import {
  activateVisualEditSession,
  clearVisualEditSessionsForTesting,
} from "./visualEditSessionRegistry";

const NOW = Date.parse("2026-09-05T12:00:00Z");

async function seed(userId: number) {
  await upsertUser({
    id: userId,
    openId: `scene-audio-${userId}`,
    email: `scene-audio-${userId}@example.com`,
    loginMethod: "email",
  });
  await grantCredit({
    userId,
    amountMinor: fromYuan(10),
    idempotencyKey: `scene-audio-credit-${userId}`,
  });
  const story = await createStory({
    userId,
    title: "scene audio",
    body: {
      _revision: 1,
      shots: [
        { stableShotId: "shot-a", shotNo: 1, emotion: "平静" },
        {
          stableShotId: "shot-b",
          shotNo: 2,
          emotion: "想念里带一点克制的难过",
          mood: "温柔、留白",
          location: "傍晚的空房间",
          action: "主人公看向猫曾经睡过的角落",
          sound: "很轻的窗外风声",
        },
      ],
    },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId,
    expectedVersion: 0,
    items: [
      {
        stableShotId: "shot-a",
        included: true,
        position: 0,
        durationFrames: 60,
        plannedDurationMs: 2_000,
      },
      {
        stableShotId: "shot-b",
        included: true,
        position: 1,
        durationFrames: 90,
        plannedDurationMs: 3_000,
      },
    ],
  });
  return story.id;
}

function generatedUrl() {
  return {
    provider: "302-elevenlabs" as const,
    model: "music_v1",
    source: {
      kind: "url" as const,
      url: "https://file.302.ai/audio/scene.mp3",
    },
  };
}

function fakeRemoteImport(storageKeyCharacter: string) {
  return vi.fn(async (input: any) => ({
    status: "ready" as const,
    reused: false,
    asset: await createStoryAudioAssetRow({
      storyId: input.scope.storyId,
      userId: input.scope.userId,
      storageKey: storageKeyCharacter.repeat(32),
      displayName: input.displayName,
      mediaKind: input.mediaKind,
      sourceKind: "tts",
      sourceKey: input.sourceKey,
      status: "ready",
      durationFrames: 150,
      provenance: input.provenance,
    }),
  }));
}

beforeEach(() => {
  ENV.databaseUrl = "";
  ENV.audio302MusicModel = "music_v1";
  ENV.audio302SoundModel = "eleven_text_to_sound_v2";
  resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
});

describe("scene audio context", () => {
  it("resolves the authoritative shot at the playhead and composes its emotion", () => {
    const context = resolveStorySceneAudioContext({
      targetFrame: 70,
      timelineItems: [
        { stableShotId: "a", included: true, position: 0, durationFrames: 60 },
        { stableShotId: "b", included: true, position: 1, durationFrames: 90 },
      ],
      storyBody: {
        shots: [
          { stableShotId: "a", shotNo: 1 },
          { stableShotId: "b", shotNo: 2, emotion: "想念", mood: "克制" },
        ],
      },
    });
    expect(context).toMatchObject({
      stableShotId: "b",
      shotNo: 2,
      startFrame: 60,
      durationFrames: 90,
      emotionSummary: "想念 · 克制",
    });
    expect(
      composeStorySceneAudioPrompt({
        kind: "music",
        context,
        intent: "不要煽情",
      })
    ).toContain("不要煽情");
  });
});

describe("story scene audio paid workflow", () => {
  it("quotes from the shot, generates once, and inserts the asset at the shot range", async () => {
    const storyId = await seed(901);
    const quote = await quoteStorySceneAudio({
      storyId,
      userId: 901,
      kind: "music",
      targetFrame: 80,
      intent: "钢琴和很薄的弦乐，不要煽情",
      now: () => NOW,
    });
    expect(quote).toMatchObject({
      kind: "music",
      model: "music_v1",
      context: { stableShotId: "shot-b", startFrame: 60, durationFrames: 90 },
    });
    expect(quote.prompt).toContain("想念里带一点克制的难过");

    const generate = vi.fn(async () => generatedUrl());
    const importRemote = fakeRemoteImport("m");
    const request = {
      storyId,
      userId: 901,
      operation: { editorSessionEpoch: "tab-a", operationId: "scene-music-1" },
      quoteToken: quote.quoteToken,
      dependencies: { now: () => NOW + 1_000, generate, importRemote },
    };
    const first = await generateStorySceneAudio(request);
    expect(first).toMatchObject({
      status: "ready",
      replayed: false,
      timeline: { status: "ok", changed: true },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await findBillingOperation("scene-music-1")).toMatchObject({
      status: "settled",
      storyId,
    });
    const timeline = (await getStoryTimeline(storyId, 901)) as any;
    expect(
      timeline.extensions.audioTracks.tracks.find(
        (track: any) => track.kind === "music"
      ).clips
    ).toMatchObject([
      {
        timelineStartFrame: 60,
        durationFrames: 90,
        sourceInFrame: 0,
        sourceOutFrame: 90,
      },
    ]);

    const replay = await generateStorySceneAudio(request);
    expect(replay).toMatchObject({ status: "ready", replayed: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(importRemote).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed shot plan before a second provider submission", async () => {
    const storyId = await seed(902);
    const quote = await quoteStorySceneAudio({
      storyId,
      userId: 902,
      kind: "ambience",
      targetFrame: 80,
      now: () => NOW,
    });
    const timeline = await getStoryTimeline(storyId, 902);
    await updateStoryTimeline({
      storyId,
      userId: 902,
      expectedVersion: timeline!.version,
      items: (timeline!.items as any[]).map(item =>
        item.stableShotId === "shot-b" ? { ...item, durationFrames: 120 } : item
      ),
    });
    const generate = vi.fn();
    await expect(
      generateStorySceneAudio({
        storyId,
        userId: 902,
        operation: { editorSessionEpoch: "tab-a", operationId: "scene-stale" },
        quoteToken: quote.quoteToken,
        dependencies: { now: () => NOW + 1_000, generate },
      })
    ).resolves.toMatchObject({
      status: "error",
      message: expect.stringContaining("已经更新"),
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses the shot's latest range when the layout changes during generation", async () => {
    const storyId = await seed(903);
    const quote = await quoteStorySceneAudio({
      storyId,
      userId: 903,
      kind: "music",
      targetFrame: 80,
      now: () => NOW,
    });
    const generate = vi.fn(async () => {
      const timeline = await getStoryTimeline(storyId, 903);
      await updateStoryTimeline({
        storyId,
        userId: 903,
        expectedVersion: timeline!.version,
        items: (timeline!.items as any[]).map(item =>
          item.stableShotId === "shot-a"
            ? { ...item, durationFrames: 120 }
            : item
        ),
      });
      return generatedUrl();
    });

    await expect(
      generateStorySceneAudio({
        storyId,
        userId: 903,
        operation: { editorSessionEpoch: "tab-a", operationId: "scene-moved" },
        quoteToken: quote.quoteToken,
        dependencies: {
          now: () => NOW + 1_000,
          generate,
          importRemote: fakeRemoteImport("n"),
        },
      })
    ).resolves.toMatchObject({ status: "ready" });

    const timeline = (await getStoryTimeline(storyId, 903)) as any;
    expect(
      timeline.extensions.audioTracks.tracks.find(
        (track: any) => track.kind === "music"
      ).clips[0]
    ).toMatchObject({ timelineStartFrame: 120, durationFrames: 90 });
  });

  it("completes an authorized provider job after its editor epoch retires", async () => {
    const storyId = await seed(904);
    activateVisualEditSession({
      storyId,
      userId: 904,
      editorClientId: "editor-a",
      editorSessionEpoch: "tab-a",
      activationSequence: 1,
    });
    const quote = await quoteStorySceneAudio({
      storyId,
      userId: 904,
      kind: "music",
      targetFrame: 80,
      now: () => NOW,
    });
    const generate = vi.fn(async () => {
      activateVisualEditSession({
        storyId,
        userId: 904,
        editorClientId: "editor-a",
        editorSessionEpoch: "tab-b",
        activationSequence: 2,
      });
      return generatedUrl();
    });

    await expect(
      generateStorySceneAudio({
        storyId,
        userId: 904,
        operation: {
          editorSessionEpoch: "tab-a",
          operationId: "scene-retired",
        },
        quoteToken: quote.quoteToken,
        dependencies: {
          now: () => NOW + 1_000,
          generate,
          importRemote: fakeRemoteImport("o"),
        },
      })
    ).resolves.toMatchObject({
      status: "ready",
      timeline: { status: "ok", changed: true },
    });
    expect(await findBillingOperation("scene-retired")).toMatchObject({
      status: "settled",
    });
  });

  it("recovers a ready asset after a crash before Timeline insertion without regenerating", async () => {
    const storyId = await seed(905);
    const quote = await quoteStorySceneAudio({
      storyId,
      userId: 905,
      kind: "music",
      targetFrame: 80,
      now: () => NOW,
    });
    const generate = vi.fn(async () => generatedUrl());
    const firstRequest = {
      storyId,
      userId: 905,
      operation: { editorSessionEpoch: "tab-a", operationId: "scene-crash" },
      quoteToken: quote.quoteToken,
    };
    await expect(
      generateStorySceneAudio({
        ...firstRequest,
        dependencies: {
          now: () => NOW + 1_000,
          generate,
          importRemote: fakeRemoteImport("p"),
          insert: vi.fn(async () => {
            throw new Error("simulated process crash");
          }),
        },
      })
    ).rejects.toThrow("simulated process crash");

    const changed = await getStoryTimeline(storyId, 905);
    await updateStoryTimeline({
      storyId,
      userId: 905,
      expectedVersion: changed!.version,
      items: (changed!.items as any[]).map(item =>
        item.stableShotId === "shot-a" ? { ...item, durationFrames: 120 } : item
      ),
    });

    await expect(
      generateStorySceneAudio({
        ...firstRequest,
        dependencies: { now: () => NOW + 2_000, generate },
      })
    ).resolves.toMatchObject({ status: "ready", replayed: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await findBillingOperation("scene-crash")).toMatchObject({
      status: "settled",
    });
    const recoveredTimeline = (await getStoryTimeline(storyId, 905)) as any;
    expect(
      recoveredTimeline.extensions.audioTracks.tracks.find(
        (track: any) => track.kind === "music"
      ).clips[0]
    ).toMatchObject({ timelineStartFrame: 120 });
  });
});
