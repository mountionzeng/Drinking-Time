import { expect, it, vi } from "vitest";
import { completeChatVideo } from "./chatVideoCompletion";

it("waits for the exact completed take, then asks and adopts only after consent", async () => {
  const confirm = vi.fn(async () => true); const adopt = vi.fn();
  const read = vi.fn().mockReturnValueOnce({ id: 9, status: "processing" }).mockReturnValue({ id: 9, status: "available", videoUrl: "/9.mp4" });
  const wait = vi.fn(async () => { expect(confirm).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled(); });
  expect(await completeChatVideo({ takeId: 9, label: "01", current: () => true, read, wait, confirm, adopt })).toContain("已放入第 01 镜");
  expect(confirm).toHaveBeenCalledOnce(); expect(adopt).toHaveBeenCalledOnce();
});
it("retains a declined candidate and never adopts after leaving the story", async () => {
  const adopt = vi.fn(); let current = true;
  const input = { takeId: 9, label: "01", current: () => current, read: () => ({ id: 9, status: "available", videoUrl: "/9.mp4" }), adopt };
  expect(await completeChatVideo({ ...input, confirm: async () => false })).toContain("尚未放入");
  expect(await completeChatVideo({ ...input, confirm: async () => { current = false; return true; } })).toContain("原故事仓库");
  expect(adopt).not.toHaveBeenCalled();
});
it("reports failed or overdue tasks without prompting placement or repurchasing", async () => {
  const confirm = vi.fn(); const adopt = vi.fn(); let time = 0;
  const input = { takeId: 9, label: "01", current: () => true, confirm, adopt };
  expect(await completeChatVideo({ ...input, read: () => ({ id: 9, status: "failed" }) })).toContain("未生成成功");
  expect(await completeChatVideo({ ...input, read: () => ({ id: 9, status: "timeout" }) })).toContain("暂时无法确认结果");
  expect(await completeChatVideo({ ...input, read: () => ({ id: 9, status: "unfollowable" }) })).toContain("暂时无法确认结果");
  expect(await completeChatVideo({ ...input, read: () => ({ id: 10, status: "available", videoUrl: "/wrong.mp4" }), now: () => time, timeoutMs: 2, wait: async () => { time++; } })).toContain("仍在原任务");
  expect(confirm).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled();
});
