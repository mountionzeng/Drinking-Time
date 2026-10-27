import { describe, expect, it } from "vitest";
import { textChanges } from "./textChanges";
describe("version text comparison", () => {
  it.each([["纸船", "纸船"], ["", "新增"], ["删除", ""], ["蓝色纸船\n黄灯塔", "红色纸船\n黄灯塔"], ["小鸟🐦来了", "小鸟🐦飞来了"], ["同一句\n同一句", "同一句"], ["甲".repeat(2000), "乙".repeat(2000)]])("reconstructs both versions without losing characters", (before, after) => {
    const parts = textChanges(before, after);
    expect(parts.filter(p => p.kind !== "added").map(p => p.text).join("")).toBe(before);
    expect(parts.filter(p => p.kind !== "removed").map(p => p.text).join("")).toBe(after);
  });
  it("marks only the changed words in a short Chinese sentence", () => {
    expect(textChanges("蓝色纸船", "红色纸船")).toEqual([{ kind: "removed", text: "蓝" }, { kind: "added", text: "红" }, { kind: "same", text: "色纸船" }]);
  });
});
