import { describe, expect, it } from "vitest";
import { getCoverGenerationPresentation } from "./publishingCoverGenerationState";

describe("getCoverGenerationPresentation", () => {
  it("only marks the fresh action as loading when creating a new round", () => {
    expect(getCoverGenerationPresentation("fresh")).toMatchObject({
      freshLoading: true,
      reviseLoading: false,
    });
  });

  it("only marks the revision action as loading when revising a candidate", () => {
    expect(getCoverGenerationPresentation("revise")).toMatchObject({
      freshLoading: false,
      reviseLoading: true,
    });
  });

  it("has no loading state once a request has settled", () => {
    expect(getCoverGenerationPresentation(null)).toEqual({
      freshLoading: false,
      reviseLoading: false,
      message: null,
    });
  });
});
