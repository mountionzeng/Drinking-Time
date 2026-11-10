import { expect, it, vi } from "vitest";
import { answerMediaChatQuestion, askMediaChatConfirmation, cancelMediaChatSession, mediaChatQuestionStore, withMediaChatSession } from "./mediaChatSession";

it("requires an answer in the same story before calling the paid renderer", async () => {
  const generate = vi.fn();
  const pending = withMediaChatSession(1, async () => {
    if (await askMediaChatConfirmation({ storyId: 1, text: "2.86 算力", kind: "cost" })) generate();
  });
  expect(generate).not.toHaveBeenCalled();
  expect(answerMediaChatQuestion(2, "确认")).toBe("none");
  expect(answerMediaChatQuestion(1, "再亮一点")).toBe("unknown");
  expect(generate).not.toHaveBeenCalled();
  expect(answerMediaChatQuestion(1, "确认")).toBe("answered");
  await pending; expect(generate).toHaveBeenCalledOnce();
  expect(mediaChatQuestionStore.getState().question).toBeNull();
});

it("cancels unanswered work on story exit and does not reuse an old confirmation", async () => {
  const pending = withMediaChatSession(3, async () => askMediaChatConfirmation({ storyId: 3, text: "生成？", kind: "cost" }));
  cancelMediaChatSession(3);
  expect(answerMediaChatQuestion(3, "确认")).toBe("none");
  expect(await pending).toBe(false);
  expect(askMediaChatConfirmation({ storyId: 3, text: "old", kind: "cost" })).toBeNull();
});

it("supports placement without a button and refuses duplicate conversations", async () => {
  const pending = withMediaChatSession(4, async () => askMediaChatConfirmation({ storyId: 4, text: "是否放入第01镜？", kind: "placement", videoUrl: "/clip.mp4" }));
  await expect(withMediaChatSession(4, async () => true)).rejects.toThrow("尚未结束");
  expect(answerMediaChatQuestion(4, "先保留")).toBe("answered");
  expect(await pending).toBe(false);
  const next = withMediaChatSession(4, async () => askMediaChatConfirmation({ storyId: 4, text: "是否放入第01镜？", kind: "placement" }));
  expect(answerMediaChatQuestion(4, "放入第一个镜头")).toBe("answered");
  expect(await next).toBe(true);
});
