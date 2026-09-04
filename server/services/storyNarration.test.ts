import { beforeEach, describe, expect, it, vi } from "vitest";

import { fromYuan } from "../../shared/computeMoney";
import {
  createStory,
  createStoryAudioAssetRow,
  findActiveCreditHold,
  findBillingOperation,
  getCreditAccountSummary,
  getStoryTimeline,
  listStoryAudioAssetRows,
  resetMemoryStateForTesting,
  updateStoryTimeline,
  upsertUser,
} from "../db";
import { ENV } from "../_core/env";
import { grantCredit, listOperationProviderAttempts } from "./computeLedger";
import { initializeSubtitlesForStory } from "./timelineSubtitleEditing";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./visualEditSessionRegistry";
import {
  StoryNarrationProviderError,
  adoptStoryNarrationCandidate,
  generateStoryNarrationCandidate,
  listStoryNarrationCandidates,
  quoteStoryNarration,
} from "./storyNarration";

const NOW = Date.parse("2026-09-04T12:00:00Z");

async function seed(userId: number, text = "这是只用于朗读的字幕文字。") {
  await upsertUser({
    id: userId,
    openId: `narration-${userId}`,
    email: `narration-${userId}@example.com`,
    loginMethod: "email",
  });
  await grantCredit({
    userId,
    amountMinor: fromYuan(10),
    idempotencyKey: `narration-credit-${userId}`,
  });
  const story = await createStory({
    userId,
    title: "narration",
    body: { _revision: 1, shots: [{ stableShotId: "shot-a", shotNo: 1 }] },
  });
  await updateStoryTimeline({
    storyId: story.id,
    userId,
    expectedVersion: 0,
    items: [{ stableShotId: "shot-a", included: true, position: 0 }],
  });
  const initialized = await initializeSubtitlesForStory({
    storyId: story.id,
    userId,
    operation: { editorSessionEpoch: "tab-a", operationId: "subtitle-init" },
    candidates: [
      {
        startFrame: 30,
        durationFrames: 60,
        text,
        provenance: { kind: "shot-dialogue", stableShotId: "shot-a" },
        sourceTextRevision: 1,
      },
    ],
  });
  expect(initialized.status).toBe("ok");
  const timeline = (await getStoryTimeline(story.id, userId)) as any;
  const cue = timeline.extensions.subtitleTracks.tracks[0].cues[0] as {
    id: string;
    textRevision: number;
  };
  return { storyId: story.id, cue };
}

function fakeProviderAsset(durationFrames = 90) {
  return async (input: {
    scope: { storyId: number; userId: number };
    operationId: string;
    provenance?: unknown;
  }) => ({
    status: "ready" as const,
    reused: false,
    asset: await createStoryAudioAssetRow({
      storyId: input.scope.storyId,
      userId: input.scope.userId,
      storageKey: input.operationId.padEnd(32, "a").slice(0, 32),
      displayName: "旁白.mp3",
      mediaKind: "narration",
      sourceKind: "tts",
      sourceKey: input.operationId,
      status: "ready",
      durationFrames,
      provenance: input.provenance as any,
    }),
  });
}

beforeEach(() => {
  ENV.databaseUrl = "";
  ENV.tts302Provider = "openai";
  ENV.tts302Voice = "alloy";
  resetMemoryStateForTesting();
  clearVisualEditUndoForTesting();
  clearVisualEditSessionsForTesting();
});

