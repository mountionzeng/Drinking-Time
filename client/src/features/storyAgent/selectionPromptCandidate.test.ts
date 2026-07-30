import { describe, expect, it } from "vitest";
import type { StoryPromptAggregate } from "@shared/promptLineage";
import {
  resolveSelectionEditText,
  resolveSelectionPromptTarget,
} from "./selectionPromptCandidate";

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
      {
        id: 12,
        storyId: 36,
        userId: 7,
        stableShotId: "shot-01",
        scope: "modality",
        modality: "image",
        dimension: "image_prompt",
        currentRevisionId: 22,
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:00:00.000Z",
      },
    ],
    revisions: [
      {
        id: 22,
        storyId: 36,
        userId: 7,
        nodeId: 12,
        parentRevisionId: null,
        content: "女主穿白色长裙站在红黑空间中。",
        weight: 0.5,
        authorType: "migration",
        authorUserId: null,
        reason: null,
        source: "shot.promptDraft",
        status: "confirmed",
        createdAt: "2026-06-30T00:00:00.000Z",
        decidedAt: "2026-06-30T00:00:00.000Z",
      },
    ],
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

  it("maps a storyboard image selection to the shot image prompt", () => {
    const target = resolveSelectionPromptTarget({
      selection: {
        sourceType: "storyboard-image",
        sourceId: "1417",
        selectedText: "0201 · 首帧 · 图片构图调整",
        fullText: "0201 首帧，旋转、缩放与位置调整",
        storyId: 36,
        stableShotId: "shot-01",
        shotNo: 1,
        cueCode: "0201",
        imageId: 1417,
      },
      shots: [{ shotNo: 1, stableShotId: "shot-01" } as never],
      aggregate: aggregate(),
    });

    expect(target).toMatchObject({
      nodeId: 12,
      stableShotId: "shot-01",
      dimension: "image_prompt",
      label: "0201 · 图片要求",
      currentContent: "女主穿白色长裙站在红黑空间中。",
    });
  });

  it("edits the current image prompt instead of the image-editor placeholder", () => {
    expect(
      resolveSelectionEditText({
        selection: {
          sourceType: "storyboard-image",
          sourceId: "1417",
          selectedText: "0201 · 首帧 · 图片构图调整",
          fullText: "0201 首帧，旋转、缩放与位置调整",
        },
        target: {
          nodeId: 12,
          stableShotId: "shot-01",
          dimension: "image_prompt",
          label: "0201 · 图片要求",
          currentContent: "女主穿白色长裙站在红黑空间中。",
        },
      }),
    ).toEqual({
      fullText: "女主穿白色长裙站在红黑空间中。",
      selectedText: "女主穿白色长裙站在红黑空间中。",
    });
  });
});
