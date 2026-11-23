import { describe, expect, it, vi } from "vitest";
import { locateTimelineFeedback, registerFeedbackEditor, focusFeedbackQuote, readFeedbackClock, type FeedbackClock } from "./timelineFeedbackLocation";
import { buildStoryboardTimingRows } from "./storyboardTiming";

const rows = buildStoryboardTimingRows([{ shotNo: 1, stableShotId: "a", durationMs: 6000 }, { shotNo: 2, stableShotId: "b", durationMs: 9000 }], ["a", "b"]);
const snapshot: FeedbackClock = {
  storyId: 3, version: 17, totalMs: 15000, positionMs: 7500, playing: true, rows, hidden: [], range: null,
  cues: [{ text: "Hello there", startFrame: 210, durationFrames: 45 }],
};
const locate = (text: string, changes: Partial<FeedbackClock> = {}) => locateTimelineFeedback(text, { ...snapshot, ...changes });
describe("right chat playback feedback", () => {
  it.each([
    ["这里画面慢一点", "00:07.5 · 画面"],
    ["音乐小一点", "00:07.5 · 音乐"],
    ["这句旁白晚一点", "00:07–00:08.5 · 旁白"],
    ["随着这句旁白，让画面慢一点", "00:07–00:08.5 · 画面"],
    ["画面跟着音乐快一点", "00:07.5 · 画面"],
    ["不要改画面，这里旁白提前半秒", "00:07.5 · 旁白"],
    ["不是旁白，是这里的音乐太响了", "00:07.5 · 音乐"],
    ["画面不动，这里的音乐小一点", "00:07.5 · 音乐"],
    ["这里的画面和音乐都会卡一下", "00:07.5 · 音乐、画面"],
    ["这里慢一点", "00:07.5 · 待确定修改对象"],
    ["声音太大了", "00:07.5 · 待确定修改对象"],
    ["第2到4秒音乐太响了", "00:02–00:04 · 音乐"],
    ["3秒到5.5秒这里画面慢一点", "00:03–00:05.5 · 画面"],
    ["00:02.500–00:06 画面太快了", "00:02.5–00:06 · 画面"],
    ["第十二秒旁白晚了一点", "00:12 · 旁白"],
    ["旁白推迟3秒", "00:07.5 · 旁白"],
    ["旁白推迟到12秒", "00:07.5 · 旁白"],
    ["第02镜音乐太响了", "00:06–00:15 · 音乐"],
    ["第2镜的第3秒，画面慢一点", "00:09 · 画面"],
    ["我想改第5秒的音乐", "00:05 · 音乐"],
    ["把这段旁白换掉", "00:07.5 · 旁白"],
    ["说到“hello there”的时候画面慢一点", "00:07–00:08.5 · 画面"],
  ])("%s", (text, label) => { expect(locate(text)?.label).toBe(label); });
  it("respects selected ranges and explicit overrides", () => {
    const range = { startMs: 2000, endMs: 4000 };
    expect(locate("这段旁白太早了", { range })?.label).toBe("00:02–00:04 · 旁白");
    expect(locate("第8秒这里画面太快了", { range })?.label).toBe("00:08 · 画面");
  });
  it("resolves spoken minute and second ranges without dropping minutes", () => {
    expect(locate("从一分零五秒到一分十秒，这里的音乐调低一点", {totalMs: 90000})?.label)
      .toBe("01:05–01:10 · 音乐");
  });
  it.each([0, 999.5, 14999, 15000])("gives a single point a non-empty frame in the saved selection (%s)", positionMs => {
    const q = locate("这里只定位画面", {positionMs})?.selection?.selection;
    expect(q?.kind).toBe("time");
    if (q?.kind !== "time") throw new Error("missing time selection");
    expect(q.endSec).toBeGreaterThan(q.startSec);
    expect(q.endSec).toBeLessThanOrEqual(15);
  });
  it("resolves a clarification at the original position even after playback moves", () => {
    const q = locate("这里太快了")!.selection!;
    const moved = { ...snapshot, positionMs: 14000 };
    expect(locateTimelineFeedback("旁白", moved, q)?.label).toBe("00:07.5 · 旁白");
    expect(locateTimelineFeedback("旁白", { ...moved, storyId: 6 }, q)).toBeNull();
    expect(locateTimelineFeedback("旁白", { ...moved, version: 19 }, q)?.error).toContain("版本");
  });
  it.each(["第17秒画面太快了", "第6到3秒音乐太响了", "在5秒和8秒画面都太慢了", "第20镜旁白太早了",
    "说到“missing”的时候画面慢一点"])("leaves an unresolved location open: %s", text => expect(locate(text)?.error).toBeTruthy());
  it.each(["重新渲染这段视频", "音乐生成一版", "把这个镜头删除", "第01镜随着第一句旁白让茶杯出现", "把第2镜时长改成3秒",
    "把选中的视频改为0.8倍速", "全片音乐小一点", "只改这张图片的亮度", "这里很好", "我喜欢这个画面", "把这张图生成视频，速度慢一点"])
    ("keeps the usual chat and editor commands: %s", text => expect(locate(text)).toBeNull());
  it("keeps the existing whole-track volume operation outside active reviewing", () => {
    expect(locate("背景音乐小一点", { playing: false })).toBeNull();
  });
  it("seeks in the owning editor only and refuses stale revisions", () => {
    const focus = vi.fn(() => "已选中。");
    const unregister = registerFeedbackEditor(3, { read: () => snapshot, focus });
    try {
      expect(readFeedbackClock(3)).toBe(snapshot);
      const selection = locate("第4秒音乐太响")!.selection!;
      expect(focusFeedbackQuote(3, selection)).toContain("音乐");
      expect(focus).toHaveBeenCalledWith({ startMs: 4000, endMs: 4000 }, ["music"]);
      const newer = registerFeedbackEditor(3, { read: () => ({ ...snapshot, version: 18 }), focus });
      unregister();
      expect(focusFeedbackQuote(3, selection)).toContain("版本");
      expect(focus).toHaveBeenCalledTimes(1);
      newer();
      expect(readFeedbackClock(3)).toBeNull();
    } finally { unregister(); }
  });
});
