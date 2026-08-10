import { describe, expect, it } from "vitest";
import {
  getCoverGenerationPresentation,
  shouldRecoverCoverGeneration,
} from "./publishingCoverGenerationState";

describe("getCoverGenerationPresentation", () => {
  it("only marks the fresh action as loading when creating a new round", () => {
    expect(getCoverGenerationPresentation("fresh")).toMatchObject({
      freshLoading: true,
      reviseLoading: false,
    });
  });

  it("only marks the revision action as loading when revising a candidate", () => {
    expect(getCoverGenerationPresentation("revise")).toMatchObject({
      freshLoading: false,
      reviseLoading: true,
    });
  });

  it("has no loading state once a request has settled", () => {
    expect(getCoverGenerationPresentation(null)).toEqual({
      freshLoading: false,
      reviseLoading: false,
      message: null,
    });
  });
});

describe("shouldRecoverCoverGeneration", () => {
  const generation = {
    operationToken: "cover-op-1",
    versionId: "v1",
    status: "failed" as const,
    platform: "xiaohongshu" as const,
    referenceAssetId: null,
    feedback: "",
    prompt: "durable prompt",
    roundId: "round-1",
    taskId: "302-task-1",
    claimedAt: 1,
    updatedAt: 2,
    expiresAt: 3,
    error: "302 Midjourney task timeout",
  };

  it("recovers an accepted paid task after a transient network failure", () => {
    expect(shouldRecoverCoverGeneration(generation)).toBe(true);
  });

  it("does not recover a provider rejection or a request without a task id", () => {
    expect(
      shouldRecoverCoverGeneration({
        ...generation,
        error: "prompt rejected by provider",
      })
    ).toBe(false);
    expect(shouldRecoverCoverGeneration({ ...generation, taskId: null })).toBe(
      false
    );
  });
});
