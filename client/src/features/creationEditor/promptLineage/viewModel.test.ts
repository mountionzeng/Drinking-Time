import { describe, expect, it } from "vitest";
import type {
  PromptCompilation,
  PromptCompilationHead,
  PromptCompilationInput,
  PromptNode,
  PromptNodeBinding,
  PromptRevision,
  StoryPromptAggregate,
  StoryPromptState,
} from "@shared/promptLineage";
import {
  buildPromptLineageRevisionPreview,
  buildPromptLineageShotView,
} from "./viewModel";

function state(): StoryPromptState {
  return {
    id: 1,
    storyId: 9,
    userId: 7,
    version: 3,
    migrationStatus: "migrated",
    migratedAt: "2026-06-30T10:00:00.000Z",
    createdAt: "2026-06-30T10:00:00.000Z",
    updatedAt: "2026-06-30T10:00:00.000Z",
  };
}

function node(
  id: number,
  input: Partial<PromptNode> & {
    stableShotId: string | null;
    scope: PromptNode["scope"];
    modality: PromptNode["modality"];
    dimension: string;
    currentRevisionId: number;
  },
): PromptNode {
  return {
    id,
    storyId: 9,
    userId: 7,
    stableShotId: input.stableShotId,
    scope: input.scope,
    modality: input.modality,
    dimension: input.dimension,
    currentRevisionId: input.currentRevisionId,
    createdAt: "2026-06-30T10:00:00.000Z",
    updatedAt: "2026-06-30T10:00:00.000Z",
  };
}

function revision(
  id: number,
  nodeId: number,
  content: string,
  overrides: Partial<PromptRevision> = {},
): PromptRevision {
  return {
    id,
    storyId: 9,
    userId: 7,
    nodeId,
    parentRevisionId: null,
    content,
    weight: 0.3,
    authorType: "migration",
    authorUserId: null,
    reason: null,
    source: null,
    status: "confirmed",
    createdAt: "2026-06-30T10:00:00.000Z",
    decidedAt: "2026-06-30T10:00:00.000Z",
    ...overrides,
  };
}

function binding(
  id: number,
  nodeId: number,
  stableShotId: string | null,
  modality: PromptNodeBinding["modality"],
  sortOrder: number,
): PromptNodeBinding {
  return {
    id,
    storyId: 9,
    userId: 7,
    nodeId,
    stableShotId,
    modality,
    sortOrder,
    createdAt: "2026-06-30T10:00:00.000Z",
  };
}

function head(
  id: number,
  stableShotId: string,
  modality: PromptCompilationHead["modality"],
  currentCompilationId: number,
): PromptCompilationHead {
  return {
    id,
    storyId: 9,
    userId: 7,
    stableShotId,
    modality,
    currentCompilationId,
    updatedAt: "2026-06-30T10:00:00.000Z",
  };
}

function compilation(
  id: number,
  stableShotId: string,
  modality: PromptCompilation["modality"],
  finalText: string,
): PromptCompilation {
  return {
    id,
    storyId: 9,
    userId: 7,
    stableShotId,
    modality,
    finalText,
    inputFingerprint: `fp-${id}`,
    createdAt: "2026-06-30T10:00:00.000Z",
  };
}

function compilationInput(
  id: number,
  compilationId: number,
  revisionId: number,
  position: number,
): PromptCompilationInput {
  return { id, compilationId, revisionId, position };
}

