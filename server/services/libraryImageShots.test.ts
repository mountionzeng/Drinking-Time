import { expect, it } from "vitest";
import type { ImageAsset } from "../../shared/imageAsset";
import { inlineImageToken } from "../../shared/inlineChatImages";
import { libraryImageShots } from "./libraryImageShots";

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
