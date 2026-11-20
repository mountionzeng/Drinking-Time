import { describe, expect, it } from "vitest";
import {
  journeyFromProviderAttempt,
  platformForOperationType,
  subjectKindForOperationType,
} from "./activityJourney";

describe("活动阶段词表", () => {
  it("供应商成功回执和尚未提交都不算作品结果", () => {
    expect(journeyFromProviderAttempt("succeeded")).toBeNull();
    expect(journeyFromProviderAttempt("prepared")).toBeNull();
    expect(journeyFromProviderAttempt("provider said prompt rejected")).toBeNull();
  });

  it("提交只记一次阶段，失败只留归一化类别", () => {
    expect(journeyFromProviderAttempt("submitted")).toEqual({
      eventName: "generation.submitted",
      result: "none",
      failureCategory: null,
    });
    expect(journeyFromProviderAttempt("task_known")).toMatchObject({
      eventName: "generation.submitted",
    });
    expect(journeyFromProviderAttempt("not_charged_failure")).toEqual({
      eventName: "generation.resolved",
      result: "failed",
      failureCategory: "not_charged",
    });
    expect(journeyFromProviderAttempt("charged_failure")).toMatchObject({
      failureCategory: "charged",
    });
    expect(journeyFromProviderAttempt("submission_unknown")).toMatchObject({
      result: "unknown",
      failureCategory: "submission_unknown",
    });
  });

  it("小程序计费类型才能标成小程序，其余本仓调用标成网站", () => {
    expect(platformForOperationType("shiguang.storyImages")).toBe("miniprogram");
    expect(platformForOperationType("image.generate")).toBe("web");
    expect(subjectKindForOperationType("shiguang.storyAudio")).toBe("audio");
    expect(subjectKindForOperationType("shiguang.chatInterview")).toBe("text");
    expect(subjectKindForOperationType("media.video")).toBe("video");
  });
});