function aggregate(): StoryPromptAggregate {
  return {
    state: state(),
    nodes: [
      node(1, {
        stableShotId: null,
        scope: "story",
        modality: "shared",
        dimension: "visual_style",
        currentRevisionId: 11,
      }),
      node(2, {
        stableShotId: "shot-01",
        scope: "shot",
        modality: "shared",
        dimension: "subject",
        currentRevisionId: 12,
      }),
      node(3, {
        stableShotId: "shot-01",
        scope: "modality",
        modality: "video",
        dimension: "camera_motion",
        currentRevisionId: 13,
      }),
      node(4, {
        stableShotId: "shot-02",
        scope: "shot",
        modality: "shared",
        dimension: "subject",
        currentRevisionId: 14,
      }),
    ],
    revisions: [
      revision(11, 1, "soft film grain, warm neutral palette", {
        weight: 0.36,
      }),
      revision(12, 2, "她站在窗边，准备开口", { weight: 0.42 }),
      revision(13, 3, "缓慢推近", { weight: 0.36 }),
      revision(14, 4, "第二镜人物转身", { weight: 0.42 }),
      revision(21, 3, "固定镜头，几乎不动", {
        parentRevisionId: 13,
        weight: 0.36,
        authorType: "user",
        authorUserId: 7,
        status: "candidate",
      }),
      revision(22, 1, "desaturated realism, cool fluorescent light", {
        parentRevisionId: 11,
        weight: 0.36,
        authorType: "user",
        authorUserId: 7,
        status: "confirmed",
      }),
    ],
    bindings: [
      binding(1, 1, null, "shared", 1),
      binding(2, 2, "shot-01", "shared", 2),
      binding(3, 3, "shot-01", "video", 3),
      binding(4, 4, "shot-02", "shared", 2),
    ],
    compilations: [
      compilation(31, "shot-01", "image", "visual_style: soft film grain"),
      compilation(32, "shot-01", "video", "camera_motion: 缓慢推近"),
    ],
    compilationInputs: [
      compilationInput(1, 31, 11, 0),
      compilationInput(2, 31, 12, 1),
      compilationInput(3, 32, 11, 0),
      compilationInput(4, 32, 12, 1),
      compilationInput(5, 32, 13, 2),
    ],
    compilationHeads: [
      head(1, "shot-01", "dialogue", 41),
      head(2, "shot-01", "image", 31),
      head(3, "shot-01", "video", 32),
      head(4, "shot-02", "dialogue", 42),
      head(5, "shot-02", "image", 43),
      head(6, "shot-02", "video", 44),
    ],
    conversation: null,
    messages: [],
    messageReferences: [],
    artBinding: null,
  };
}

describe("prompt lineage view model", () => {
  it("builds shot rows from the lineage projection with inheritance and usage", () => {
    const view = buildPromptLineageShotView({
      aggregate: aggregate(),
      stableShotId: "shot-01",
      shotNo: 1,
    });

    expect(view.version).toBe(3);
    expect(view.compilationIds.video).toBe(32);
    expect(view.rows.map(row => row.label)).toEqual([
      "全局美术",
      "主体",
      "相机运动",
    ]);
    expect(view.rows[0]?.inheritance).toBe("inherited");
    expect(view.rows[0]?.usedBy).toEqual(["dialogue", "image", "video"]);
    expect(view.rows[1]?.weight).toBe(0.42);
    expect(view.rows[1]?.inheritance).toBe("own");
    expect(view.rows[2]?.category).toBe("motion");
  });

  it("previews a modality-local revision as only changing the video target", () => {
    const preview = buildPromptLineageRevisionPreview({
      aggregate: aggregate(),
      nodeId: 3,
      revisionId: 21,
    });

    expect(preview.shots).toHaveLength(1);
    expect(preview.shots[0]?.stableShotId).toBe("shot-01");
    expect(preview.shots[0]?.impactedModalities).toEqual(["video"]);
    expect(preview.shots[0]?.current.video.finalText).toContain(
      "camera_motion(36%): 缓慢推近",
    );
    expect(preview.shots[0]?.proposed.video.finalText).toContain(
      "camera_motion(36%): 固定镜头，几乎不动",
    );
  });

  it("previews a story-level revision as impacting every shot", () => {
    const preview = buildPromptLineageRevisionPreview({
      aggregate: aggregate(),
      nodeId: 1,
      revisionId: 22,
    });

    expect(preview.shots.map(shot => shot.stableShotId)).toEqual([
      "shot-01",
      "shot-02",
    ]);
    for (const shot of preview.shots) {
      expect(shot.impactedModalities).toEqual(["dialogue", "image", "video"]);
      expect(shot.proposed.image.finalText).toContain(
        "visual_style(36%): desaturated realism, cool fluorescent light",
      );
    }
  });
});
