import { expect, it, vi } from "vitest";
import { appendCommandConversation } from "./commandConversation";
import type { ChatMessage } from "./types";
const user: ChatMessage = {
  id: "u",
  role: "user",
  content: "open mailbox",
  timestamp: 1,
  interfaceAction: true,
};
const assistant: ChatMessage = {
  id: "a",
  role: "assistant",
  content: "Opening",
  timestamp: 2,
  interfaceAction: true,
};
it("stores a command receipt in its existing story and does not create a story on the selection screen", async () => {
  const append = vi.fn().mockResolvedValue({});
  expect(
    await appendCommandConversation(append, null, user, assistant, null)
  ).toBe(false);
  expect(append).not.toHaveBeenCalled();
  expect(
    await appendCommandConversation(append, 7, user, assistant, null)
  ).toBe(true);
  expect(append).toHaveBeenCalledWith({
    storyId: 7,
    userMessage: {
      clientMessageId: "u",
      content: "open mailbox",
      selection: null,
    },
    assistantMessage: { clientMessageId: "a", content: "Opening" },
  });
});
it("does not retry a completed command when storing its conversation fails", async () => {
  const append = vi.fn().mockRejectedValue(new Error("offline"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(
      await appendCommandConversation(append, 7, user, assistant, null)
    ).toBe(false);
    expect(append).toHaveBeenCalledOnce();
  } finally {
    warn.mockRestore();
  }
});
