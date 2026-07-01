import { describe, expect, it } from "vitest";
import type { StoryPromptAggregate } from "@shared/promptLineage";
import { resolveSelectionPromptTarget } from "./selectionPromptCandidate";

function aggregate(): StoryPromptAggregate {
  return {
    state: {
      id: 1,
      storyId: 36,
      userId: 7,
      version: 3,
      migrationStatus: "migrated",
      migratedAt: null,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
    nodes: [
      {
        id: 10,
        storyId: 36,
        userId: 7,
        stableShotId: null,
        scope: "story",
        modality: "shared",
        dimension: "dialogue",
        currentRevisionId: 20,
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
      {
        id: 11,
        storyId: 36,
        userId: 7,
        stableShotId: "shot-01",
        scope: "shot",
        modality: "dialogue",
        dimension: "dialogue",
        currentRevisionId: 21,
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    ],
    revisions: [],
    bindings: [],
    compilations: [],
    compilationInputs: [],
    compilationHeads: [],
    conversation: null,
    messages: [],
    messageReferences: [],
    artBinding: null,
  };
}

describe("resolveSelectionPromptTarget", () => {
  it("prefers the current shot node over a story-level node", () => {
    const target = resolveSelectionPromptTarget({
      selection: {
        sourceType: "shot",
        sourceId: "0:dialogue",
        selectedText: "旧台词",
        fullText: "旧台词",
        storyId: 36,
        stableShotId: "shot-01",
        shotNo: 1,
      },
      shots: [{ shotNo: 1, stableShotId: "shot-01" } as never],
      aggregate: aggregate(),
    });

    expect(target).toMatchObject({
      nodeId: 11,
      stableShotId: "shot-01",
      dimension: "dialogue",
    });
  });

  it("does not invent a prompt target for an unmapped card selection", () => {
    expect(
      resolveSelectionPromptTarget({
        selection: {
          sourceType: "card",
          sourceId: "card-1",
          selectedText: "片段",
          fullText: "完整卡片",
        },
        shots: [],
        aggregate: aggregate(),
      }),
    ).toBeNull();
  });
});
