import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("brand font loading", () => {
  it("ships the tiny brand subset instead of the full Chinese font", () => {
    const css = readFileSync(
      resolve(process.cwd(), "client/src/index.css"),
      "utf8"
    );
    const subsetPath = resolve(
      process.cwd(),
      "client/src/assets/fonts/honglei-zhuoshu-brand.ttf"
    );

    expect(css).toContain(
      'url("./assets/fonts/honglei-zhuoshu-brand.ttf") format("truetype")'
    );
    expect(css).not.toContain(
      'url("./assets/fonts/honglei-zhuoshu.ttf") format("truetype")'
    );
    expect(statSync(subsetPath).size).toBeLessThan(20_000);
  });
});
