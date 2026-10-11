import { describe, expect, it } from "vitest";
import {
  creationFlowScopeMatches,
  creationFlowNeedsSaveChoice,
} from "./useCreationFlowChat";
import { parseCreationFlowFocus } from "../creationEditor/editingChatCommands";
import {
  creationFlowIntentAllows,
  isCreationFlowRequest,
} from "@shared/creationFlowCommand";
import {
  getMemorySelection,
  memorySelectionKey,
  setMemorySelection,
} from "../memoryWarehouse/memorySelectionStore";

describe("creation flow chat boundaries", () => {
  it("requires a save/discard/cancel choice for text edits, failed saves, and in-flight downstream writes", () => {
    expect(
      creationFlowNeedsSaveChoice({
        dirtyCount: 0,
        saveStatus: "saved",
        downstreamSaving: false,
      })
    ).toBe(false);
    expect(
      creationFlowNeedsSaveChoice({
        dirtyCount: 1,
        saveStatus: "saved",
        downstreamSaving: false,
      })
    ).toBe(true);
    expect(
      creationFlowNeedsSaveChoice({
        dirtyCount: 0,
        saveStatus: "error",
        downstreamSaving: false,
      })
    ).toBe(true);
    expect(
      creationFlowNeedsSaveChoice({
        dirtyCount: 0,
        saveStatus: "saved",
        downstreamSaving: true,
      })
    ).toBe(true);
  });
  it("routes explicit creation commands while ordinary recollection stays in chat", () => {
    expect(isCreationFlowRequest("查看影响")).toBe(true);
    expect(isCreationFlowRequest("把雨夜和外婆的记忆组合成文章")).toBe(true);
    expect(
      isCreationFlowRequest(
        "回到记忆，加入刚才关于雨声的那段，再用新版本做一份分镜给我比较"
      )
    ).toBe(true);
    expect(isCreationFlowRequest("用这个文字版本")).toBe(true);
    expect(isCreationFlowRequest("我记得那天在雨里写文章")).toBe(false);
    expect(isCreationFlowRequest("确认采用", false)).toBe(false);
    expect(isCreationFlowRequest("确认采用", true)).toBe(true);
    expect(parseCreationFlowFocus("回到记忆仓库")).toBe("memory");
    expect(parseCreationFlowFocus("回到刚才的位置")).toBe("origin");
    expect(parseCreationFlowFocus("我想起了回到老家的记忆")).toBeNull();
  });
  it("never treats generation of a timeline as permission to generate text, or ignores negation", () => {
    expect(
      creationFlowIntentAllows(
        { type: "setCurrentSource", draft: "x" },
        "查看当前来源"
      )
    ).toBe(false);
    const generate = { type: "generateDraft" as const, instruction: "" };
    expect(creationFlowIntentAllows(generate, "生成时间线候选")).toBe(false);
    expect(creationFlowIntentAllows(generate, "把记忆组合成文章")).toBe(true);
    expect(
      creationFlowIntentAllows(generate, "把这些记忆找出来，不要生成文章")
    ).toBe(false);
    expect(
      creationFlowIntentAllows(
        { type: "adoptCandidate", candidate: "x" },
        "查看候选，不要采用"
      )
    ).toBe(false);
  });
  it("rejects late responses after Story, text version, platform, or reload changes", () => {
    const before = {
      storyId: 5,
      epoch: 2,
      version: "v1",
      platform: "xiaohongshu",
    };
    expect(creationFlowScopeMatches(before, { ...before })).toBe(true);
    for (const after of [
      { ...before, storyId: 6 },
      { ...before, epoch: 3 },
      { ...before, version: "v2" },
      { ...before, platform: "x" },
    ])
      expect(creationFlowScopeMatches(before, after)).toBe(false);
  });
  it("shares ordered selections with the warehouse without crossing account or Story", () => {
    const key = memorySelectionKey(2, 8);
    setMemorySelection(key, [
      { id: "b", title: "雨" },
      { id: "a", title: "灯" },
    ]);
    expect(getMemorySelection(key).map(c => c.id)).toEqual(["b", "a"]);
    expect(getMemorySelection(memorySelectionKey(3, 8))).toEqual([]);
    expect(getMemorySelection(memorySelectionKey(2, 9))).toEqual([]);
    setMemorySelection(key, values => [...values].reverse());
    expect(getMemorySelection(key).map(c => c.id)).toEqual(["a", "b"]);
  });
});
