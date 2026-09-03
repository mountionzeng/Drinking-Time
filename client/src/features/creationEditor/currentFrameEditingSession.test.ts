import { describe, expect, it, vi } from "vitest";

import { runCurrentFrameEditingSession } from "./currentFrameEditingSession";

describe("current frame editing session", () => {
  it("freezes one canonical frame and keeps that identity through extraction and editor opening", async () => {
    const events: string[] = [];
    const resolveVideoSource = vi.fn((playheadMs: number) => {
      events.push(`resolve:${playheadMs}`);
      return { visualLayer: 2 };
    });
    const extractFrame = vi.fn(
      async (input: { timelineFrame: number; operationLayer: number }) => {
        events.push(`extract:${input.timelineFrame}:${input.operationLayer}`);
        return { imageId: 17, clipId: "frame-17" };
      }
    );
    const seekTimeline = vi.fn((playheadMs: number) => {
      events.push(`seek:${playheadMs}`);
    });
    const openImageEditor = vi.fn((target: { imageId: number }) => {
      events.push(`open:${target.imageId}`);
    });

    const outcome = await runCurrentFrameEditingSession({
      pauseAtCurrentFrame: () => {
        events.push("pause");
        return { timelineFrame: 31, playheadMs: 1_033 };
      },
      resolveVideoSource,
      extractFrame,
      isSessionCurrent: () => true,
      buildTarget: (result, position) => ({
        ...result,
        timelineFrame: position.timelineFrame,
      }),
      seekTimeline,
      openImageEditor,
    });

    expect(extractFrame).toHaveBeenCalledWith({
      timelineFrame: 31,
      operationLayer: 2,
    });
    expect(outcome).toEqual({
      position: { timelineFrame: 31, playheadMs: 1_033 },
      target: { imageId: 17, clipId: "frame-17", timelineFrame: 31 },
    });
    expect(events).toEqual([
      "pause",
      "resolve:1033",
      "extract:31:2",
      "seek:1033",
      "open:17",
    ]);
  });

  it("does not reopen an extracted frame after the owning story session changed", async () => {
    let current = true;
    let finishExtraction!: (result: { imageId: number }) => void;
    const extraction = new Promise<{ imageId: number }>(resolve => {
      finishExtraction = resolve;
    });
    const seekTimeline = vi.fn();
    const openImageEditor = vi.fn();

    const pending = runCurrentFrameEditingSession({
      pauseAtCurrentFrame: () => ({ timelineFrame: 45, playheadMs: 1_500 }),
      resolveVideoSource: () => ({ visualLayer: 1 }),
      extractFrame: () => extraction,
      isSessionCurrent: () => current,
      buildTarget: result => result,
      seekTimeline,
      openImageEditor,
    });
    current = false;
    finishExtraction({ imageId: 23 });

    await expect(pending).resolves.toBeNull();
    expect(seekTimeline).not.toHaveBeenCalled();
    expect(openImageEditor).not.toHaveBeenCalled();
  });
});
