import { expect, it, vi } from "vitest";
vi.mock("../db", async o => ({ ...await o<object>() }));
const { legnextPendingMessage } = await import("./storyAgent");
it("never repeats the 已受理 prefix", () => {
  expect(legnextPendingMessage("图片任务已受理，图片任务已受理，结果尚未返回")).toBe("图片任务已受理，结果尚未返回。请勿重复提交，稍后恢复该任务。");
  expect(legnextPendingMessage("图片任务已受理，结果尚未返回。请勿重复提交，稍后恢复。")).toBe("图片任务已受理，结果尚未返回。请勿重复提交，稍后恢复。");
  expect(legnextPendingMessage(undefined).match(/已受理/g)).toHaveLength(1);
});
