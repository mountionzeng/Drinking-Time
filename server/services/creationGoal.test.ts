import { describe, expect, it } from "vitest";

import {
  goalGuidance,
  goalLabel,
  normalizeGoal,
  type CreationGoal,
} from "./creationGoal";

describe("normalizeGoal", () => {
  it("合法目标原样返回", () => {
    expect(normalizeGoal("job_search")).toBe("job_search");
    expect(normalizeGoal("social_post")).toBe("social_post");
    expect(normalizeGoal("life_record")).toBe("life_record");
  });
  it("非法/缺失值回落到 unset", () => {
    expect(normalizeGoal("garbage")).toBe("unset");
    expect(normalizeGoal(undefined)).toBe("unset");
    expect(normalizeGoal(null)).toBe("unset");
    expect(normalizeGoal(42)).toBe("unset");
  });
});

describe("goalGuidance", () => {
  it("求职目标注入 HR 视角的具体指引（招聘者、可量化成果、展示而非自夸）", () => {
    const g = goalGuidance("job_search");
    expect(g).toContain("求职视频");
    expect(g).toContain("招聘者");
    expect(g).toMatch(/HR/);
    // 关键产品意图：可量化成果 + 展示而非自夸
    expect(g).toMatch(/可量化|数字|成果/);
    expect(g).toMatch(/展示|自夸/);
  });

  it("社媒目标注入点击/停留导向指引", () => {
    expect(goalGuidance("social_post")).toMatch(/钩子|点击|停留/);
  });

  it("记录生活目标注入「思绪流动、诚实胜过精致」指引", () => {
    expect(goalGuidance("life_record")).toMatch(/思绪|诚实|真实/);
  });

  it("unset 返回空串（不注入、行为与接入前一致）", () => {
    expect(goalGuidance("unset")).toBe("");
  });

  it("每个非 unset 目标都有非空指引（防止漏配）", () => {
    const goals: CreationGoal[] = ["job_search", "social_post", "life_record"];
    for (const goal of goals) {
      expect(goalGuidance(goal).length).toBeGreaterThan(20);
    }
  });
});

describe("goalLabel", () => {
  it("每个目标都有中文名", () => {
    expect(goalLabel("job_search")).toBe("求职视频");
    expect(goalLabel("social_post")).toBe("社交媒体");
    expect(goalLabel("life_record")).toBe("记录生活");
    expect(goalLabel("unset")).toBe("未指定");
  });
});
