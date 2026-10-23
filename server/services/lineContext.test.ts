import { describe, expect, it } from "vitest";
import { lineContextMessage } from "./writingCompanion";

const draft = "第一行\n第二行很长\n第三行";

describe("lineContextMessage", () => {
  it("is empty when the switch is off", () => {
    expect(lineContextMessage({ draft, cursor: 5 }, false)).toBe("");
  });
  it("names the line and its neighbours when on", () => {
    const text = lineContextMessage({ draft, cursor: 5 }, true);
    expect(text).toContain("第 2 行（共 3 行）");
    expect(text).toContain("这一行：第二行很长");
    expect(text).toContain("前面：第一行");
    expect(text).toContain("后面：第三行");
    expect(text).toContain("不要直接替他改字");
  });
  it("is empty for blank text", () => {
    expect(lineContextMessage({ draft: "", cursor: 0 }, true)).toBe("");
  });
});
