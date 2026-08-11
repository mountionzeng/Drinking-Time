import { describe, expect, it } from "vitest";

import {
  diagnoseTitleShape,
  getGeneratedTitlePolicy,
  normalizeTitleText,
  validateGeneratedTitle,
} from "./textTitle";

describe("normalizeTitleText", () => {
  it("removes model wrappers without clipping meaningful text", () => {
    expect(normalizeTitleText(" 标题：《雨夜里的旧书》。 ")).toBe(
      "雨夜里的旧书"
    );
    expect(normalizeTitleText("故事标题： 末班车上的第一版剧本 ")).toBe(
      "末班车上的第一版剧本"
    );
  });

  it("counts unicode characters and rejects long output instead of truncating it", () => {
    const value = "这个标题实在太长了需要在列表里面被安全地截断";
    const result = validateGeneratedTitle({
      kind: "story",
      value,
      requireAnchor: false,
    });

    expect(result.normalizedTitle).toBe(value);
    expect(result.hardFailures).toContain("title-too-long");
  });
});

describe("validateGeneratedTitle", () => {
  it("uses anchors for traceability", () => {
    expect(
      validateGeneratedTitle({
        kind: "publishing",
        platform: "xiaohongshu",
        value: "辞职后，我把犹豫写进产品日志",
        anchor: "产品日志",
        sourceTexts: ["辞职后，我每天写产品日志，记录决定和犹豫。"],
      }).hardFailures
    ).toEqual([]);

    expect(
      validateGeneratedTitle({
        kind: "publishing",
        platform: "xiaohongshu",
        value: "辞职后，我把犹豫写进产品日志",
        anchor: "百万用户",
        sourceTexts: ["辞职后，我每天写产品日志，记录决定和犹豫。"],
      }).hardFailures
    ).toContain("anchor-not-in-source");

    expect(
      validateGeneratedTitle({
        kind: "publishing",
        platform: "xiaohongshu",
        value: "辞职后的第一周",
        anchor: "产品日志",
        sourceTexts: ["辞职后，我每天写产品日志，记录决定和犹豫。"],
      }).hardFailures
    ).toContain("anchor-not-in-title");
  });

  it("rejects generated contact information but keeps manual validation out of scope", () => {
    const phone = ["138", "0000", "0000"].join("");
    const result = validateGeneratedTitle({
      kind: "publishing",
      platform: "wechat",
      value: `请联系 ${phone}`,
      anchor: phone,
      sourceTexts: [`我的联系方式是 ${phone}`],
    });

    expect(result.hardFailures).toContain("contact-information");
  });

  it("keeps X titleless without requiring an anchor", () => {
    expect(
      validateGeneratedTitle({
        kind: "publishing",
        platform: "x",
        value: "",
      }).hardFailures
    ).toEqual([]);
    expect(
      validateGeneratedTitle({
        kind: "publishing",
        platform: "x",
        value: "不该出现",
        anchor: "不该出现",
        sourceTexts: ["不该出现"],
      }).hardFailures
    ).toContain("x-must-be-titleless");
  });
});

describe("title policies and diagnostics", () => {
  it("keeps the four jobs distinct", () => {
    expect(getGeneratedTitlePolicy("story").hardMax).toBe(18);
    expect(getGeneratedTitlePolicy("card").recommendedMax).toBe(16);
    expect(getGeneratedTitlePolicy("publishing", "x").required).toBe(false);
    expect(getGeneratedTitlePolicy("publishing", "x").hardMax).toBe(0);
  });

  it("reports stiffness as a diagnostic rather than rejecting user language", () => {
    expect(diagnoseTitleShape("publishing", "关于创作的一些思考")).toContain(
      "generic-template"
    );
    expect(diagnoseTitleShape("version", "V2")).toContain("plain-version");
    expect(diagnoseTitleShape("card", "第一次拉坯时杯壁塌了…")).toContain(
      "clipped-ending"
    );
  });
});
