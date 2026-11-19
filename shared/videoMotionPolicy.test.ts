import { describe, expect, it } from "vitest";

import {
  decideVideoRenderStrategy,
  withVideoElementRule, VIDEO_ELEMENT_RULE,
  VIDEO_VISUAL_FIDELITY_CLAUSE_EN,
  withVideoVisualFidelity,
} from "./videoMotionPolicy";

describe("withVideoVisualFidelity", () => {
  it("preserves the authored motion and appends the source-frame contract", () => {
    const prompt = withVideoVisualFidelity(
      "The woman opens her arms while the camera cranes down."
    );

    expect(prompt).toContain("opens her arms");
    expect(prompt).toContain("object count and placement");
    expect(prompt).toContain("unless the shot instruction explicitly requests");
  });

  it("does not duplicate the fidelity contract", () => {
    const once = withVideoVisualFidelity("A restrained handheld drift.");
    const twice = withVideoVisualFidelity(once);

    expect(twice).toBe(once);
    expect(twice.split(VIDEO_VISUAL_FIDELITY_CLAUSE_EN)).toHaveLength(2);
  });

  it("keeps object motion independent from camera movement and preserves the source material", () => {
    const prompt = withVideoVisualFidelity("飞机飞进屏幕，电脑留在垫子上");
    expect(prompt).toContain("飞机飞进屏幕，电脑留在垫子上");
    expect(prompt).toContain("leading part toward its named target");
    expect(prompt).toContain("material rendering and brush strokes");
    expect(decideVideoRenderStrategy({ cameraMove: "固定机位", action: "飞机飞进屏幕" }).strategy).toBe("paid-302");
  });

  it("routes digital zoom and reframing to the free local renderer", () => {
    expect(
      decideVideoRenderStrategy({
        action: "人物保持不动",
        cameraMove: "数码放大画面并轻微向左平移",
      })
    ).toMatchObject({
      strategy: "local-transform",
      localMotion: {
        kind: "zoom-pan",
        zoomStart: 1,
        zoomEnd: 1.14,
      },
    });
  });

  it("understands a plain-language position adjustment as local editing", () => {
    expect(
      decideVideoRenderStrategy({
        action: "人物和背景保持静止",
        cameraMove: "移动一下画面位置",
      })
    ).toMatchObject({
      strategy: "local-transform",
      localMotion: { kind: "pan" },
    });
  });

  it("keeps visible subject and environment changes on paid generation", () => {
    expect(
      decideVideoRenderStrategy({
        action: "女主撑开自己的空间",
        environmentMotion: "红黑墙体不断折叠扩张",
        cameraMove: "缓慢放大",
      })
    ).toMatchObject({ strategy: "paid-302", localMotion: null });
  });

  it("does not mistake handheld or physical tracking for a local pan", () => {
    expect(
      decideVideoRenderStrategy({
        cameraMove: "手持跟拍，向右移动并产生视差",
      })
    ).toMatchObject({ strategy: "paid-302", localMotion: null });
  });

  it("does not silently downgrade an ambiguous motion request", () => {
    expect(
      decideVideoRenderStrategy({ cameraMove: "让这个镜头更有电影感" })
    ).toMatchObject({ strategy: "paid-302", localMotion: null });
  });
});

it("keeps the camera instruction before provider length limits and upgrades legacy prompts once", () => {
  const authored = "The plane enters a sunlit clearing.";
  const legacy = "Only show elements visible in the source frames or explicitly requested by the user. Add nothing else. " + authored;
  const current = withVideoElementRule(authored);
  expect(withVideoElementRule(legacy)).toBe(current);
  expect(withVideoElementRule(current)).toBe(current);
  expect(current).toContain("Cut on action across incompatible views");
  expect(current.startsWith(VIDEO_ELEMENT_RULE + " " + authored)).toBe(true);
  expect(current.endsWith(authored)).toBe(true);
});
