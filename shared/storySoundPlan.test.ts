import { describe, expect, it } from "vitest";
import {
  canonicalStorySoundPlanContent,
  confirmSoundPlanDraftText,
  normalizeStorySoundPlanDraft,
  restoreStorySoundPlanVersion,
  soundPlanRowCanBeQuoted,
  type StorySoundPlanVersion,
} from "./storySoundPlan";

const rawDraft = () => ({
  globalDirection: "克制、温暖",
  rows: [
    {
      id: "dialogue-1",
      kind: "dialogue",
      startFrame: 31.7,
      durationFrames: 62.2,
      sceneId: "scene-1",
      characterId: "character-mother",
      text: "对不起，妈妈。",
      textOrigin: "ai_draft",
      evidence: [
        {
          id: "evidence-subtitle-1",
          sourceKind: "subtitle",
          sourceId: "subtitle-1",
          revisionHash: "rev-a",
          startFrame: 30,
          endFrame: 90,
        },
      ],
      voiceAssignmentId: "assignment-1",
      performance: { emotion: "内疚", speed: 1, intensity: 0.4 },
      selected: false,
      quoteMinorUnits: 999,
      status: "ready",
    },
    {
      id: "ambience-1",
      kind: "ambience",
      startFrame: -20,
      durationFrames: 300,
      sceneId: "scene-1",
      description: "室内雨声",
      textOrigin: "not_applicable",
      evidence: [
        {
          id: "evidence-shot-1",
          sourceKind: "shot",
          sourceId: "shot-1",
          revisionHash: "rev-b",
        },
      ],
    },
    {
      id: "invented",
      kind: "laser",
      startFrame: 0,
      durationFrames: 10,
      evidence: [],
    },
  ],
  characterVoiceAssignments: [
    {
      id: "assignment-1",
      characterId: "character-mother",
      voiceSource: "official",
      voiceId: "voice-warm-1",
    },
  ],
});

describe("storySoundPlan", () => {
  it("normalizes integer 30fps ranges, drops unsupported rows, and blocks unconfirmed AI wording", () => {
    const draft = normalizeStorySoundPlanDraft(rawDraft());

    expect(draft.rows).toHaveLength(2);
    expect(draft.rows[0]).toMatchObject({
      startFrame: 32,
      durationFrames: 62,
      eligibility: "ai_draft_unconfirmed",
      textOrigin: "ai_draft",
    });
    expect(draft.rows[1]).toMatchObject({
      startFrame: 0,
      durationFrames: 300,
      eligibility: "eligible",
    });
    expect(soundPlanRowCanBeQuoted(draft.rows[0])).toBe(false);
    expect(soundPlanRowCanBeQuoted(draft.rows[1])).toBe(true);
  });

  it("requires evidence and the type-specific creative payload before quoting", () => {
    const draft = normalizeStorySoundPlanDraft({
      rows: [
        {
          id: "dialogue-without-text",
          kind: "dialogue",
          startFrame: 0,
          durationFrames: 30,
          textOrigin: "verbatim",
          evidence: [{ id: "e1", sourceKind: "story", sourceId: "s1" }],
        },
        {
          id: "music-without-evidence",
          kind: "music",
          startFrame: 0,
          durationFrames: 30,
          description: "温暖钢琴",
          textOrigin: "not_applicable",
          evidence: [],
        },
      ],
    });

    expect(draft.rows.map(row => row.eligibility)).toEqual([
      "missing_content",
      "missing_evidence",
    ]);
    expect(draft.rows.every(row => !soundPlanRowCanBeQuoted(row))).toBe(true);
  });

  it("confirms exact AI draft wording explicitly without changing its evidence or timing", () => {
    const draft = normalizeStorySoundPlanDraft(rawDraft());
    const result = confirmSoundPlanDraftText(draft, {
      rowId: "dialogue-1",
      confirmedText: "对不起，妈妈。",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.draft.rows[0]).toMatchObject({
      textOrigin: "user_confirmed",
      eligibility: "eligible",
      startFrame: 32,
      durationFrames: 62,
    });
    expect(result.draft.rows[0].evidence).toEqual(draft.rows[0].evidence);
    expect(soundPlanRowCanBeQuoted(result.draft.rows[0])).toBe(true);
  });

  it("canonical creative content ignores selection, quote, and operation projections", () => {
    const first = normalizeStorySoundPlanDraft(rawDraft());
    const second = normalizeStorySoundPlanDraft({
      ...rawDraft(),
      selection: { "dialogue-1": true },
      quotes: { "dialogue-1": { minorUnits: 120 } },
      operations: { "dialogue-1": { status: "submission_unknown" } },
    });

    expect(canonicalStorySoundPlanContent(second)).toBe(
      canonicalStorySoundPlanContent(first)
    );
  });

  it("restores a version into a detached mutable draft without mutating the version", () => {
    const storedRows = normalizeStorySoundPlanDraft(rawDraft()).rows;
    const version: StorySoundPlanVersion = {
      id: "version-1",
      storyId: 1196,
      userId: 7,
      versionNumber: 1,
      contentDigest: "content-v1",
      evidenceSnapshotDigest: "evidence-v1",
      sourceRevisions: { story: "story-rev-1" },
      globalDirection: "克制、温暖",
      rows: storedRows,
      characterVoiceAssignments: [],
      createdAt: "2026-09-16T00:00:00.000Z",
    };

    const restored = restoreStorySoundPlanVersion(version);
    restored.rows[0].text = "只修改草稿";

    expect(restored.restoredFromVersionId).toBe("version-1");
    expect(restored.rows[0].text).toBe("只修改草稿");
    expect(version.rows[0].text).toBe("对不起，妈妈。");
    expect(restored.selectionByRowId).toEqual({
      "dialogue-1": true,
      "ambience-1": true,
    });
  });
});
