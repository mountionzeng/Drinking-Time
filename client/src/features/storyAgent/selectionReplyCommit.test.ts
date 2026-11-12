import { describe, expect, it, vi } from "vitest";
import { archiveMessagesFrom } from "./StoryAgentContext";
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
      normalizeChatMessages(archiveMessagesFrom([
        {
          id: "r",
          role: "assistant",
          content: "已生成",
          timestamp: 2,
          imageRevision,
        },
      ], []), [])[0].imageRevision
    ).toEqual(imageRevision);
  });
});

it("merges a late image reply without erasing messages that arrived during generation", async () => {
  const user = { id: "u", role: "user" as const, content: "改图", timestamp: 1 };
  const later = { id: "later", role: "user" as const, content: "其他内容", timestamp: 2 };
  const setMessages = vi.fn();
  await commitSelectionReply({ nextMessages: [user], currentMessages: () => [user, later], reply: { id: "r", role: "assistant", content: "图片已完成", timestamp: 3 }, userMessage: user,
    selection: {} as SelectionState, storyId: null, setMessages, setActiveSelection: vi.fn(), appendTurn: vi.fn(), archive: vi.fn(), persistWarning: "test" });
  expect(setMessages.mock.calls[0][0].map((m: any) => m.id)).toEqual(["u", "later", "r"]);
});


it("preserves source frame identity and times through chat archive/reload", () => {
  const frame = { storyId: 7, stableShotId: "shot-c", shotNo: 3, imageId: 55, imageUrl: "/api/images/reference.png", takeId: 10, timelineFrame: 616, shotTimeSec: 2.1667, sourceTimeSec: 4.1667 };
  const restored = normalizeChatMessages(archiveMessagesFrom([{ id: "frame-reply", role: "assistant", content: "参考帧", timestamp: 4, frameReferences: [frame] }], []), []);
  expect(restored[0].frameReferences).toEqual([frame]);
});