describe("story narration candidate workflow", () => {
  it("reserves, records one provider attempt, creates an immutable candidate, then adopts with one Timeline write", async () => {
    const { storyId, cue } = await seed(801);
    const generateVoice = vi.fn(async () => ({
      audioUrl: "https://file.302.ai/voice/test.mp3",
      provider: "openai",
      voice: "alloy",
    }));
    const quote = await quoteStoryNarration({
      storyId,
      userId: 801,
      subtitleCueId: cue.id,
      now: () => NOW,
    });

    const generated = await generateStoryNarrationCandidate({
      storyId,
      userId: 801,
      subtitleCueId: cue.id,
      operationId: "tts-op-1",
      quoteToken: quote.quoteToken,
      dependencies: {
        now: () => NOW + 1_000,
        generateVoice,
        materializeRemote: fakeProviderAsset(90),
      },
    });

    expect(generated).toMatchObject({ status: "candidate-ready" });
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(await findBillingOperation("tts-op-1")).toMatchObject({
      status: "settled",
      storyId,
    });
    expect(await findActiveCreditHold("tts-op-1")).toBeNull();
    expect(await listOperationProviderAttempts("tts-op-1")).toMatchObject([
      {
        attemptIndex: 1,
        provider: "openai",
        model: "alloy",
        status: "succeeded",
      },
    ]);
    expect(await listStoryNarrationCandidates({ storyId, userId: 801 })).toHaveLength(1);

    const candidateAssetId = (generated as { candidate: { assetId: number } })
      .candidate.assetId;
    const beforeAdopt = (await getStoryTimeline(storyId, 801))!.version;
    const adopted = await adoptStoryNarrationCandidate({
      storyId,
      userId: 801,
      subtitleCueId: cue.id,
      candidateAssetId,
      expectedTextRevision: cue.textRevision,
      operation: { editorSessionEpoch: "tab-a", operationId: "adopt-op-1" },
    });
    expect(adopted).toMatchObject({ status: "ok", changed: true });

    const timeline = (await getStoryTimeline(storyId, 801)) as any;
    expect(timeline.version).toBe(beforeAdopt + 1);
    expect(timeline.extensions.audioTracks.tracks.find((track: any) => track.kind === "narration").clips)
      .toMatchObject([
        {
          assetId: candidateAssetId,
          timelineStartFrame: 30,
          durationFrames: 90,
          sourceInFrame: 0,
          sourceOutFrame: 90,
          textStale: false,
        },
      ]);
    expect(timeline.extensions.subtitleTracks.tracks[0].cues[0]).toMatchObject({
      durationFrames: 90,
      speechBindingId: expect.any(String),
    });
  });

  it("rejects a stale/tampered quote before reserving or calling the provider", async () => {
    const { storyId, cue } = await seed(802);
    const quote = await quoteStoryNarration({
      storyId,
      userId: 802,
      subtitleCueId: cue.id,
      now: () => NOW,
    });
    const generateVoice = vi.fn();

    const invalid = await generateStoryNarrationCandidate({
      storyId,
      userId: 802,
      subtitleCueId: cue.id,
      operationId: "tts-op-tamper",
      quoteToken: `${quote.quoteToken.slice(0, -1)}x`,
      dependencies: { now: () => NOW + 1_000, generateVoice },
    });
    expect(invalid).toMatchObject({ status: "error" });
    expect(generateVoice).not.toHaveBeenCalled();
    expect(await findBillingOperation("tts-op-tamper")).toBeNull();
    expect((await getCreditAccountSummary(802)).reservedMinor).toBe(0);
  });

  it("freezes an unknown submission and never auto-submits it again", async () => {
    const { storyId, cue } = await seed(803);
    const quote = await quoteStoryNarration({
      storyId,
      userId: 803,
      subtitleCueId: cue.id,
      now: () => NOW,
    });
    const generateVoice = vi.fn(async () => {
      throw new StoryNarrationProviderError(
        "submission_unknown",
        "请求已经发出，但没有拿到明确结果"
      );
    });
    const input = {
      storyId,
      userId: 803,
      subtitleCueId: cue.id,
      operationId: "tts-op-unknown",
      quoteToken: quote.quoteToken,
      dependencies: { now: () => NOW + 1_000, generateVoice },
    };

    await expect(generateStoryNarrationCandidate(input)).resolves.toMatchObject({
      status: "submission-unknown",
    });
    await expect(generateStoryNarrationCandidate(input)).resolves.toMatchObject({
      status: "submission-unknown",
    });
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(await findBillingOperation("tts-op-unknown")).toMatchObject({
      status: "submission_unknown",
    });
    expect(await findActiveCreditHold("tts-op-unknown")).toMatchObject({
      status: "active",
    });
  });

  it("does not allow an older candidate to replace a newer generation", async () => {
    const { storyId, cue } = await seed(804);
    const generateVoice = vi.fn(async () => ({
      audioUrl: "https://file.302.ai/voice/test.mp3",
      provider: "openai",
      voice: "alloy",
    }));
    const firstQuote = await quoteStoryNarration({
      storyId,
      userId: 804,
      subtitleCueId: cue.id,
      now: () => NOW,
    });
    const first = await generateStoryNarrationCandidate({
      storyId,
      userId: 804,
      subtitleCueId: cue.id,
      operationId: "tts-op-old",
      quoteToken: firstQuote.quoteToken,
      dependencies: {
        now: () => NOW + 1_000,
        generateVoice,
        materializeRemote: fakeProviderAsset(60),
      },
    });
    const secondQuote = await quoteStoryNarration({
      storyId,
      userId: 804,
      subtitleCueId: cue.id,
      now: () => NOW + 2_000,
    });
    await generateStoryNarrationCandidate({
      storyId,
      userId: 804,
      subtitleCueId: cue.id,
      operationId: "tts-op-new",
      quoteToken: secondQuote.quoteToken,
      dependencies: {
        now: () => NOW + 3_000,
        generateVoice,
        materializeRemote: fakeProviderAsset(75),
      },
    });

    const oldAssetId = (first as { candidate: { assetId: number } }).candidate
      .assetId;
    await expect(
      adoptStoryNarrationCandidate({
        storyId,
        userId: 804,
        subtitleCueId: cue.id,
        candidateAssetId: oldAssetId,
        expectedTextRevision: cue.textRevision,
        operation: { editorSessionEpoch: "tab-a", operationId: "adopt-old" },
      })
    ).resolves.toMatchObject({ status: "error", error: expect.stringContaining("更新") });
    expect(await listStoryAudioAssetRows({ storyId, userId: 804 })).toHaveLength(2);
  });
});
