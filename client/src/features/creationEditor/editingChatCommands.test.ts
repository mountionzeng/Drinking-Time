import { describe, expect, it } from "vitest";
import { parseLocalEditingChatCommand } from "./editingChatCommands";

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
