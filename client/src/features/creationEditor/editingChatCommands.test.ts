import { describe, expect, it } from "vitest";
import {
  parseLocalEditingChatCommand,
  shouldDeferStoryboardImageCommand,
} from "./editingChatCommands";

describe("parseLocalEditingChatCommand", () => {
  it.each(["撤销", "把刚才的修改改回来", "取消上一步剪辑", "回到上一步"])(
    "recognizes undo instruction: %s",
    instruction => {
      expect(parseLocalEditingChatCommand(instruction)).toEqual({
        type: "undo",
      });
    }
  );

  it("does not confuse a media edit with history undo", () => {
    expect(parseLocalEditingChatCommand("取消倒放")).toBeNull();
    expect(parseLocalEditingChatCommand("恢复原声")).toBeNull();
  });

  it("recognizes capability help", () => {
    expect(parseLocalEditingChatCommand("聊天框能做什么？")).toEqual({
      type: "capabilities",
    });
  });
});

describe("shouldDeferStoryboardImageCommand", () => {
  it("lets the prompt editor handle an image-content request that changed no timeline state", () => {
    expect(
      shouldDeferStoryboardImageCommand({
        sourceType: "storyboard-image",
        appliedCount: 0,
        hasProposal: false,
      })
    ).toBe(true);
  });

  it("keeps applied image transforms in the timeline command runner", () => {
    expect(
      shouldDeferStoryboardImageCommand({
        sourceType: "storyboard-image",
        appliedCount: 1,
        hasProposal: false,
      })
    ).toBe(false);
  });
});
