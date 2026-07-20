import { describe, expect, it } from "vitest";

import { displayShotCode, promptShotCode } from "./shotIdentity";

describe("displayShotCode", () => {
  it("uses the story cue code instead of the legacy SH key", () => {
    expect(
      displayShotCode({
        cueCode: "0107-2",
        shotKey: "SH07",
        shotNo: 7,
      })
    ).toBe("0107-2");
  });

  it("does not expose SH labels for legacy-only shots", () => {
    expect(displayShotCode({ cueCode: "SH02", shotNo: 2 })).toBe("02");
    expect(displayShotCode({ shotKey: "SH03" })).toBe("03");
  });

  it("keeps a non-legacy stable shot key when no cue code exists", () => {
    expect(displayShotCode({ shotKey: "opening-frame", shotNo: 1 })).toBe(
      "opening-frame"
    );
  });
});

describe("promptShotCode", () => {
  it("uses the story cue code as the model-facing reference", () => {
    expect(
      promptShotCode({
        cueCode: "0107-2",
        shotKey: "SH07",
        shotNo: 7,
      })
    ).toBe("0107-2");
  });

  it("preserves legacy SH references for model prompts", () => {
    expect(promptShotCode({ cueCode: "SH02", shotNo: 2 })).toBe("SH02");
    expect(promptShotCode({ shotKey: "SH03", shotNo: 3 })).toBe("SH03");
    expect(promptShotCode({ shotNo: 4 })).toBe("SH04");
  });
});
