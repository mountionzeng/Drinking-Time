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

  it("does not globally load the publishing album font repository", () => {
    const css = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");
    expect(css).not.toContain("fonts/publishing-album");
    expect(css).not.toContain("Publishing Album Noto");
  });
});
