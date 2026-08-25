import { beforeEach, describe, expect, it } from "vitest";
import {
  activateVisualEditSession,
  clearVisualEditSessionsForTesting,
  isVisualEditSessionEpochAllowed,
} from "./visualEditSessionRegistry";

describe("visual edit session activation ordering", () => {
  beforeEach(() => clearVisualEditSessionsForTesting());

  it("rejects a late older activation without replacing the newer epoch", () => {
    const scope = { storyId: 8, userId: 3, editorClientId: "tab-a" };
    expect(
      activateVisualEditSession({
        ...scope,
        editorSessionEpoch: "epoch-new",
        activationSequence: 2,
      })
    ).toMatchObject({ status: "ok", activeEpoch: "epoch-new" });
    expect(
      activateVisualEditSession({
        ...scope,
        editorSessionEpoch: "epoch-old",
        activationSequence: 1,
      })
    ).toMatchObject({ status: "error" });
    expect(
      isVisualEditSessionEpochAllowed({
        storyId: 8,
        userId: 3,
        editorSessionEpoch: "epoch-new",
      })
    ).toBe(true);
    expect(
      isVisualEditSessionEpochAllowed({
        storyId: 8,
        userId: 3,
        editorSessionEpoch: "epoch-old",
      })
    ).toBe(false);
  });

  it("is idempotent only for the same epoch at the same sequence", () => {
    const scope = { storyId: 8, userId: 3, editorClientId: "tab-a" };
    const activation = {
      ...scope,
      editorSessionEpoch: "epoch-a",
      activationSequence: 4,
    };
    expect(activateVisualEditSession(activation)).toMatchObject({ status: "ok" });
    expect(activateVisualEditSession(activation)).toMatchObject({ status: "ok" });
    expect(
      activateVisualEditSession({
        ...scope,
        editorSessionEpoch: "epoch-b",
        activationSequence: 4,
      })
    ).toMatchObject({ status: "error" });
    expect(
      isVisualEditSessionEpochAllowed({
        storyId: 8,
        userId: 3,
        editorSessionEpoch: "epoch-b",
      })
    ).toBe(false);
  });
});
