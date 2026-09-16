import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetMemoryStateForTesting, seedStoryForTesting } from "../db";
import {
  answerStorySoundInterview,
  buildStorySoundInterviewState,
  buildStorySoundPlanVersion,
  goBackStorySoundInterview,
  resumeStorySoundInterview,
  startOrResumeStorySoundInterview,
} from "./storySoundDirector";
import { resetStorySoundLimitsForTesting } from "./storySoundLimits";
import type { StorySoundContextPacket } from "./storySoundContext";

const packet = (): StorySoundContextPacket => ({
  storyId: 11,
  userId: 1,
  evidenceSnapshotDigest: "a".repeat(64),
  sourceRevisions: {
    "story:11:title": "b".repeat(64),
    "shot:rain:dialogue": "c".repeat(64),
    "shot:rain:sound": "d".repeat(64),
  },
  characters: [
    {
      id: "character-1",
      name: "女儿",
      role: "主角",
      ambiguousName: false,
      evidenceId: "character:character-1",
    },
  ],
  evidence: [
    {
      id: "story:11:title",
      sourceKind: "story",
      sourceId: "11:title",
      revisionHash: "b".repeat(64),
      text: "雨夜回家",
      certainty: "confirmed",
    },
    {
      id: "shot:rain:dialogue",
      sourceKind: "shot",
      sourceId: "rain:dialogue",
      revisionHash: "c".repeat(64),
      sceneId: "scene-1",
      text: "妈，我回来了。",
      certainty: "verbatim",
      soundKind: "dialogue",
    },
    {
      id: "shot:rain:sound",
      sourceKind: "shot",
      sourceId: "rain:sound",
      revisionHash: "d".repeat(64),
      sceneId: "scene-1",
      text: "窗外持续的雨声",
      certainty: "explicit",
      soundKind: "ambience",
    },
  ],
});

