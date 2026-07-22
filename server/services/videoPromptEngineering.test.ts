import { describe, expect, it } from "vitest";

import {
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
        videoPrompt: "隐藏旧提示词：相机慢慢靠近",
        negativePrompt: "不要添加其他画面元素",
      },
      nextShot: { videoStart: "白纸从下方铺满画面" },
    });

    expect(engineering.version).toBe(VIDEO_PROMPT_ENGINEERING_VERSION);
    expect(engineering.editorHardConstraints).toContain(
      "女主在黑暗中撑开一个属于自己的空间"
    );
    expect(engineering.editorHardConstraints).not.toContain("隐藏旧提示词");
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
});
