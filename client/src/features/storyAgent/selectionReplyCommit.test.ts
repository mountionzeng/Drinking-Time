import { describe, expect, it, vi } from "vitest";
import { commitSelectionReply } from "./selectionReplyCommit";
import { normalizeChatMessages, type SelectionState } from "./types";
describe("image revision conversation lifecycle", () => {
  it.each([true, false])(
    "retains selection only for cancelled/failed renders: %s",
    async retainSelection => {
      const setActiveSelection = vi.fn();
      await commitSelectionReply({
        nextMessages: [],
        reply: { id: "r", role: "assistant", content: "结果", timestamp: 2 },
        userMessage: { id: "u", role: "user", content: "修改", timestamp: 1 },
        selection: {
          sourceType: "storyboard-image",
          sourceId: "44",
          selectedText: "猫",
          fullText: "猫",
        } as SelectionState,
        storyId: 7,
        setMessages: vi.fn(),
        setActiveSelection,
        appendTurn: vi.fn(),
        archive: vi.fn(),
        persistWarning: "test",
        retainSelection,
      });
      expect(setActiveSelection).toHaveBeenCalledTimes(retainSelection ? 0 : 1);
    }
  );
  it("retains a selectable image revision when normalizing archived messages", () => {
    const imageRevision = {
      storyId: 7,
      stableShotId: "shot-a",
      shotNo: 2,
      imageId: 48,
      imageUrl: "/48.png",
    };
    expect(
      normalizeChatMessages([
        {
          id: "r",
          role: "assistant",
          content: "已生成",
          timestamp: 2,
          imageRevision,
        },
      ], [])[0].imageRevision
    ).toEqual(imageRevision);
  });
});
