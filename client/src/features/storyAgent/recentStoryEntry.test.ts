import { describe, expect, it } from "vitest";
import {
  resolveRecentStoryEntry,
  shouldRouteWorkspaceForStoryTransition,
  workspaceForStoryStage,
} from "./recentStoryEntry";

describe("resolveRecentStoryEntry", () => {
  const stories = [
    { id: 42, shotCount: 3 },
    { id: 17, shotCount: 0 },
  ];

  it("opens the first server-ordered story when no story is active", () => {
    expect(resolveRecentStoryEntry(stories, null)).toEqual({
      storyId: 42,
      workspace: "editing",
    });
  });

  it("does not replace an active or unsaved story", () => {
    expect(resolveRecentStoryEntry(stories, 17)).toBeNull();
    expect(resolveRecentStoryEntry(stories, -1)).toBeNull();
  });

  it("keeps an empty story library on the existing empty state", () => {
    expect(resolveRecentStoryEntry([], null)).toBeNull();
  });
});

describe("workspaceForStoryStage", () => {
  it("opens text-only stories in the writing workspace", () => {
    expect(workspaceForStoryStage(0)).toBe("publishing");
    expect(workspaceForStoryStage(undefined)).toBe("publishing");
  });

  it("opens stories with storyboard shots in image and sound", () => {
    expect(workspaceForStoryStage(1)).toBe("editing");
  });
});

describe("shouldRouteWorkspaceForStoryTransition", () => {
  it("routes again when the same story is reopened after returning to the list", () => {
    expect(shouldRouteWorkspaceForStoryTransition(42, null)).toBe(false);
    expect(shouldRouteWorkspaceForStoryTransition(null, 42)).toBe(true);
  });

  it("keeps the current workspace when an unsaved story receives its server id", () => {
    expect(shouldRouteWorkspaceForStoryTransition(-1, 42)).toBe(false);
  });

  it("routes once when switching between different persisted stories", () => {
    expect(shouldRouteWorkspaceForStoryTransition(17, 42)).toBe(true);
    expect(shouldRouteWorkspaceForStoryTransition(42, 42)).toBe(false);
  });
});
