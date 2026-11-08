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
import {
  grantCredit,
  listOperationProviderAttempts,
  recordOperationProviderAttempt,
} from "./computeLedger";
import { initializeSubtitlesForStory } from "./timelineSubtitleEditing";
import { clearVisualEditUndoForTesting } from "./visualEditUndoJournal";
import { clearVisualEditSessionsForTesting } from "./visualEditSessionRegistry";
import {
  StoryNarrationProviderError,
  adoptStoryNarrationCandidate,
  discardStoryNarrationCandidate,
  generateStoryNarrationCandidate,
  listStoryNarrationCandidates,
  quoteStoryNarration,
} from "./storyNarration";
import { withVisualEditServiceLock } from "./visualClipEditing";

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
    sourceKey?: string;
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
      sourceKey: input.sourceKey ?? input.operationId,
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
  it("binds a Doubao audition to its unversioned service and voice and materializes it only once", async () => {
    ENV.tts302Provider = "doubao";
    ENV.tts302Voice = "zh_female_wenrouxiaoya_moon_bigtts";
    const { storyId, cue } = await seed(882, "字".repeat(66));
    const quote = await quoteStoryNarration({ storyId, userId: 882, subtitleCueId: cue.id, now: () => NOW });
    expect(quote).toMatchObject({ estimatedCny: 0.02, provider: "doubao", voice: ENV.tts302Voice });
    const generateVoice = vi.fn(async () => ({ audioUrl: "https://file.302.ai/gpt/tts/a.mp3", provider: "doubao", voice: ENV.tts302Voice }));
    const materializeRemote = vi.fn(fakeProviderAsset(450));
    const request = { storyId, userId: 882, subtitleCueId: cue.id, operationId: "doubao-op-1", quoteToken: quote.quoteToken,
      dependencies: { now: () => NOW + 1000, generateVoice, materializeRemote } };
    expect(await generateStoryNarrationCandidate(request)).toMatchObject({ status: "candidate-ready" });
    expect(await generateStoryNarrationCandidate(request)).toMatchObject({ status: "candidate-ready", replayed: true });
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(materializeRemote).toHaveBeenCalledTimes(1);
    expect(materializeRemote).toHaveBeenCalledWith(expect.objectContaining({ provenance: expect.objectContaining({ model: "doubao-tts-unversioned" }) }));
    expect(await listOperationProviderAttempts(request.operationId)).toMatchObject([{ model: "doubao-tts-unversioned", status: "succeeded", usage: { priceVersion: "tts-302-doubao-tts-unversioned-cny-v1" } }]);
    expect(await findBillingOperation(request.operationId)).toMatchObject({ status: "settled", actualCostMinor: fromYuan(0.02) });
    ENV.tts302Voice = "zh_male_wennuanahu_moon_bigtts";
    expect(await generateStoryNarrationCandidate({ ...request, operationId: "doubao-changed-voice" })).toMatchObject({ status: "error" });
    expect(generateVoice).toHaveBeenCalledTimes(1);
  });
  it("records ElevenLabs actual model and voice once, and rejects a changed voice before charging", async () => {
    ENV.tts302Provider = "elevenlabs";
    ENV.tts302Voice = "EXAVITQu4vr4xnSDxMaL";
    const { storyId, cue } = await seed(881, "字".repeat(233));
    const quote = await quoteStoryNarration({ storyId, userId: 881, subtitleCueId: cue.id, now: () => NOW });
    const generateVoice = vi.fn(async () => ({ audioUrl: "https://file.302ai.cn/gpt/test.mp3", provider: "elevenlabs", voice: ENV.tts302Voice }));
    const request = { storyId, userId: 881, subtitleCueId: cue.id, operationId: "elevenlabs-op-1", quoteToken: quote.quoteToken,
      dependencies: { now: () => NOW + 1000, generateVoice, materializeRemote: fakeProviderAsset(1800) } };
    expect(await generateStoryNarrationCandidate(request)).toMatchObject({ status: "candidate-ready" });
    expect(await generateStoryNarrationCandidate(request)).toMatchObject({ status: "candidate-ready", replayed: true });
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(await listOperationProviderAttempts(request.operationId)).toMatchObject([{
      model: "eleven_multilingual_v2", status: "succeeded", usage: {
        model: "eleven_multilingual_v2", voice: "EXAVITQu4vr4xnSDxMaL",
        priceVersion: expect.stringMatching(/^tts-302-eleven_multilingual_v2-cny-v1-[a-f0-9]{12}$/),
      },
    }]);
    expect(await findBillingOperation(request.operationId)).toMatchObject({ status: "settled", actualCostMinor: fromYuan(0.06) });
    ENV.tts302Voice = "other-voice";
    expect(await generateStoryNarrationCandidate({ ...request, operationId: "changed-elevenlabs-voice" })).toMatchObject({ status: "error" });
    expect(generateVoice).toHaveBeenCalledTimes(1);
  });
  it("binds MiniMax quotes and receipts to the model, and reuses a paid candidate", async () => {
    ENV.tts302Provider = "minimaxi";
    ENV.tts302Voice = "audiobook_female_1";
    const { storyId, cue } = await seed(880, "字".repeat(233));
    const quote = await quoteStoryNarration({ storyId, userId: 880, subtitleCueId: cue.id, now: () => NOW });
    expect(quote).toMatchObject({ provider: "minimaxi", voice: "audiobook_female_1", estimatedCny: 0.06 });
    const generateVoice = vi.fn(async () => ({
      audioUrl: "https://minimax-algeng-chat-tts.oss-cn-wulanchabu.aliyuncs.com/audio/test.mp3",
      provider: "minimaxi", voice: "audiobook_female_1",
    }));
    const request = {
      storyId, userId: 880, subtitleCueId: cue.id, operationId: "minimax-op-1", quoteToken: quote.quoteToken,
      dependencies: { now: () => NOW + 1000, generateVoice, materializeRemote: fakeProviderAsset(1800) },
    };
    expect(await generateStoryNarrationCandidate(request)).toMatchObject({ status: "candidate-ready" });
    expect(await generateStoryNarrationCandidate(request)).toMatchObject({ status: "candidate-ready", replayed: true });
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(await listOperationProviderAttempts("minimax-op-1")).toMatchObject([{
      model: "speech-2.8-turbo", status: "succeeded",
      usage: { model: "speech-2.8-turbo", priceVersion: "tts-302-speech-2.8-turbo-cny-v1" },
    }]);
    expect(await findBillingOperation("minimax-op-1")).toMatchObject({ status: "settled", actualCostMinor: fromYuan(0.06) });
    ENV.tts302Provider = "openai";
    ENV.tts302Voice = "alloy";
    expect(await generateStoryNarrationCandidate({ ...request, operationId: "changed-provider" })).toMatchObject({ status: "error" });
    expect(generateVoice).toHaveBeenCalledTimes(1);
  });

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
    expect(
      await listStoryNarrationCandidates({ storyId, userId: 801 })
    ).toHaveLength(1);

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
    expect(
      timeline.extensions.audioTracks.tracks.find(
        (track: any) => track.kind === "narration"
      ).clips
    ).toMatchObject([
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

    const expired = await generateStoryNarrationCandidate({
      storyId,
      userId: 802,
      subtitleCueId: cue.id,
      operationId: "tts-op-expired",
      quoteToken: quote.quoteToken,
      dependencies: { now: () => NOW + 10 * 60 * 1_000, generateVoice },
    });
    expect(expired).toMatchObject({
      status: "error",
      message: expect.stringContaining("报价已过期"),
    });
    expect(await findBillingOperation("tts-op-expired")).toBeNull();
    expect(generateVoice).not.toHaveBeenCalled();
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

    await expect(generateStoryNarrationCandidate(input)).resolves.toMatchObject(
      {
        status: "submission-unknown",
      }
    );
    await expect(generateStoryNarrationCandidate(input)).resolves.toMatchObject(
      {
        status: "submission-unknown",
      }
    );
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(await findBillingOperation("tts-op-unknown")).toMatchObject({
      status: "submission_unknown",
    });
    expect(await findActiveCreditHold("tts-op-unknown")).toMatchObject({
      status: "active",
    });
  });

  it("resumes materialization from a durable provider-success URL without charging or submitting twice", async () => {
    const { storyId, cue } = await seed(806);
    const quote = await quoteStoryNarration({
      storyId,
      userId: 806,
      subtitleCueId: cue.id,
      now: () => NOW,
    });
    const generateVoice = vi.fn(async () => ({
      audioUrl: "https://file.302.ai/voice/recover.mp3",
      provider: "openai",
      voice: "alloy",
    }));
    const createAsset = fakeProviderAsset(75);
    const materializeRemote = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("process stopped after provider success")
      )
      .mockImplementation(createAsset);
    const request = {
      storyId,
      userId: 806,
      subtitleCueId: cue.id,
      operationId: "tts-op-recover",
      quoteToken: quote.quoteToken,
      dependencies: {
        now: () => NOW + 1_000,
        generateVoice,
        materializeRemote,
      },
    };

    await expect(generateStoryNarrationCandidate(request)).rejects.toThrow(
      "process stopped"
    );
    expect(await listOperationProviderAttempts("tts-op-recover")).toMatchObject(
      [{ status: "submitted", usage: { providerAudioUrl: expect.any(String) } }]
    );

    await expect(
      generateStoryNarrationCandidate(request)
    ).resolves.toMatchObject({
      status: "candidate-ready",
    });
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(materializeRemote).toHaveBeenCalledTimes(2);
    expect(await findBillingOperation("tts-op-recover")).toMatchObject({
      status: "settled",
    });
    expect(await findActiveCreditHold("tts-op-recover")).toBeNull();
  });

  it("freezes a prepared attempt after a crash before the provider URL is persisted", async () => {
    const crashNow = Date.now();
    const { storyId, cue } = await seed(807);
    let requestNow = crashNow + 1_000;
    const quote = await quoteStoryNarration({
      storyId,
      userId: 807,
      subtitleCueId: cue.id,
      now: () => crashNow,
    });
    const generateVoice = vi.fn(async () => ({
      audioUrl: "https://file.302.ai/voice/crash-window.mp3",
      provider: "openai",
      voice: "alloy",
    }));
    let crashBeforeSubmittedRecord = true;
    const recordAttempt: typeof recordOperationProviderAttempt =
      async input => {
        if (input.status === "submitted" && crashBeforeSubmittedRecord) {
          crashBeforeSubmittedRecord = false;
          throw new Error("process stopped before provider URL persistence");
        }
        return recordOperationProviderAttempt(input);
      };
    const request = {
      storyId,
      userId: 807,
      subtitleCueId: cue.id,
      operationId: "tts-op-crash-window",
      quoteToken: quote.quoteToken,
      dependencies: {
        now: () => requestNow,
        generateVoice,
        recordAttempt,
      },
    };

    await expect(generateStoryNarrationCandidate(request)).rejects.toThrow(
      "provider URL persistence"
    );
    expect(await listOperationProviderAttempts(request.operationId)).toEqual([
      expect.objectContaining({ status: "prepared" }),
    ]);

    // Recovery remains reachable after the original quote has expired.
    requestNow = crashNow + 11 * 60 * 1_000;
    await expect(
      generateStoryNarrationCandidate(request)
    ).resolves.toMatchObject({ status: "submission-unknown" });
    expect(generateVoice).toHaveBeenCalledTimes(1);
    expect(await findBillingOperation(request.operationId)).toMatchObject({
      status: "submission_unknown",
    });
    expect(await findActiveCreditHold(request.operationId)).toMatchObject({
      status: "active",
    });
  });

  it("serializes candidate discard with Timeline adoption", async () => {
    const { storyId, cue } = await seed(808);
    const quote = await quoteStoryNarration({
      storyId,
      userId: 808,
      subtitleCueId: cue.id,
      now: () => NOW,
    });
    const generated = await generateStoryNarrationCandidate({
      storyId,
      userId: 808,
      subtitleCueId: cue.id,
      operationId: "tts-op-discard-race",
      quoteToken: quote.quoteToken,
      dependencies: {
        now: () => NOW + 1_000,
        generateVoice: async () => ({
          audioUrl: "https://file.302.ai/voice/discard-race.mp3",
          provider: "openai",
          voice: "alloy",
        }),
        materializeRemote: fakeProviderAsset(60),
      },
    });
    if (generated.status !== "candidate-ready") {
      throw new Error("expected narration candidate");
    }

    let release!: () => void;
    let entered!: () => void;
    const enteredLock = new Promise<void>(resolve => {
      entered = resolve;
    });
    const releaseLock = new Promise<void>(resolve => {
      release = resolve;
    });
    const blocker = withVisualEditServiceLock(storyId, 808, async () => {
      entered();
      await releaseLock;
    });
    await enteredLock;

    const discard = discardStoryNarrationCandidate({
      storyId,
      userId: 808,
      candidateAssetId: generated.candidate.assetId,
      operation: {
        editorSessionEpoch: "tab-a",
        operationId: "discard-race",
      },
    });
    const adopt = adoptStoryNarrationCandidate({
      storyId,
      userId: 808,
      subtitleCueId: cue.id,
      candidateAssetId: generated.candidate.assetId,
      expectedTextRevision: cue.textRevision,
      operation: {
        editorSessionEpoch: "tab-a",
        operationId: "adopt-after-discard",
      },
    });
    release();
    await blocker;

    await expect(discard).resolves.toEqual({ status: "ok" });
    await expect(adopt).resolves.toMatchObject({ status: "error" });
    const timeline = (await getStoryTimeline(storyId, 808)) as any;
    expect(
      (timeline.extensions.audioTracks?.tracks ?? []).flatMap(
        (track: any) => track.clips
      )
    ).toEqual([]);
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
    ).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("更新"),
    });
    expect(
      await listStoryAudioAssetRows({ storyId, userId: 804 })
    ).toHaveLength(2);
  });
});

