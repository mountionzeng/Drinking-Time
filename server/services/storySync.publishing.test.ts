import { describe, expect, it } from "vitest";

import { mergeStaleStoryBody, prepareStoryBody } from "./storySync";

describe("storySync publishing preservation", () => {
  const serverPublishing = {
    version: 1,
    revision: 4,
    activePlatform: "x",
    selectedPlatforms: ["xiaohongshu", "x"],
    drafts: {
      x: {
        platform: "x",
        content: { title: "", body: "latest server draft", tags: [] },
      },
    },
  };

  it("preserves the server-owned publishing slice during a current generic save", () => {
    const body = prepareStoryBody(
      {
        cards: [{ id: "new-card" }],
        shots: [],
        publishing: {
          ...serverPublishing,
          revision: 2,
          drafts: {
            x: {
              platform: "x",
              content: { title: "", body: "stale client draft", tags: [] },
            },
          },
        },
      },
      9,
      { cards: [], shots: [], publishing: serverPublishing }
    );

    expect(body.cards).toEqual([{ id: "new-card" }]);
    expect(body.publishing).toEqual(serverPublishing);
  });

  it("preserves publishing during stale conservative merges", () => {
    const body = mergeStaleStoryBody(
      { messages: [], shots: [], publishing: serverPublishing },
      {
        messages: [{ id: "m1", role: "user", content: "new message" }],
        shots: [],
        publishing: { revision: 1 },
      },
      10
    );

    expect(body.messages).toEqual([
      { id: "m1", role: "user", content: "new message" },
    ]);
    expect(body.publishing).toEqual(serverPublishing);
  });

  it("cannot replace a newer version container with a stale generic story body", () => {
    const versionedPublishing = {
      ...serverPublishing,
      activeVersionId: "v2",
      containerRevision: 2,
      versions: [
        {
          versionId: "v1",
          sequence: 1,
          displayName: "V1",
          parentId: null,
          versionRevision: 1,
          core: null,
          drafts: {},
          activePlatform: "x",
          selectedPlatforms: ["x"],
          cover: null,
          coverRounds: [],
          conversationSnapshot: null,
        },
        {
          versionId: "v2",
          sequence: 2,
          displayName: "V2",
          parentId: "v1",
          versionRevision: 2,
          core: null,
          drafts: {},
          activePlatform: "x",
          selectedPlatforms: ["x"],
          cover: null,
          coverRounds: [],
          conversationSnapshot: null,
        },
      ],
      versionOperationReceipts: { "create-v2": "v2" },
    };
    const body = prepareStoryBody(
      {
        cards: [{ id: "new-card" }],
        shots: [],
        publishing: {
          ...versionedPublishing,
          activeVersionId: "v1",
          containerRevision: 1,
          versions: [versionedPublishing.versions[0]],
          versionOperationReceipts: {},
        },
      },
      11,
      { cards: [], shots: [], publishing: versionedPublishing }
    );

    expect(body.cards).toEqual([{ id: "new-card" }]);
    expect(body.publishing).toEqual(versionedPublishing);
  });
});
