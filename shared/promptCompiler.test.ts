import { describe, expect, it } from "vitest";
import type {
  PromptNode,
  PromptNodeBinding,
  PromptRevision,
} from "./promptLineage";
import { compilePromptTargets } from "./promptCompiler";

const timestamp = "2026-06-29T00:00:00.000Z";
const owner = { storyId: 28, userId: 7 };

const nodes: PromptNode[] = [
  {
    id: 1,
    ...owner,
    stableShotId: "shot-01",
    scope: "shot",
    modality: "shared",
    dimension: "subject",
    currentRevisionId: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 2,
    ...owner,
    stableShotId: "shot-01",
    scope: "modality",
    modality: "dialogue",
    dimension: "dialogue",
    currentRevisionId: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: 3,
    ...owner,
    stableShotId: "shot-01",
    scope: "modality",
    modality: "video",
    dimension: "camera_motion",
    currentRevisionId: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

const revisions: PromptRevision[] = [
  {
    id: 1,
    nodeId: 1,
    ...owner,
    parentRevisionId: null,
    content: "主角穿深色风衣",
    weight: 0.42,
    authorType: "user",
    authorUserId: 7,
    reason: null,
    source: null,
    status: "confirmed",
    createdAt: timestamp,
    decidedAt: timestamp,
  },
  {
    id: 2,
    nodeId: 2,
    ...owner,
    parentRevisionId: null,
    content: "没关系，就这样吧",
    weight: 0.34,
    authorType: "user",
    authorUserId: 7,
    reason: null,
    source: null,
    status: "confirmed",
    createdAt: timestamp,
    decidedAt: timestamp,
  },
  {
    id: 3,
    nodeId: 3,
    ...owner,
    parentRevisionId: null,
    content: "固定机位",
    weight: 0.36,
    authorType: "user",
    authorUserId: 7,
    reason: null,
    source: null,
    status: "confirmed",
    createdAt: timestamp,
    decidedAt: timestamp,
  },
  {
    id: 4,
    nodeId: 3,
    ...owner,
    parentRevisionId: 3,
    content: "缓慢推近",
    weight: 0.36,
    authorType: "user",
    authorUserId: 7,
    reason: null,
    source: null,
    status: "candidate",
    createdAt: timestamp,
    decidedAt: null,
  },
  {
    id: 5,
    nodeId: 1,
    ...owner,
    parentRevisionId: 1,
    content: "主角穿浅色衬衫",
    weight: 0.42,
    authorType: "user",
    authorUserId: 7,
    reason: null,
    source: null,
    status: "candidate",
    createdAt: timestamp,
    decidedAt: null,
  },
];

const bindings: PromptNodeBinding[] = nodes.map((node, index) => ({
  id: index + 1,
  ...owner,
  nodeId: node.id,
  stableShotId: "shot-01",
  modality: node.modality,
  sortOrder: index,
  createdAt: timestamp,
}));

describe("compilePromptTargets", () => {
  it("changes only video when a video-local revision is previewed", () => {
    const current = compilePromptTargets({
      stableShotId: "shot-01",
      nodes,
      revisions,
      bindings,
    });
    const proposed = compilePromptTargets({
      stableShotId: "shot-01",
      nodes,
      revisions,
      bindings,
      revisionOverrides: { 3: 4 },
    });

    expect(proposed.dialogue.inputFingerprint).toBe(
      current.dialogue.inputFingerprint,
    );
    expect(proposed.image.inputFingerprint).toBe(
      current.image.inputFingerprint,
    );
    expect(proposed.video.inputFingerprint).not.toBe(
      current.video.inputFingerprint,
    );
    expect(proposed.video.finalText).toContain("缓慢推近");
  });

  it("changes all modalities when a shared revision is previewed", () => {
    const current = compilePromptTargets({
      stableShotId: "shot-01",
      nodes,
      revisions,
      bindings,
    });
    const proposed = compilePromptTargets({
      stableShotId: "shot-01",
      nodes,
      revisions,
      bindings,
      revisionOverrides: { 1: 5 },
    });

    for (const modality of ["dialogue", "image", "video"] as const) {
      expect(proposed[modality].inputFingerprint).not.toBe(
        current[modality].inputFingerprint,
      );
      expect(proposed[modality].revisionIds[0]).toBe(5);
    }
  });

  it("orders inputs by binding order regardless of node array order", () => {
    const compiled = compilePromptTargets({
      stableShotId: "shot-01",
      nodes: [...nodes].reverse(),
      revisions,
      bindings,
    });

    expect(compiled.video.revisionIds).toEqual([1, 3]);
    expect(compiled.video.finalText.indexOf("主角穿深色风衣")).toBeLessThan(
      compiled.video.finalText.indexOf("固定机位"),
    );
  });

  it("treats weight-only changes as a real compilation change", () => {
    const current = compilePromptTargets({
      stableShotId: "shot-01",
      nodes,
      revisions,
      bindings,
    });
    const weightedRevisions = revisions.map(revision =>
      revision.id === 3 ? { ...revision, weight: 0.55 } : revision,
    );
    const proposed = compilePromptTargets({
      stableShotId: "shot-01",
      nodes,
      revisions: weightedRevisions,
      bindings,
    });

    expect(proposed.video.inputFingerprint).not.toBe(
      current.video.inputFingerprint,
    );
    expect(proposed.video.finalText).toContain("camera_motion(55%): 固定机位");
  });
});
