import { describe, expect, it } from "vitest";
import { parseRegionalGradeIntent, regionalGradeReply } from "./regionalGradeIntent";
import { parseLuminanceGradeIntent } from "./luminanceGradeIntent";
import { parseShotContentEdits } from "./shotContentEdit";

const T30U = "后半段森林的颜色压暗一点点（其他的不要变），主要突出纸飞机的亮度。";

describe("parseRegionalGradeIntent", () => {
  it("reads the t30u sentence as a free second-half forest darken", () => {
    expect(parseRegionalGradeIntent(T30U)).toEqual({ kind: "video-region", subject: "forest", window: "second-half", deltaL: 5, emphasizePlane: true });
    // 其他免费/付费入口都不接这句
    expect(parseLuminanceGradeIntent(T30U)).toBeNull();
    expect(parseShotContentEdits(T30U)).toBeNull();
  });

  it("reads windows, amounts, take and shot", () => {
    expect(parseRegionalGradeIntent("视频 Take 1612 从 5 秒以后森林暗一些")).toMatchObject({ window: { startSec: 5 }, deltaL: 6, takeId: 1612 });
    expect(parseRegionalGradeIntent("第3镜 2 到 6 秒的树林明显压暗")).toMatchObject({ window: { startSec: 2, endSec: 6 }, deltaL: 8, shotNo: 3 });
    expect(parseRegionalGradeIntent("前半段树木调暗")).toMatchObject({ window: "first-half", deltaL: 5, emphasizePlane: false });
    expect(parseRegionalGradeIntent("森林压暗一点")).toMatchObject({ window: "whole", deltaL: 6 });
  });

  it("leaves content changes, questions and other subjects to the existing flows", () => {
    expect(parseRegionalGradeIntent("森林的树木品种太少了，而且我希望最后云层会比较厚")).toBeNull();
    expect(parseRegionalGradeIntent("后半段森林压暗一点并且换成松树")).toBeNull();
    expect(parseRegionalGradeIntent("后半段森林是不是太暗了吗？")).toBeNull();
    expect(parseRegionalGradeIntent("后半段天空压暗一点")).toBeNull();
    expect(parseRegionalGradeIntent("视频只调亮度")).toBeNull();
  });

  it("replies with the window, numbers and the adopt phrase", () => {
    const reply = regionalGradeReply({ takeId: 1616, parentTakeId: 1612, shotNo: 3, replayed: false, metrics: {
      windowStartSec: 4.042, windowEndSec: 8.083, subjectStartSec: 2.125, rampSec: 0.5, copiedFrames: 97, totalFrames: 194, copiedFramesIdentical: true,
      forestLBefore: 57.89, forestLAfter: 52.7, forestHslSBefore: 0.3838, forestHslSAfter: 0.3889, highlightLBefore: 90.18, highlightLAfter: 89.93, clipWhiteBefore: 0, clipWhiteAfter: 0 } }, true);
    expect(reply).toContain("0 算力");
    expect(reply).toContain("4.0–8.1 秒");
    expect(reply).toContain("纸飞机等白色高光没有压暗");
    expect(reply).toContain("逐帧校验一致");
    expect(reply).toContain("采用视频 Take 1616");
  });
});
