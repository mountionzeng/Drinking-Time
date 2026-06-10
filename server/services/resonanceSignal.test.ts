import { describe, it, expect } from "vitest";
import {
  profileFromAnalysisSeed,
  buildResonanceSignal,
  describeResonanceSignal,
} from "./resonanceSignal";

describe("profileFromAnalysisSeed", () => {
  it("从 emotionAnalysis 的 analysisSeed 提取画像字段", () => {
    const profile = profileFromAnalysisSeed({
      birthDate: "1995-06-01",
      age: 30,
      lifeStage: "选择密度变高",
      birthSeason: "夏生",
      cohort: "九十年代成长",
      savedFor: "long_term_emotion_analysis",
    });
    expect(profile).toEqual({
      age: 30,
      lifeStage: "选择密度变高",
      birthSeason: "夏生",
      cohort: "九十年代成长",
    });
  });

  it("非对象 / 空 → undefined；类型不对的字段安全跳过", () => {
    expect(profileFromAnalysisSeed(null)).toBeUndefined();
    expect(profileFromAnalysisSeed("nope")).toBeUndefined();
    expect(profileFromAnalysisSeed({})).toBeUndefined();
    expect(profileFromAnalysisSeed({ age: "三十" })).toBeUndefined();
  });
});

describe("buildResonanceSignal", () => {
  it("把意图(1) + 画像(2) 组装成共享信号，空的部分不写入", () => {
    const signal = buildResonanceSignal({
      analysisSeed: { age: 30, cohort: "九十年代成长" },
      intent: "  想做一个关于故乡的短片  ",
      emotion: ["怀旧"],
      themes: [],
    });
    expect(signal.intent).toBe("想做一个关于故乡的短片");
    expect(signal.emotion).toEqual(["怀旧"]);
    expect(signal.themes).toBeUndefined(); // 空数组不写入
    expect(signal.profile).toEqual({ age: 30, cohort: "九十年代成长" });
  });
});

describe("describeResonanceSignal", () => {
  it("压成可注入 prompt 的中文；空信号 → 空串", () => {
    expect(describeResonanceSignal({})).toBe("");
    const text = describeResonanceSignal({
      intent: "想做关于故乡的短片",
      emotion: ["怀旧", "清醒的痛"],
      profile: { age: 30, cohort: "九十年代成长" },
    });
    expect(text).toContain("用户意图：想做关于故乡的短片");
    expect(text).toContain("情绪：怀旧、清醒的痛");
    expect(text).toContain("长期画像：30岁；九十年代成长");
  });
});
