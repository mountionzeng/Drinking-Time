import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseChapterFile } from "./chapterFile";
const pkg = JSON.parse(
  readFileSync("tests/fixtures/chapter-package/valid-01-text-only.json", "utf8")
);
describe("chapter file", () => {
  it("reads the download envelope without dropping separate image bytes", () => {
    const images = [{ assetId: "asset-example", base64: "AQID" }];
    expect(parseChapterFile(JSON.stringify({ package: pkg, images }))).toEqual({
      package: pkg,
      images,
    });
  });
  it("accepts a bare package from the other platform and rejects a foreign version", () => {
    expect(parseChapterFile(JSON.stringify(pkg)).images).toEqual([]);
    expect(() =>
      parseChapterFile(JSON.stringify({ ...pkg, version: 999 }))
    ).toThrow();
  });
});
