import { describe, expect, it } from "vitest";

import {
  goalGuidance,
  goalLabel,
  normalizeGoal,
  type CreationGoal,
} from "./creationGoal";
import { detectGoalFromText } from "../../shared/creationGoal";

describe("detectGoalFromText（自动识别意图）", () => {
  it("求职信号 → job_search", () => {
    expect(detectGoalFromText("我想做个求职视频发 LinkedIn")).toBe("job_search");
    expect(detectGoalFromText("帮我准备面试用的，展示职业能力")).toBe("job_search");
  });
  it("社媒信号 → social_post", () => {
    expect(detectGoalFromText("发个小红书涨粉")).toBe("social_post");
    expect(detectGoalFromText("想发抖音视频号")).toBe("social_post");
  });
  it("记录信号 → life_record", () => {
    expect(detectGoalFromText("就想记录一下这一刻给自己留念")).toBe("life_record");
  });
  it("求职优先级最高（同时含求职+社媒）", () => {
    expect(detectGoalFromText("把求职作品集也发到小红书")).toBe("job_search");
  });
  it("无信号 → unset", () => {
    expect(detectGoalFromText("今天天气不错")).toBe("unset");
    expect(detectGoalFromText("")).toBe("unset");
  });
});

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
