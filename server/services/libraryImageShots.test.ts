import { expect, it } from "vitest";
import type { ImageAsset } from "../../shared/imageAsset";
import { inlineImageToken } from "../../shared/inlineChatImages";
import { libraryImageShots } from "./libraryImageShots";

it("joins successful preview and book receipts only to their explicit live shots", () => {
  const shots = ["a", "b", "c"].map(stableShotId => ({ stableShotId }));
  const task = (requestId: string, shotId: string, imageId: number, status = "succeeded") =>
    ({ requestId, shotIdentity: `preview:batch:${shotId}`, status, result: { candidates: [{ imageId }] } });
  const moduleResult = (chapterId: number, imageId: number, status = "succeeded") =>
    ({ chapterId, moduleId: "m", candidates: [{ imageId }], status });
  const map = libraryImageShots(10, {
    shots: shots.map(shot => ({ ...shot, publishingVideo: { sourceModuleIds: [shot.stableShotId === "c" ? "2:m" : "1:m"] } })),
    artPreviewBatches: [{ id: "batch", shots: [
      { stableShotId: "a", requestId: "first", candidates: [{ imageId: 9 }] },
      { stableShotId: "b", requestId: "wrong" }, { stableShotId: "c", requestId: "failed" },
      { stableShotId: "deleted", requestId: "gone" },
    ] }],
    storyboardImageTasks: [task("first", "a", 1), task("wrong", "a", 2), task("failed", "c", 3, "failed"), task("gone", "deleted", 4),
      { ...task("direct", "b", 11), shotIdentity: "b" }],
    bookModuleImageTasks: [moduleResult(1, 5), moduleResult(2, 6), moduleResult(3, 7), moduleResult(1, 8, "accepted")],
  }, shots, [moduleResult(1, 5), moduleResult(2, 10)]);
  const owners = (id: number) => map({ id, storyId: 10 } as ImageAsset).libraryShotIds;
  expect([1, 9].map(owners)).toEqual([["a"], ["a"]]);
  expect([2, 3, 4, 7, 8].map(owners)).toEqual(Array(5).fill(undefined));
  expect([5, 6, 10].map(owners)).toEqual([["a", "b"], ["c"], ["c"]]);
  expect(owners(11)).toEqual(["b"]);
});

it("groups saved results by current stable shot identity without adopting or reassigning sources", () => {
  const shot = { stableShotId: "moved", shotNo: 7 };
  const receipt = { id: "saved-photos:example", who: "s", selectionQuote: { storyId: 10, shotNo: 5, ...{ stableShotId: shot.stableShotId } },
    text: [4, 5, 6, 7, 8].map(inlineImageToken).join(" ") };
  const project = libraryImageShots(10, { messages: [receipt, { ...receipt, who: "u", text: inlineImageToken(99) },
    { ...receipt, selectionQuote: { storyId: 11, stableShotId: "moved" }, text: inlineImageToken(100) },
    { ...receipt, text: "[[ref:invalid]]" }], shotConversationMedia: [{ stableShotId: "other", imageIds: [5] }] }, [shot, { stableShotId: "other" }]);
  const image = (id: number) => ({ id, storyId: 10, shotIdentity: null, isCurrent: false, assignment: "unassigned" } as ImageAsset);
  expect(project(image(5))).toEqual({ ...image(5), libraryShotIds: ["other", "moved"] });
  expect(project(image(8)).libraryShotIds).toEqual(["moved"]);
  for (const id of [99, 100]) expect(project(image(id)).libraryShotIds).toBeUndefined();
  expect(project({ ...image(5), storyId: 12 }).libraryShotIds).toBeUndefined();
});
