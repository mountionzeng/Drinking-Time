import { afterEach, describe, expect, it, vi } from "vitest";
import { readVisualAssetGenerationDraft } from "./useVisualAssetGenerationDraft";

afterEach(() => vi.unstubAllGlobals());
describe("visual asset generation draft", () => {
  it("recovers the exact art instruction and optional top selection by story", () => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => key.endsWith(":7")
      ? JSON.stringify({ instructions: { v1: "朦胧彩铅" }, topViews: { v1: true } }) : null });
    expect(readVisualAssetGenerationDraft(7)).toEqual({ instructions: { v1: "朦胧彩铅" }, topViews: { v1: true } });
    expect(readVisualAssetGenerationDraft(8)).toEqual({ instructions: {}, topViews: {} });
  });
  it("handles denied storage and malformed drafts without affecting the asset store", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); } });
    expect(readVisualAssetGenerationDraft(7)).toEqual({ instructions: {}, topViews: {} });
    vi.stubGlobal("localStorage", { getItem: () => '{"instructions":{"v":42},"topViews":{"v":"yes"}}' });
    expect(readVisualAssetGenerationDraft(7)).toEqual({ instructions: {}, topViews: {} });
  });
});