it.each([
 ['female','zh_female_wenrouxiaoya_moon_bigtts'],
 ['male','zh_male_wennuanahu_moon_bigtts'],
] as const)('generates the signed %s audiobook voice independently of the global TTS default',async(voiceGender,voice)=>{
 const {insertChapter}=await import('../repositories/chapters');
 const {storyId,cue}=await seed(896);
 const chapter=await insertChapter({storyId,userId:896,content:{title:'书',layout:null,blocks:{body:'只朗读这一段。',blockIds:['one'],writingStyle:[{id:'one',format:'text',parentId:null,collapsed:false}],containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
 const input={storyId,userId:896,subtitleCueId:'book-voice',bookTarget:{chapterId:chapter.id,moduleId:'one'},voiceGender,now:()=>NOW};
 const quote=await quoteStoryNarration(input);
 expect(quote).toMatchObject({provider:'doubao',voice,estimatedCny:.02});
 await expect(quoteStoryNarration({...input,provider:'openai',voice:'alloy'})).rejects.toThrow('声音已更新');
 await expect(quoteStoryNarration({...input,bookTarget:undefined,subtitleCueId:cue.id})).rejects.toThrow('声音选择无效');
 ENV.tts302Provider='minimaxi';ENV.tts302Voice='danya_xuejie';
 const generateVoice=vi.fn(async()=>({audioUrl:'https://file.302.ai/voice/test.mp3',provider:'doubao',voice}));
 const materializeRemote=vi.fn(fakeProviderAsset(90));
 const request={storyId,userId:896,subtitleCueId:'book-voice',operationId:`book-${voiceGender}`,quoteToken:quote.quoteToken,dependencies:{now:()=>NOW+1000,generateVoice,materializeRemote}};
 expect(await generateStoryNarrationCandidate(request)).toMatchObject({status:'candidate-ready'});
 expect(await generateStoryNarrationCandidate(request)).toMatchObject({status:'candidate-ready',replayed:true});
 expect(generateVoice).toHaveBeenCalledTimes(1);
 expect(generateVoice).toHaveBeenCalledWith({text:'只朗读这一段。',provider:'doubao',voice});
 expect(materializeRemote).toHaveBeenCalledWith(expect.objectContaining({provenance:expect.objectContaining({voiceGender,provider:'doubao',voice})}));
 const otherQuote=await quoteStoryNarration({...input,voiceGender:voiceGender==='female'?'male':'female'});
 expect(await generateStoryNarrationCandidate({...request,quoteToken:otherQuote.quoteToken})).toMatchObject({status:'error',message:'这个生成操作已用于另一份旁白'});
 expect(generateVoice).toHaveBeenCalledTimes(1);
 const [payload,signature]=quote.quoteToken.split('.');
 const tampered=JSON.parse(Buffer.from(payload,'base64url').toString());tampered.voiceGender=voiceGender==='female'?'male':'female';
 const tamperedToken=Buffer.from(JSON.stringify(tampered)).toString('base64url')+'.'+signature;
 expect(await generateStoryNarrationCandidate({...request,operationId:'tampered-gender',quoteToken:tamperedToken})).toMatchObject({status:'error',message:'旁白报价无效，请重新确认'});
 expect(generateVoice).toHaveBeenCalledTimes(1);
});

it('reads a book module verbatim, saves narration without timeline mutation, rejects deleted sources',async()=>{
 const {insertChapter,deleteChapter}=await import('../repositories/chapters');
 const {storyId}=await seed(899);
 const chapter=await insertChapter({storyId,userId:899,content:{title:'书',layout:null,blocks:{body:'只朗读这一段。',blockIds:['one'],writingStyle:[{id:'one',format:'text',parentId:null,collapsed:false}],containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
 const bookTarget={chapterId:chapter.id,moduleId:'one'};const subtitleCueId='book-module-one';
 const quote=await quoteStoryNarration({storyId,userId:899,subtitleCueId,bookTarget,now:()=>NOW});
 const before=await getStoryTimeline(storyId,899);const generateVoice=vi.fn(async(_input:{text:string})=>({audioUrl:'https://file.302.ai/voice/test.mp3',provider:'openai',voice:'alloy'}));
 const request={storyId,userId:899,subtitleCueId,operationId:'book-narration-one',quoteToken:quote.quoteToken,dependencies:{now:()=>NOW+1000,generateVoice,materializeRemote:async(input:any)=>fakeProviderAsset(90)({...input,operationId:input.sourceKey})}};
 expect(await generateStoryNarrationCandidate(request)).toMatchObject({status:'candidate-ready'});
 expect(await generateStoryNarrationCandidate(request)).toMatchObject({status:'candidate-ready',replayed:true});
 expect(generateVoice).toHaveBeenCalledTimes(1);expect(generateVoice.mock.calls[0][0]).toMatchObject({text:'只朗读这一段。'});
 expect(await getStoryTimeline(storyId,899)).toEqual(before);expect(await listStoryNarrationCandidates({storyId,userId:899})).toEqual([]);
 await deleteChapter(chapter.id,899);expect(await generateStoryNarrationCandidate({...request,operationId:'book-narration-deleted'})).toMatchObject({status:'error'});
 expect(generateVoice).toHaveBeenCalledTimes(1);
});

it('quotes and reads all selected book text in document order and rejects a later source change before charging',async()=>{
 const {insertChapter,saveChapterContent}=await import('../repositories/chapters');
 const {storyId}=await seed(898);
 const chapter=await insertChapter({storyId,userId:898,content:{title:'书',layout:null,blocks:{body:'第一段。\n不选这段\n第二段。',blockIds:['a','skip','b'],writingStyle:['a','skip','b'].map(id=>({id,format:'text' as const,parentId:null,collapsed:false})),containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
 const bookTarget={chapterId:chapter.id,moduleId:'a',moduleIds:['b','a']},subtitleCueId='book-group';
 const quote=await quoteStoryNarration({storyId,userId:898,subtitleCueId,bookTarget,now:()=>NOW});
 const before=await getStoryTimeline(storyId,898),generateVoice=vi.fn(async(_input:{text:string})=>({audioUrl:'https://file.302.ai/voice/test.mp3',provider:'openai',voice:'alloy'}));
 const request={storyId,userId:898,subtitleCueId,operationId:'book-group-narration',quoteToken:quote.quoteToken,dependencies:{now:()=>NOW+1000,generateVoice,materializeRemote:async(input:any)=>fakeProviderAsset(90)({...input,operationId:input.sourceKey})}};
 expect(await generateStoryNarrationCandidate(request)).toMatchObject({status:'candidate-ready'});
 expect(generateVoice).toHaveBeenCalledWith(expect.objectContaining({text:'第一段。\n\n第二段。'}));
 expect(await getStoryTimeline(storyId,898)).toEqual(before);
 const balance=await getCreditAccountSummary(898);
 await saveChapterContent({id:chapter.id,userId:898,expectedVersion:chapter.version,reason:'autosave',content:{blocks:{...chapter.blocks,body:'第一段。\n不选这段\n第二段改了。'}}});
 expect(await generateStoryNarrationCandidate({...request,operationId:'stale-group'})).toMatchObject({status:'error'});
 expect(generateVoice).toHaveBeenCalledTimes(1);expect(await getCreditAccountSummary(898)).toEqual(balance);
 await expect(quoteStoryNarration({storyId,userId:999,subtitleCueId,bookTarget,now:()=>NOW})).rejects.toThrow();
});

it('rejects oversized selected narration instead of truncating it',async()=>{
 const {insertChapter}=await import('../repositories/chapters');const {storyId}=await seed(897);
 const chapter=await insertChapter({storyId,userId:897,content:{title:'书',layout:null,blocks:{body:'甲'.repeat(2500)+'\n'+'乙'.repeat(2500),blockIds:['a','b'],writingStyle:['a','b'].map(id=>({id,format:'text' as const,parentId:null,collapsed:false})),containsAiText:false,settings:null,coverKey:null,bodyTextureKey:null,images:{},illustrations:[]}}});
 await expect(quoteStoryNarration({storyId,userId:897,subtitleCueId:'too-long',bookTarget:{chapterId:chapter.id,moduleId:'a',moduleIds:['a','b']},now:()=>NOW})).rejects.toThrow('最多5000字');
});
