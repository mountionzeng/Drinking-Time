import { describe, expect, it } from "vitest";
import { storyKeyframes } from "./storyKeyframes";
import type { ImageAsset } from "../../shared/imageAsset";
import { buildWarehouseShotGroups } from "../../client/src/features/creationEditor/warehouseShotMedia";
import { resolveWarehouseConversationGroup } from "../../client/src/features/creationEditor/warehouseConversationFocus";
import type { StoryMaterialState } from "../../shared/storyMaterial";
import type { CreationEditorShot } from "../../client/src/features/creationEditor/types";

const shot = (stableShotId: string, shotNo: number, generationParams = "") => ({ stableShotId, shotNo, generationParams });
const image = (id: number, owner: string | null, parentImageId?: number, storyId = 7) =>
  ({ id, storyId, shotIdentity: owner, kind: "story_frame", parentImageId, imageUrl: "/frame/" + id }) as ImageAsset;
const receipt = (id: string, ids: number[], revision = false) => ({
  id: "saved-photos:" + id, who: "s", selectionQuote: { stableShotId: "end", storyId: 7 },
  text: "关键帧" + (revision ? "修订稿" : "初稿") + "（" + ids.length + " 张）\n" +
    ids.map((n, i) => (i + 1) + "　画面　[[ref:image%3A" + n + "]]").join("\n"),
});

describe("keyframe versions", () => {
  it("moves an ordered board and its branched edits together while keeping the next shot's five frames", () => {
    const board = { sourceShotId: "anchor", frames: [11, 12, 13, 14].map(imageId => ({ imageId, label: "Frame " + imageId })) };
    const shots = [shot("anchor", 5), shot("board", 6, JSON.stringify({ keyframeBoard: board })), shot("end", 7)];
    const images = [...Array.from({ length: 10 }, (_, i) => image(i + 1, null)),
      ...[11, 12, 13, 14].map(id => image(id, null)), image(15, "anchor", 13), image(16, "anchor", 15),
      image(17, "board", 13), image(18, "anchor"), image(19, "anchor", 15, 8), image(20, "end", 10)];
    const frames = storyKeyframes(7, shots, images.reverse(), [receipt("old", [1,2,3,4,5]), receipt("edit", [6,7,8,9,10], true)]);
    expect(frames.filter(f => f.stableShotId === "board").map(f => [f.code, f.versions])).toEqual([
      ["0601", [11]], ["0602", [12]], ["0603", [13,15,16,17]], ["0604", [14]]]);
    expect(frames.find(f => f.code === "0705")?.versions).toEqual([5,10,20]);
    const material = { storyId: 7, shots: [], keyframeFamilies: frames, warehouseImages: images, unassignedVideoTakes: [] } as unknown as StoryMaterialState;
    const groups = buildWarehouseShotGroups({ storyId: 7, shots: shots as CreationEditorShot[], materialState: material });
    expect(groups.find(g => g.id === "board")?.items.map(i => i.id)).toEqual([17,14,12,11]);
    expect(groups.find(g => g.id === "anchor")?.items.map(i => i.id)).toEqual([18]);
    expect(resolveWarehouseConversationGroup(groups, { storyId: 7, messageId: "old", stableShotId: "anchor", mediaKeys: ["image:13"] })?.id).toBe("board");
  });

  it("keeps ambiguous same-length boards separate and ignores malformed receipts", () => {
    const frames = storyKeyframes(7, [shot("end", 1)], [1,2,3,4,5,6].map(id => image(id, null)), [
      receipt("one", [1,2]), receipt("two", [3,4]), receipt("three", [5,6], true),
      { ...receipt("bad", [1,2]), text: "关键帧初稿（2 张）\n1 [[ref:invalid]]" },
    ]);
    expect(frames.map(f => f.versions)).toEqual([[1],[2],[3],[4],[5],[6]]);
  });
});
