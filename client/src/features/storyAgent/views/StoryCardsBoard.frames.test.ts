import { describe, expect, it } from "vitest";
import { latestStoryboardFrames } from "./StoryCardsBoard";

describe("latestStoryboardFrames", () => {
  it("follows stable shot identity after a derived shot changes display numbers", () => {
    const frames = latestStoryboardFrames(
      [
        {
          id: 12,
          imageUrl: "/api/images/shot-b.png",
          prompt: "",
          shotNo: 2,
          shotIdentity: "shot-b",
          storyId: 7,
          status: "ready",
        },
      ],
      [
        {
          shotNo: 3,
          stableShotId: "shot-b",
          shotIdentity: "shot-b",
          subject: "B",
          action: "",
          dialogue: "",
          shotType: "",
          beat: "",
          cameraAngle: "",
          cameraMove: "",
          location: "",
          timeLight: "",
          mood: "",
          sound: "",
          styleRef: "",
          note: "",
          emotion: "",
          sourceCardContent: "",
        },
      ]
    );

    expect(frames).toEqual([
      expect.objectContaining({
        shotNo: 3,
        image: expect.objectContaining({ id: 12 }),
      }),
    ]);
  });
});
