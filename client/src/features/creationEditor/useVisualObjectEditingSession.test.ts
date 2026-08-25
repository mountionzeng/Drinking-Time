import { describe, expect, it } from "vitest";
import { visualEditingSessionIdentity } from "./useVisualObjectEditingSession";

describe("visualEditingSessionIdentity", () => {
  it("changes when the same Story activates a new editor epoch", () => {
    expect(visualEditingSessionIdentity(42, "epoch-a")).not.toBe(
      visualEditingSessionIdentity(42, "epoch-b")
    );
  });

  it("keeps different stories isolated inside the same epoch", () => {
    expect(visualEditingSessionIdentity(41, "epoch-a")).not.toBe(
      visualEditingSessionIdentity(42, "epoch-a")
    );
  });
});