describe("storySoundDirector", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    resetStorySoundLimitsForTesting();
    seedStoryForTesting({ id: 11, userId: 1 });
  });

  it("asks only evidence-backed questions and resumes at the persisted step", async () => {
    const appendSummary = vi.fn(async () => undefined);
    const compileContext = vi.fn(async () => packet());
    const started = await startOrResumeStorySoundInterview(
      { storyId: 11, userId: 1 },
      { compileContext, appendSummary }
    );
    expect(started.question?.category).toBe("global");
    expect(started.interview?.questions.map(item => item.category)).toEqual([
      "global",
      "dialogue",
      "ambience",
    ]);
    expect(JSON.stringify(started.interview?.questions)).not.toMatch(
      /枪|车辆|汽车/
    );

    const first = await answerStorySoundInterview(
      {
        storyId: 11,
        userId: 1,
        expectedRevision: started.workspace.revision,
        stepId: started.question!.id,
        optionId: "faithful",
      },
      { appendSummary }
    );
    expect(first.status).toBe("ok");
    const resumed = await resumeStorySoundInterview({ storyId: 11, userId: 1 });
    expect(resumed?.question?.category).toBe("dialogue");
    expect(compileContext).toHaveBeenCalledOnce();
  });

  it("invalidates downstream answers after editing an earlier step and does not duplicate rows", async () => {
    const appendSummary = vi.fn(async () => undefined);
    const started = await startOrResumeStorySoundInterview(
      { storyId: 11, userId: 1 },
      { compileContext: async () => packet(), appendSummary }
    );
    const global = await answerStorySoundInterview(
      {
        storyId: 11,
        userId: 1,
        expectedRevision: started.workspace.revision,
        stepId: started.question!.id,
        optionId: "faithful",
      },
      { appendSummary }
    );
    if (global.status !== "ok") throw new Error("unexpected conflict");
    const dialogue = await answerStorySoundInterview(
      {
        storyId: 11,
        userId: 1,
        expectedRevision: global.workspace.revision,
        stepId: global.question!.id,
        optionId: "character:character-1",
      },
      { appendSummary }
    );
    if (dialogue.status !== "ok") throw new Error("unexpected conflict");
    const back = await goBackStorySoundInterview({
      storyId: 11,
      userId: 1,
      expectedRevision: dialogue.workspace.revision,
    });
    if (back.status !== "ok") throw new Error("unexpected conflict");
    const changed = await answerStorySoundInterview(
      {
        storyId: 11,
        userId: 1,
        expectedRevision: back.workspace.revision,
        stepId: back.question!.id,
        optionId: "unassigned",
      },
      { appendSummary }
    );
    if (changed.status !== "ok") throw new Error("unexpected conflict");
    expect(changed.workspace.rows).toHaveLength(1);
    expect(changed.interview?.reviewSuggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ optionId: "character:character-1" }),
      ])
    );
  });

  it("blocks paraphrased speech as an AI draft until exact wording is confirmed", () => {
    const intentPacket = packet();
    intentPacket.evidence[1] = {
      ...intentPacket.evidence[1],
      text: "她向母亲道歉",
      certainty: "explicit",
    };
    const state = buildStorySoundInterviewState(intentPacket);
    const question = state.questions.find(
      item => item.category === "dialogue"
    )!;
    expect(question.options.map(item => item.id)).toContain("draft");
    expect(question.prompt).not.toContain("对不起");
  });

  it("keeps verbatim words when free text supplies only a performance style", async () => {
    const appendSummary = vi.fn(async () => undefined);
    const started = await startOrResumeStorySoundInterview(
      { storyId: 11, userId: 1 },
      { compileContext: async () => packet(), appendSummary }
    );
    const global = await answerStorySoundInterview(
      {
        storyId: 11,
        userId: 1,
        expectedRevision: started.workspace.revision,
        stepId: started.question!.id,
        optionId: "faithful",
      },
      { appendSummary }
    );
    if (global.status !== "ok") throw new Error("unexpected conflict");
    const dialogue = await answerStorySoundInterview(
      {
        storyId: 11,
        userId: 1,
        expectedRevision: global.workspace.revision,
        stepId: global.question!.id,
        freeText: "低沉、克制",
      },
      { appendSummary }
    );
    if (dialogue.status !== "ok") throw new Error("unexpected conflict");
    expect(dialogue.workspace.rows[0]).toMatchObject({
      text: "妈，我回来了。",
      textOrigin: "verbatim",
      performance: { style: "低沉、克制" },
    });
  });

  it("reports an existing track instead of proposing another row of the same kind", () => {
    const withExisting = packet();
    withExisting.evidence.push({
      id: "timeline_audio:rain-existing",
      sourceKind: "timeline_audio",
      sourceId: "rain-existing",
      revisionHash: "e".repeat(64),
      text: "时间线已有环境声片段",
      certainty: "existing",
      soundKind: "ambience",
      existingTimelineClipId: "rain-existing",
    });
    const state = buildStorySoundInterviewState(withExisting);
    const ambience = state.questions.filter(
      item => item.category === "ambience"
    );
    expect(ambience).toHaveLength(1);
    expect(ambience[0]).toMatchObject({
      existingTimelineClipId: "rain-existing",
    });
  });

  it("saves one immutable version only after all grounded steps are reviewed", async () => {
    const appendSummary = vi.fn(async () => undefined);
    let session = await startOrResumeStorySoundInterview(
      { storyId: 11, userId: 1 },
      { compileContext: async () => packet(), appendSummary }
    );
    while (session.question) {
      const answer = await answerStorySoundInterview(
        {
          storyId: 11,
          userId: 1,
          expectedRevision: session.workspace.revision,
          stepId: session.question.id,
          optionId: session.question.options[0]!.id,
        },
        { appendSummary }
      );
      if (answer.status !== "ok") throw new Error("unexpected conflict");
      session = answer;
    }
    const saved = await buildStorySoundPlanVersion(
      {
        storyId: 11,
        userId: 1,
        expectedRevision: session.workspace.revision,
      },
      { compileContext: async () => packet() }
    );
    expect(saved).toMatchObject({
      status: "ok",
      version: { versionNumber: 1 },
    });

    const changedPacket = packet();
    changedPacket.evidenceSnapshotDigest = "e".repeat(64);
    changedPacket.sourceRevisions = {
      ...changedPacket.sourceRevisions,
      "story:11:title": "f".repeat(64),
    };
    changedPacket.evidence[0] = {
      ...changedPacket.evidence[0]!,
      revisionHash: "f".repeat(64),
      text: "雨夜回家（修订）",
    };
    const changed = await buildStorySoundPlanVersion(
      {
        storyId: 11,
        userId: 1,
        expectedRevision: session.workspace.revision,
      },
      { compileContext: async () => changedPacket }
    );
    expect(changed).toMatchObject({
      status: "evidence_changed",
      complete: false,
      question: { category: "global" },
    });
    const rereview = await resumeStorySoundInterview({
      storyId: 11,
      userId: 1,
    });
    expect(rereview?.complete).toBe(false);
    expect(rereview?.question?.category).toBe("global");
    expect(rereview?.workspace.rows).toHaveLength(session.workspace.rows.length);
  });
});
