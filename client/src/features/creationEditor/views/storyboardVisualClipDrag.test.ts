import { describe, expect, it, vi } from "vitest";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

import { commitVisualClipDrag } from "./StoryboardEditRow";

/** 一条 600px 宽、代表整条 8 秒时间线的图层轨。 */
function track(visualLayer: number) {
  return {
    visualLayer,
    rect: { left: 100, right: 700, top: 0, bottom: 40, width: 600 },
  };
}

const TOTAL_MS = 8000; // 240 帧

describe("commitVisualClipDrag", () => {
  it("一次拖动只提交一次移动命令，同时带上目标轨道和绝对帧", () => {
    const move = vi.fn().mockResolvedValue(undefined);
    commitVisualClipDrag({
      clipId: "image:img-abs",
      startRectLeft: 100, // 原来贴在时间线最左端
      startClientX: 150,
      releaseClientX: 400, // 向右 250px = 时间线的 250/600
      releaseClientY: 20,
      totalMs: TOTAL_MS,
      onMoveVisualClip: move,
      resolveTrack: () => track(2),
    });
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith({
      clipId: "image:img-abs",
      toTrackId: "track-2",
      // 250/600 * 8000ms = 3333ms ≈ 100 帧
      toStartFrame: 100,
    });
  });

  it("跟着走的是剪辑块的左边缘，不是鼠标位置", () => {
    const move = vi.fn().mockResolvedValue(undefined);
    // 从块中间偏右 40px 处抓取，原地松手：位置不应该跳到鼠标下面。
    commitVisualClipDrag({
      clipId: "shot:sh-01",
      startRectLeft: 250,
      startClientX: 290,
      releaseClientX: 290,
      releaseClientY: 20,
      totalMs: TOTAL_MS,
      onMoveVisualClip: move,
      resolveTrack: () => track(0),
    });
    // (250-100)/600 * 8000 = 2000ms = 60 帧，与抓取点无关。
    expect(move).toHaveBeenCalledWith(
      expect.objectContaining({ toStartFrame: 60 })
    );
  });

  it("拖到时间线左侧之外夹到第 0 帧，而不是变成负数", () => {
    const move = vi.fn().mockResolvedValue(undefined);
    commitVisualClipDrag({
      clipId: "shot:sh-01",
      startRectLeft: 150,
      startClientX: 150,
      releaseClientX: 0,
      releaseClientY: 20,
      totalMs: TOTAL_MS,
      onMoveVisualClip: move,
      resolveTrack: () => track(0),
    });
    expect(move).toHaveBeenCalledWith(
      expect.objectContaining({ toStartFrame: 0 })
    );
  });

  it("没落在任何图层上时明确提示，不静默丢弃", () => {
    toastError.mockClear();
    const move = vi.fn().mockResolvedValue(undefined);
    commitVisualClipDrag({
      clipId: "image:img-abs",
      startRectLeft: 100,
      startClientX: 150,
      releaseClientX: 400,
      releaseClientY: 900,
      totalMs: TOTAL_MS,
      onMoveVisualClip: move,
      resolveTrack: () => null,
    });
    expect(move).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("没落在任何图层上，位置没有改变");
  });

  it("服务端拒绝时把原因显示给用户", async () => {
    toastError.mockClear();
    const move = vi.fn().mockRejectedValue(new Error("时间轴版本已更新"));
    commitVisualClipDrag({
      clipId: "image:img-abs",
      startRectLeft: 100,
      startClientX: 150,
      releaseClientX: 400,
      releaseClientY: 20,
      totalMs: TOTAL_MS,
      onMoveVisualClip: move,
      resolveTrack: () => track(1),
    });
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("时间轴版本已更新")
    );
  });
});
