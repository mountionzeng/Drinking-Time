import { describe, expect, it } from "vitest";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import { firstShotDraftText } from "./NextShotDraftButton";

describe("next shot first draft", () => {
  const last = { videoEnd: "飞机停在屏幕前。" } as CreationEditorShot;
  const next = { shotNo: 5, subject: "发送键", action: "飞机飞入绿色界面。", videoEnd: "轨道停在剪点。", durationMs: 12000, sound: "纸张折叠声" } as CreationEditorShot;
  it("uses the saved ending, the next action, timing and sound", () => {
    const draft = firstShotDraftText(next, last, null);
    for (const text of ["第 05 镜", "12 秒", last.videoEnd, next.action, next.videoEnd, next.sound]) expect(draft).toContain(text);
  });
  it("prefers an explicitly directed new opening", () => {
    const draft = firstShotDraftText({ ...next, videoStart: "屏幕亮起。" }, last, null);
    expect(draft).toContain("屏幕亮起。");
    expect(draft).not.toContain(last.videoEnd);
  });
});
