import { describe, expect, it } from "vitest";
import { isSafeImageFileName } from "./imageFileName";

describe("isSafeImageFileName", () => {
  it("接受旧格式与新 UUID 格式", () => {
    expect(isSafeImageFileName("1718000000000-ab12cd.png")).toBe(true);
    expect(isSafeImageFileName("1718000000000-3f2b8c1e-9a4d-4c1b-8e2f-0a1b2c3d4e5f.png")).toBe(true);
    expect(isSafeImageFileName("mask-0123456789abcdef01234567-edit.png")).toBe(true);
    expect(isSafeImageFileName("a.jpeg")).toBe(true);
  });
  it("拒绝路径穿越与非法名", () => {
    for (const f of ["../x.png", "a/b.png", "..png", ".env", "x.png.exe", "x.svg", "-x.png", "a%2f.png", ""]) {
      expect(isSafeImageFileName(f)).toBe(false);
    }
  });
});
