import { describe, expect, it } from "vitest";

import { proposalCanBeConfirmed } from "./ShotAssetBindingPanel";

describe("ShotAssetBindingPanel", () => {
  const selection = {
    character: { assetId: "character-a", versionId: "character-v1" },
  };

  it("allows a clean AI proposal to be batch-confirmed", () => {
    expect(
      proposalCanBeConfirmed({ conflicts: [], selections: selection }, selection)
    ).toBe(true);
  });

  it("blocks a conflicting proposal until the user changes its binding", () => {
    const proposal = {
      selections: selection,
      conflicts: [
        {
          kind: "character" as const,
          field: "outfit",
          assetFact: "红色长外套",
          shotRequest: "白衬衫",
        },
      ],
    };

    expect(proposalCanBeConfirmed(proposal, selection)).toBe(false);
    expect(
      proposalCanBeConfirmed(proposal, {
        character: { assetId: "character-b", versionId: "character-b-v1" },
      })
    ).toBe(true);
  });
});
