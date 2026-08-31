import { describe, expect, it } from "vitest";
import { SEMANTIC_ART_CATALOG_VERSION, SEMANTIC_ART_NORMALIZER_VERSION } from "./semanticArtDirection";

describe("semantic art contracts", () => {
  it("pins replay identities", () => {
    expect(SEMANTIC_ART_CATALOG_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./);
    expect(SEMANTIC_ART_NORMALIZER_VERSION).toBe("semantic-art-v1");
  });
});
