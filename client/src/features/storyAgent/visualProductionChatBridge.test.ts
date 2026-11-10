import { expect, it, vi } from "vitest";
import { registerVisualProductionChat, runVisualProductionChat } from "./visualProductionChatBridge";
it("leaves selected image background edits to the existing revision executor", async () => {
  const runner = vi.fn(async () => "完成");
  const dispose = registerVisualProductionChat(9, runner);
  const selected = { sourceType: "storyboard-image" as const, sourceId: "image-2019", imageId: 2019 };
  expect(await runVisualProductionChat(9, "修改这张图片，背景改成彩色像素", selected)).toBeNull();
  expect(runner).not.toHaveBeenCalled();
  await runVisualProductionChat(9, "采用这张图片", selected);
  expect(runner).toHaveBeenCalledOnce(); dispose();
});
it("does not dispatch ordinary chat, a text selection, or another story", async () => {
  const runner = vi.fn(async () => "完成");
  const dispose = registerVisualProductionChat(1, runner);
  expect(await runVisualProductionChat(1, "今天很累")).toBeNull();
  expect(await runVisualProductionChat(1, "生成图片", { sourceType: "shot", sourceId: "s", selection: { kind: "text", start: 0, end: 1 } })).toBeNull();
  expect((await runVisualProductionChat(2, "生成图片"))?.reply).toContain("没有载入");
  expect(runner).not.toHaveBeenCalled(); dispose();
});
it("prevents a duplicate while the quote is pending; old cleanup cannot remove a new registration", async () => {
  let complete!: (value: string) => void;
  const runner = vi.fn(() => new Promise<string>(resolve => { complete = resolve; }));
  const old = registerVisualProductionChat(3, runner);
  const first = runVisualProductionChat(3, "生成图片");
  expect((await runVisualProductionChat(3, "生成图片"))?.reply).toContain("没有重复提交");
  expect(runner).toHaveBeenCalledTimes(1);
  complete("已取消"); await first;
  const next = vi.fn(async () => "完成");
  const dispose = registerVisualProductionChat(3, next); old();
  await runVisualProductionChat(3, "生成图片"); expect(next).toHaveBeenCalledTimes(1); dispose();
});
