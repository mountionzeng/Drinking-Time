import { expect, it } from "vitest";
import { prepareStoryBody, mergeStaleStoryBody } from "./storySync";
it("preserves server region approvals during chat autosave and rejects forged approvals", () => {
  const server = { shots: [], frameRegionReviews: [{ id: "saved", revision: 3, phase: "scope_review" }] };
  const incoming = { shots: [], frameRegionReviews: [{ id: "saved", revision: 2, phase: "images_confirmed" }] };
  expect(prepareStoryBody(incoming, 4, server)).toMatchObject(server);
  expect(mergeStaleStoryBody(server, incoming, 4)).toMatchObject(server);
  expect(prepareStoryBody(incoming, 1, { shots: [] })).not.toHaveProperty("frameRegionReviews");
});
