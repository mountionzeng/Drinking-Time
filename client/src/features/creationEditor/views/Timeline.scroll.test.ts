import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Timeline selected-shot scrolling", () => {
  it("keeps playback follow-up scrolling inside the horizontal rail", () => {
    const source = readFileSync(
      resolve(root, "client/src/features/creationEditor/views/Timeline.tsx"),
      "utf8"
    );

    expect(source).toContain("rail.scrollTo");
    expect(source).toContain("target.offsetLeft");
    expect(source).not.toContain("scrollIntoView");
  });
});
