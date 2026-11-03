import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compactGeneratedBody, textModuleLines } from "./moduleTextEditing";

describe("compactGeneratedBody", () => {
  it("drops blank lines between generated paragraphs", () => {
    const body = "第一段。\n\n第二段。\r\n\r\n  \n第三段。\n";
    expect(textModuleLines(compactGeneratedBody(body))).toEqual(["第一段。", "第二段。", "第三段。"]);
  });
  it("is idempotent across repeated regenerations", () => {
    const once = compactGeneratedBody("甲\n\n乙");
    expect(compactGeneratedBody(once)).toBe(once);
  });
});

describe("ChapterWriting applyGenerated", () => {
  it("compacts the generated body before writing it into the manuscript", () => {
    const source = readFileSync(new URL("./ChapterWriting.tsx", import.meta.url), "utf8");
    expect(source).toContain("body: compactGeneratedBody(body)");
  });
});
