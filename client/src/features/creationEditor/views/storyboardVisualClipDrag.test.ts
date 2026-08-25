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
const VIEWPORT = { totalMs: TOTAL_MS, scale: 30, contentWidth: 720 };

describe("commitVisualClipDrag", () => {
  it("一次拖动只提交一次移动命令，同时带上目标轨道和绝对帧", () => {
    const move = vi.fn().mockResolvedValue(undefined);
    commitVisualClipDrag({
      clipId: "image:img-abs",
      startLeftPx: null,
      startRectLeft: 100, // 原来贴在时间线最左端
      startClientX: 150,
      releaseClientX: 250, // 向右 100px，30px/秒下就是 100 帧
      releaseClientY: 20,
      viewport: VIEWPORT,
      onMoveVisualClip: move,
      resolveTrack: () => track(2),
    });
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith({
      clipId: "image:img-abs",
      toTrackId: "track-2",
      toStartFrame: 100,
    });
  });

  it("跟着走的是剪辑块的左边缘，不是鼠标位置", () => {
    const move = vi.fn().mockResolvedValue(undefined);
    // 从块中间偏右 40px 处抓取，原地松手：位置不应该跳到鼠标下面。
    commitVisualClipDrag({
      clipId: "shot:sh-01",
      startLeftPx: null,
      startRectLeft: 160,
      startClientX: 200,
      releaseClientX: 200,
      releaseClientY: 20,
      viewport: VIEWPORT,
      onMoveVisualClip: move,
      resolveTrack: () => track(0),
    });
    // (160-100)px 在 30px/秒下是 2 秒 = 60 帧，与抓取点无关。
    expect(move).toHaveBeenCalledWith(
      expect.objectContaining({ toStartFrame: 60 })
    );
  });

  it("拖到时间线左侧之外夹到第 0 帧，而不是变成负数", () => {
    const move = vi.fn().mockResolvedValue(undefined);
    commitVisualClipDrag({
      clipId: "shot:sh-01",
      startLeftPx: null,
      startRectLeft: 150,
      startClientX: 150,
      releaseClientX: 0,
      releaseClientY: 20,
      viewport: VIEWPORT,
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
      startLeftPx: null,
      startRectLeft: 100,
      startClientX: 150,
      releaseClientX: 400,
      releaseClientY: 900,
      viewport: VIEWPORT,
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
      startLeftPx: null,
      startRectLeft: 100,
      startClientX: 150,
      releaseClientX: 400,
      releaseClientY: 20,
      viewport: VIEWPORT,
      onMoveVisualClip: move,
      resolveTrack: () => track(1),
    });
    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("时间轴版本已更新")
    );
  });

  it("一帧图片按渲染出来的真实起点走，而不是居中命中盒的左边缘", () => {
    const move = vi.fn().mockResolvedValue(undefined);
    // 图片渲染在时间轴 120px 处；命中盒宽 40px 且居中，rect.left 因此偏左 20px。
    commitVisualClipDrag({
      clipId: "image:img-abs",
      startLeftPx: 120,
      startRectLeft: 100 + 120 - 20,
      startClientX: 400,
      releaseClientX: 400, // 原地松手
      releaseClientY: 20,
      viewport: VIEWPORT,
      onMoveVisualClip: move,
      resolveTrack: () => track(1),
    });
    // 120px = 4000ms = 120 帧；若误用 rect.left 会算成 100 帧。
    expect(move).toHaveBeenCalledWith(
      expect.objectContaining({ toStartFrame: 120 })
    );
  });
});
