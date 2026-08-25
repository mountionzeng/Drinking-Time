import { describe, expect, it } from "vitest";
import {
  clearVisualIntentIfCurrent,
  visualClipboardTargetLayer,
} from "./EditingNleWorkspace";

describe("EditingNleWorkspace visual clipboard routing", () => {
  it("uses the copied image layer when keyboard paste has no explicit track", () => {
    expect(visualClipboardTargetLayer({ sourceLayer: 3 })).toBe(3);
  });

  it("does not let an old Story response clear a newer matching intent key", () => {
    const oldOperation = { editorSessionEpoch: "story-a", operationId: "old" };
    const newOperation = { editorSessionEpoch: "story-b", operationId: "new" };
    const intents = new Map([["same-key", newOperation]]);
    clearVisualIntentIfCurrent(intents, "same-key", oldOperation);
    expect(intents.get("same-key")).toBe(newOperation);
    clearVisualIntentIfCurrent(intents, "same-key", newOperation);
    expect(intents.has("same-key")).toBe(false);
  });

  it("uses the right-click track when paste has an explicit target", () => {
    expect(visualClipboardTargetLayer({ sourceLayer: 3 }, 1)).toBe(1);
    expect(visualClipboardTargetLayer({ sourceLayer: 3 }, 0)).toBe(0);
  });
});
