import { describe, expect, it } from "vitest";
import { currentStoryboardImages } from "./StoryboardPanel";

describe("currentStoryboardImages", () => {
  it("shows only the current main images used by video generation", () => {
    const images = currentStoryboardImages([
      {
        shotNo: 4,
        shotKey: "SH04",
        stableShotId: "shot-four",
        shotIdentity: "shot-four",
        subject: "第四镜",
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
      {
        shotNo: 5,
        shotKey: "SH05",
        stableShotId: "shot-five",
        shotIdentity: "shot-five",
        imageId: 105,
        imageUrl: "/api/images/current-five.png",
        imagePrompt: "current prompt",
        subject: "第五镜",
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
    ]);

    expect(images).toEqual([
      {
        id: 105,
        imageUrl: "/api/images/current-five.png",
        prompt: "current prompt",
        shotNo: 5,
        shotIdentity: "shot-five",
        storyId: 0,
        status: "ready",
      },
    ]);
  });
});
