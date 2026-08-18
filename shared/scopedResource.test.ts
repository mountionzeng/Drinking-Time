import { describe, expect, it } from "vitest";
import { scopeKeysEqual } from "./scopedResource";

describe("scopeKeysEqual", () => {
  it("treats identical story scopes as equal", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "story", storyId: 1 },
        { resourceKind: "story", storyId: 1 }
      )
    ).toBe(true);
  });

  it("treats different resourceKind as unequal even with the same storyId", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "story", storyId: 1 },
        { resourceKind: "publishingVersion", storyId: 1, versionId: "v1" }
      )
    ).toBe(false);
  });

  it("treats different versionId under the same story as unequal", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "publishingVersion", storyId: 1, versionId: "v1" },
        { resourceKind: "publishingVersion", storyId: 1, versionId: "v2" }
      )
    ).toBe(false);
  });

  it("treats different storyId as unequal even with the same stableShotId", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "stableShot", storyId: 1, stableShotId: "s1" },
        { resourceKind: "stableShot", storyId: 2, stableShotId: "s1" }
      )
    ).toBe(false);
  });

  it("treats identical cover scopes as equal", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "cover", storyId: 1, versionId: "v1" },
        { resourceKind: "cover", storyId: 1, versionId: "v1" }
      )
    ).toBe(true);
  });

  it("treats a cover and a publishingVersion sharing the same storyId+versionId as unequal", () => {
    // Same storyId and versionId, different resourceKind — must not collide
    // just because their non-discriminant fields happen to match.
    expect(
      scopeKeysEqual(
        { resourceKind: "cover", storyId: 1, versionId: "v1" },
        { resourceKind: "publishingVersion", storyId: 1, versionId: "v1" }
      )
    ).toBe(false);
  });
});
