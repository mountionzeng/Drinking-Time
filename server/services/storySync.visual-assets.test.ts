import { describe, expect, it } from "vitest";

import { prepareStoryBody } from "./storySync";

describe("storySync visual asset preservation", () => {
  it("preserves the server-owned visualAssets slice during a current generic save", () => {
    const serverVisualAssets = {
      schemaVersion: 1,
      revision: 2,
      assets: [
        {
          id: "asset-character-1",
          kind: "character",
          name: "女主角",
          status: "review",
          versions: [],
        },
      ],
      shotBindings: [],
    };

    const body = prepareStoryBody(
      {
        cards: [{ id: "latest-editor-card" }],
        shots: [],
      },
      12,
      {
        cards: [],
        shots: [],
        visualAssets: serverVisualAssets,
      }
    );

    expect(body.cards).toEqual([{ id: "latest-editor-card" }]);
    expect(body.visualAssets).toEqual(serverVisualAssets);
  });
});
