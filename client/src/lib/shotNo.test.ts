import { describe, expect, it } from "vitest";
import { isSameShotNo, normalizeShotNo } from "./shotNo";

describe("shotNo normalization", () => {
  it("把手机端数字串镜号匹配到桌面表 SH01", () => {
    expect(normalizeShotNo("1")).toBe("SH01");
    expect(isSameShotNo("1", "SH01")).toBe(true);
  });

  it("兼容 SH1 和 SH01，同时保留非标准镜号的精确语义", () => {
    expect(isSameShotNo("SH1", "SH01")).toBe(true);
    expect(normalizeShotNo("A01")).toBe("A01");
  });
});
