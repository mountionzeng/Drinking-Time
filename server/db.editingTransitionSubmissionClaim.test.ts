import { beforeEach, describe, expect, it } from "vitest";
import type { InsertVideoTake } from "../drizzle/schema";
import {
  claimEditingTransitionSubmission,
  createStory,
  createVideoTake,
  resetMemoryStateForTesting,
} from "./db";

const USER_ID = 17;

function transitionSnapshot(candidateId: string) {
  return {
    kind: "editing-transition",
    candidate: {
      candidateId,
      storyId: 1,
      expectedTimelineVersion: 4,
      source: { stableShotId: "shot-a" },
      target: { stableShotId: "shot-b" },
    },
    submissionState: "not_started",
  };
}

function takeInput(
  candidateId: string
): Omit<InsertVideoTake, "id" | "createdAt" | "updatedAt"> {
  return {
    storyId: 1,
    userId: USER_ID,
    stableShotId: `transition-shot-${candidateId}`,
    sourceImageId: 101,
    promptCompilationId: null,
    status: "submitted",
    provider: "302",
    model: "viduq2-turbo",
    prompt: "fast turn",
    subtitle: null,
    durationSec: 2,
    aspectRatio: "1:1",
    parameterSnapshot: transitionSnapshot(candidateId),
    idempotencyKey: `editing-transition:${candidateId}`,
    extractionCapability: "unavailable",
  };
}

describe("claimEditingTransitionSubmission", () => {
  beforeEach(async () => {
    resetMemoryStateForTesting();
    await createStory({
      userId: USER_ID,
      title: "transition claim",
      body: { shots: [] },
    });
  });

  it("同一 candidate 的并发 caller 只有一个获得提交权", async () => {
    const take = await createVideoTake(takeInput("candidate-a"));

    const results = await Promise.all([
      claimEditingTransitionSubmission({
        takeId: take.id,
        storyId: take.storyId,
        userId: USER_ID,
      }),
      claimEditingTransitionSubmission({
        takeId: take.id,
        storyId: take.storyId,
        userId: USER_ID,
      }),
    ]);

    expect(results.filter(result => result.claimed)).toHaveLength(1);
    expect(results.filter(result => !result.claimed)).toEqual([
      expect.objectContaining({ reason: "already_claimed" }),
    ]);
  });

  it("同一时间线与相邻镜头槽位的不同 candidate 只能一个取得提交权", async () => {
    const first = await createVideoTake(takeInput("candidate-a"));
    const second = await createVideoTake(takeInput("candidate-b"));

    const results = await Promise.all([
      claimEditingTransitionSubmission({
        takeId: first.id,
        storyId: first.storyId,
        userId: USER_ID,
      }),
      claimEditingTransitionSubmission({
        takeId: second.id,
        storyId: second.storyId,
        userId: USER_ID,
      }),
    ]);

    expect(results.filter(result => result.claimed)).toHaveLength(1);
    expect(results.filter(result => !result.claimed)).toEqual([
      expect.objectContaining({ reason: "slot_occupied" }),
    ]);
  });
});
