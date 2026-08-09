import { describe, expect, it } from "vitest";

import type { StoryShot } from "../types";
import { canonicalizePublishingVideoParagraphs } from "@shared/publishingVideoStoryboard";
import { withStoryboardVoiceTextFallbacks } from "./storyboardVoiceText";

function shot(
  stableShotId: string,
  sourceParagraphIds: string[],
  overrides: Partial<StoryShot> = {}
): StoryShot {
  return {
    stableShotId,
    shotNo: 1,
    subject: "人物",
    action: "动作",
    scriptText: "模型转写的视觉剧本",
    dialogue: "",
    shotType: "中景",
    beat: "推进",
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
    publishingVideo: {
      versionId: "v1",
      groupId: "group-1",
      segmentIds: [],
      sourceParagraphIds,
      confirmedRevision: 1,
    },
    ...overrides,
  };
}

describe("withStoryboardVoiceTextFallbacks", () => {
  it("uses each original publishing paragraph once when old confirmed shots lack dialogue", () => {
    const body = "第一段文字稿原文。\n\n第二段文字稿原文。";
    const paragraphs = canonicalizePublishingVideoParagraphs(body);
    const shots = [
      shot("shot-1", [paragraphs[0]!.paragraphId]),
      shot("shot-2", [paragraphs[0]!.paragraphId]),
      shot("shot-3", [paragraphs[1]!.paragraphId]),
    ];

    expect(
      withStoryboardVoiceTextFallbacks(shots, body).map(item => item.dialogue)
    ).toEqual(["第一段文字稿原文。", "", "第二段文字稿原文。"]);
  });

  it("preserves explicit dialogue and only uses script text for shots without publishing lineage", () => {
    const body = "第一段文字稿原文。";
    const paragraph = canonicalizePublishingVideoParagraphs(body)[0]!;
    const shots = [
      shot("shot-1", [paragraph.paragraphId], { dialogue: "用户改过的旁白" }),
      shot("shot-2", [paragraph.paragraphId]),
      {
        ...shot("manual", []),
        publishingVideo: undefined,
        scriptText: "手工镜头剧本",
      },
    ];

    expect(
      withStoryboardVoiceTextFallbacks(shots, body).map(item => item.dialogue)
    ).toEqual(["用户改过的旁白", "", "手工镜头剧本"]);
  });

  it("does not repeat one legacy generated script across adjacent split shots", () => {
    const shots = [
      { ...shot("legacy-1", []), publishingVideo: undefined },
      { ...shot("legacy-2", []), publishingVideo: undefined },
    ];

    expect(
      withStoryboardVoiceTextFallbacks(shots, "").map(item => item.dialogue)
    ).toEqual(["模型转写的视觉剧本", ""]);
  });

  it("consumes a matching paragraph when a legacy shot already has explicit dialogue", () => {
    const body = "第一段文字稿原文。\n\n第二段文字稿原文。";
    const shots = [
      {
        ...shot("legacy-1", []),
        publishingVideo: undefined,
        scriptText: "第一段视觉剧本",
        dialogue: "第一段文字稿原文。",
      },
      {
        ...shot("legacy-2", []),
        publishingVideo: undefined,
        scriptText: "第二段视觉剧本",
      },
    ];

    expect(
      withStoryboardVoiceTextFallbacks(shots, body).map(item => item.dialogue)
    ).toEqual(["第一段文字稿原文。", "第二段文字稿原文。"]);
  });

  it("rehydrates narration from the shot publishing version instead of the active draft", () => {
    const oldBody = "旧版本第一段。\n\n旧版本第二段。";
    const oldParagraph = canonicalizePublishingVideoParagraphs(oldBody)[0]!;
    const shots = [
      shot("old-version-shot", [oldParagraph.paragraphId], {
        publishingVideo: {
          versionId: "v1",
          groupId: "old-group",
          segmentIds: [],
          sourceParagraphIds: [oldParagraph.paragraphId],
          confirmedRevision: 1,
        },
      }),
    ];

    expect(
      withStoryboardVoiceTextFallbacks(shots, {
        __current__: "当前版本完全不同的正文。",
        v1: oldBody,
      })[0]?.dialogue
    ).toBe("旧版本第一段。");
  });
});
