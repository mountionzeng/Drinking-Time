import { describe, expect, it } from "vitest";

import { TITLE_CASES, TITLE_KINDS } from "./titleCases";
import {
  characterizeStoredTitles,
  evaluateGeneratedTitle,
  renderTitleCharacterization,
} from "./titleMetrics";

describe("title evaluation corpus", () => {
  it("keeps at least five de-identified cases for every title job", () => {
    for (const kind of TITLE_KINDS) {
      expect(TITLE_CASES.filter(sample => sample.kind === kind).length).toBeGreaterThanOrEqual(5);
    }

    const serialized = JSON.stringify(TITLE_CASES);
    expect(serialized).not.toContain(".webdev");
    expect(serialized).not.toMatch(/1[3-9]\d{9}/);
    expect(serialized).not.toMatch(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  });
});

describe("evaluateGeneratedTitle", () => {
  it("treats source anchors as traceability and rejects missing anchors", () => {
    expect(
      evaluateGeneratedTitle({
        kind: "publishing",
        platform: "xiaohongshu",
        title: "辞职后，我把每天的犹豫写进了产品日志",
        anchor: "产品日志",
        sourceTexts: ["辞职之后，我开始每天写产品日志，记录那些犹豫。"],
      }).hardFailures,
    ).toEqual([]);

    expect(
      evaluateGeneratedTitle({
        kind: "publishing",
        platform: "xiaohongshu",
        title: "辞职后，我把每天的犹豫写进了产品日志",
        anchor: "百万用户",
        sourceTexts: ["辞职之后，我开始每天写产品日志，记录那些犹豫。"],
      }).hardFailures,
    ).toContain("anchor-not-in-source");
  });

  it("rejects contact information even when the source contains it", () => {
    const phone = ["138", "0000", "0000"].join("");
    const email = ["writer", "example.test"].join("@");

    expect(
      evaluateGeneratedTitle({
        kind: "publishing",
        platform: "xiaohongshu",
        title: `请联系 ${phone}`,
        anchor: phone,
        sourceTexts: [`联系方式是 ${phone}`],
      }).hardFailures,
    ).toContain("contact-information");

    expect(
      evaluateGeneratedTitle({
        kind: "card",
        title: email,
        anchor: email,
        sourceTexts: [`邮箱 ${email}`],
      }).hardFailures,
    ).toContain("contact-information");
  });

  it("keeps X titleless", () => {
    expect(
      evaluateGeneratedTitle({
        kind: "publishing",
        platform: "x",
        title: "不该出现的标题",
        anchor: "标题",
        sourceTexts: ["标题"],
      }).hardFailures,
    ).toContain("x-must-be-titleless");
  });
});

describe("characterizeStoredTitles", () => {
  it("reports each title kind separately and exposes current mechanical failures", () => {
    const report = characterizeStoredTitles(TITLE_CASES);

    expect(report.map(result => result.kind)).toEqual(TITLE_KINDS);
    expect(report.every(result => result.samples >= 5)).toBe(true);
    expect(report.find(result => result.kind === "version")?.diagnostics["plain-version"]).toBeGreaterThan(0);
    expect(report.find(result => result.kind === "card")?.diagnostics["clipped-ending"]).toBeGreaterThan(0);
    expect(report.find(result => result.kind === "publishing")?.diagnostics["generic-template"]).toBeGreaterThan(0);

    const rendered = renderTitleCharacterization(report);
    expect(rendered).toContain("发布稿标题");
    expect(rendered).toContain("故事名");
    expect(rendered).toContain("版本短名");
    expect(rendered).toContain("卡片标题");
    expect(rendered).not.toContain("综合得分");
  });
});
