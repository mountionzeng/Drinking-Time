import { expect, it } from "vitest";
import { prepareStoryBody, mergeStaleStoryBody } from "./storySync";
it("generic saves retain the server's preview versions and operation receipts", () => {
  const server = { shots: [], artPreviewBatches: [{ id: "saved" }], artSystemReceipts: { operation: { version: 2 } } };
  for (const incoming of [{ shots: [] }, { shots: [], artPreviewBatches: [], artSystemReceipts: {} }]) {
    expect(prepareStoryBody(incoming, 4, server)).toMatchObject(server);
    expect(mergeStaleStoryBody(server, incoming, 4)).toMatchObject(server);
  }
});
it("generic saves cannot invent preview plans or operation receipts", () => {
  const saved = prepareStoryBody({ shots: [], artPreviewBatches: [{ id: "forged" }], artSystemReceipts: { forged: true } }, 1, { shots: [] });
  expect(saved).not.toHaveProperty("artPreviewBatches"); expect(saved).not.toHaveProperty("artSystemReceipts");
});
it("keeps shot revision history across autosaves and rejects fabricated history", () => {
  const storyboardFieldVersions = { version: 1, tracks: { promptDraft: { history: [{ revision: 2 }] } } };
  const server = { shots: [], storyboardFieldVersions };
  for (const incoming of [{ shots: [] }, { shots: [], storyboardFieldVersions: {} }]) {
    expect(prepareStoryBody(incoming, 4, server).storyboardFieldVersions).toEqual(storyboardFieldVersions);
    expect(mergeStaleStoryBody(server, incoming, 4).storyboardFieldVersions).toEqual(storyboardFieldVersions);
  }
  expect(prepareStoryBody(server, 1, { shots: [] })).not.toHaveProperty("storyboardFieldVersions");
});

it("retains conversation media provenance and disallows fabricated receipts", () => {
  const server = { shots: [], shotConversationMedia: [{stableShotId: "a", imageIds: [1]}] };
  expect(prepareStoryBody({shots: [], shotConversationMedia: []}, 4, server)).toMatchObject(server);
  expect(mergeStaleStoryBody(server, {shots: [], shotConversationMedia: []}, 4)).toMatchObject(server);
  expect(prepareStoryBody(server, 1, {shots: []})).not.toHaveProperty("shotConversationMedia");
});
