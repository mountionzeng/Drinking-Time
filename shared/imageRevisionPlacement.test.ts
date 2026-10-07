import { describe, expect, it } from "vitest";
import { placeImageRevision } from "./imageRevisionPlacement";
import { projectVisualClips, type VisualEditDocument } from "./visualClipModel";

const document = (): VisualEditDocument => ({
  items: [
    {
      stableShotId: "shot-a",
      included: true,
      position: 0,
      plannedDurationMs: 4000,
      durationFrames: 120,
      timelineStartFrame: 30,
      visualLayer: 0,
      transform: {
        cropX: 0,
        cropY: 0,
        cropWidth: 1,
        cropHeight: 1,
        zoom: 1,
        panX: 0,
        panY: 0,
      },
    },
  ],
});
const input = {
  stableShotId: "shot-a",
  sourceImageId: 10,
  imageId: 11,
  imageUrl: "/new.png",
};

describe("image revision placement", () => {
  it("adds an independent full duration upper clip without changing the original", () => {
    const original = document();
    const result = placeImageRevision(original, input);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(projectVisualClips(result.document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "image:image-revision-11",
          startFrame: 30,
          durationFrames: 120,
          trackId: "track-1",
        }),
        ...projectVisualClips(original),
      ])
    );
    expect(original.items[0].imageClips).toBeUndefined();
    expect(placeImageRevision(result.document, input)).toMatchObject({
      changed: false,
    });
  });

  it("follows a revised clip's exact placement and duration when editing it again", () => {
    const first = placeImageRevision(document(), input);
    if (first.status !== "ok") throw new Error(first.message);
    const second = placeImageRevision(first.document, {
      ...input,
      sourceImageId: 11,
      imageId: 12,
    });
    expect(second.status).toBe("ok");
    if (second.status !== "ok") return;
    expect(projectVisualClips(second.document)).toEqual(
      expect.arrayContaining([
        ...projectVisualClips(first.document),
        expect.objectContaining({
          id: "image:image-revision-12",
          startFrame: 30,
          durationFrames: 120,
          trackId: "track-2",
        }),
      ])
    );
  });

  it("does not guess when the same source image appears twice", () => {
    const first = placeImageRevision(document(), input);
    if (first.status !== "ok") throw new Error(first.message);
    const clip = first.document.items[0].imageClips![0];
    first.document.items[0].imageClips!.push({ ...clip, id: "duplicate" });
    expect(
      placeImageRevision(first.document, {
        ...input,
        sourceImageId: 11,
        imageId: 12,
      }).status
    ).toBe("error");
  });
});
