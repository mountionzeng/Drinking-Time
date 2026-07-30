import { describe, expect, it } from "vitest";

import {
  compileMjVideoProviderPrompt,
  compileVideoPromptEngineering,
  finalizeVideoPromptEngineering,
  VIDEO_PROMPT_ENGINEERING_VERSION,
} from "./videoPromptEngineering";

describe("videoPromptEngineering", () => {
  it("turns the editor intent and neighboring shots into one causal prompt package", () => {
    const engineering = compileVideoPromptEngineering({
      shotNo: 9,
      cueCode: "0201",
      draftPrompt: "旧方案：人物不动，相机缓慢推进",
      fallbackPrompt: "旧方案：人物不动，相机缓慢推进",
      subtitle: "他们会用虚无的标准，把我吞掉。",
      previousShot: {
        videoEnd: "上一镜以眼睛特写停住",
        transitionOut: "眼睛扫黑",
      },
      currentShot: {
        action: "女主在黑暗中撑开一个属于自己的空间",
        performance: "双臂真实发力，髋部和重心先移动",
        environmentMotion: "她接触边界后，红黑空间才向两侧展开",
        cameraMove: "摄影机沿中轴快速后撤",
        videoEnd: "空间完全撑开后收稳",
        transitionOut: "红色硬边切入下一镜",
        videoPrompt: "用户最新要求：空间必须由女主发力撑开",
        negativePrompt: "不要添加其他画面元素",
      },
      nextShot: { videoStart: "白纸从下方铺满画面" },
    });

    expect(engineering.version).toBe(VIDEO_PROMPT_ENGINEERING_VERSION);
    expect(engineering.editorHardConstraints).toContain(
      "女主在黑暗中撑开一个属于自己的空间"
    );
    expect(engineering.editorHardConstraints).toContain(
      "用户最新要求：空间必须由女主发力撑开"
    );
    expect(engineering.continuityIn).toContain("眼睛扫黑");
    expect(engineering.continuityOut).toContain("红色硬边切入下一镜");
    expect(engineering.threeBeatMotion).toContain("起势 0-25%");
    expect(engineering.threeBeatMotion).toContain("重心");
    expect(engineering.threeBeatMotion).toContain("环境才回应");
    expect(engineering.cameraPlan).toContain("短滑轨或小型摄影车");
    expect(engineering.finalPrompt).toContain("Editor hard constraints");
    expect(engineering.finalPrompt).toContain("Treat the supplied source frames");
    expect(engineering.fingerprint).toHaveLength(24);
  });

  it("keeps the editor constraint when a visual director adds its own prose", () => {
    const base = compileVideoPromptEngineering({
      shotNo: 9,
      cueCode: "0201",
      draftPrompt: "女主撑开空间",
      fallbackPrompt: "女主撑开空间",
      currentShot: { action: "女主必须从黑暗中撑开自己的空间" },
    });
    const directed = finalizeVideoPromptEngineering(
      base,
      "The camera moves through the opening as the subject shifts her weight.",
      "vision-directed"
    );

    expect(directed.finalPrompt).toContain(
      "女主必须从黑暗中撑开自己的空间"
    );
    expect(directed.source).toBe("vision-directed");
  });

  it("keeps a vision-classified material lock at the very front of the final prompt", () => {
    const base = compileVideoPromptEngineering({
      shotNo: 3,
      cueCode: "0303",
      draftPrompt: "女主从红黑画面中向前探身",
      fallbackPrompt: "女主从红黑画面中向前探身",
      currentShot: {
        action: "女主向前探身",
        cameraMove: "锁定机位",
      },
    });
    const directed = finalizeVideoPromptEngineering(
      base,
      [
        "MATERIAL LOCK: oil-painting on woven canvas; preserve layered impasto brushstrokes, pigment thickness and dry-brush edges in every frame; avoid photorealism, CGI smoothing and texture flicker.",
        "The woman shifts her weight forward, then the locked camera settles with her.",
      ].join("\n"),
      "vision-directed"
    );

    expect(directed.finalPrompt).toMatch(/^MATERIAL LOCK:/);
    expect(directed.finalPrompt).toContain("女主向前探身");
    expect(directed.finalPrompt).toContain("The woman shifts her weight");
  });

  it("recompiles when the user changes the front-end video requirement", () => {
    const baseInput = {
      shotNo: 9,
      cueCode: "0201",
      draftPrompt: "表格生成包",
      fallbackPrompt: "旧备用方案",
      currentShot: {
        action: "女主在黑暗中撑开空间",
        performance: "双臂真实发力",
        cameraMove: "相机沿中轴后撤",
      },
    };
    const before = compileVideoPromptEngineering({
      ...baseInput,
      currentShot: {
        ...baseInput.currentShot,
        videoPrompt: "旧要求：缓慢展开",
      },
    });
    const after = compileVideoPromptEngineering({
      ...baseInput,
      currentShot: {
        ...baseInput.currentShot,
        videoPrompt: "最新要求：空间瞬间撑开，相机快速后撤",
      },
    });

    expect(after.userRequirement).toBe(
      "最新要求：空间瞬间撑开，相机快速后撤"
    );
    expect(after.editorHardConstraints).toContain(
      "最新要求：空间瞬间撑开，相机快速后撤"
    );
    expect(after.editorHardConstraints).not.toContain("旧要求：缓慢展开");
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it("packs material, the latest user requirement and directed motion into the MJ payload limit", () => {
    const base = compileVideoPromptEngineering({
      shotNo: 9,
      cueCode: "0201",
      draftPrompt: "表格生成包",
      fallbackPrompt: "备用方案",
      currentShot: {
        action: "女主在黑暗中撑开空间",
        cameraMove: "相机沿中轴快速后撤",
        videoPrompt: "最新要求：空间瞬间撑开，相机快速后撤",
        materialTexture: "红黑厚涂油画，粗粝画布纹理",
      },
    });
    const directed = finalizeVideoPromptEngineering(
      base,
      "The woman braces both arms against the darkness, shifts her weight, and forces the existing red-black walls apart while the camera rapidly dollies backward and settles.",
      "vision-directed"
    );

    const providerPrompt = compileMjVideoProviderPrompt(directed);

    expect(providerPrompt.length).toBeLessThanOrEqual(500);
    expect(providerPrompt).toMatch(/^MATERIAL LOCK:/);
    expect(providerPrompt).toContain(
      "最新要求：空间瞬间撑开，相机快速后撤"
    );
    expect(providerPrompt).toContain("The woman braces both arms");
  });
});
