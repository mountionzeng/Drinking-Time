import { describe, expect, it } from "vitest";
import {
  isStoryScopeReady,
  resolveInitialStoryLoading,
} from "./creationEditorReadiness";

describe("isStoryScopeReady", () => {
  it("is false while no activeId is chosen yet", () => {
    expect(
      isStoryScopeReady({
        activeId: null,
        spineActiveStoryId: null,
        spineRemoteStoryId: undefined,
      })
    ).toBe(false);
  });

  it("is true once spine activeStoryId matches activeId, zero shots included", () => {
    expect(
      isStoryScopeReady({
        activeId: 1186,
        spineActiveStoryId: 1186,
        spineRemoteStoryId: undefined,
      })
    ).toBe(true);
  });

  it("is true when spine remoteStoryId matches activeId (activeStoryId still resolving)", () => {
    expect(
      isStoryScopeReady({
        activeId: 1186,
        spineActiveStoryId: null,
        spineRemoteStoryId: 1186,
      })
    ).toBe(true);
  });

  it("is true for a new unsaved draft (-1) once spine catches up", () => {
    expect(
      isStoryScopeReady({
        activeId: -1,
        spineActiveStoryId: -1,
        spineRemoteStoryId: undefined,
      })
    ).toBe(true);
  });

  it("stays false mid-switch: spine still reflects the previous story", () => {
    expect(
      isStoryScopeReady({
        activeId: 1200,
        spineActiveStoryId: 1186,
        spineRemoteStoryId: 1186,
      })
    ).toBe(false);
  });
});

describe("resolveInitialStoryLoading", () => {
  it("mirrors the negation of isStoryScopeReady", () => {
    expect(
      resolveInitialStoryLoading({
        activeId: 1186,
        spineActiveStoryId: 1186,
        spineRemoteStoryId: undefined,
      })
    ).toBe(false);
    expect(
      resolveInitialStoryLoading({
        activeId: 1186,
        spineActiveStoryId: null,
        spineRemoteStoryId: null,
      })
    ).toBe(true);
  });
});
