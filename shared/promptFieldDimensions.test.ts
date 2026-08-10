import { describe, expect, it } from "vitest";

import { dimensionForField, isPromptDimensionField } from "./promptFieldDimensions";

describe("dimensionForField", () => {
  it("把 camelCase 字段映射到谱系的 snake_case 维度键", () => {
    expect(dimensionForField("styleRef")).toBe("style_reference");
    expect(dimensionForField("timeLight")).toBe("time_light");
    expect(dimensionForField("promptDraft")).toBe("image_prompt");
    expect(dimensionForField("negativePrompt")).toBe("negative_prompt");
    expect(dimensionForField("cameraMove")).toBe("camera_motion");
    expect(dimensionForField("videoPrompt")).toBe("video_prompt");
  });

  it("本身就是维度键的字段原样返回", () => {
    expect(dimensionForField("subject")).toBe("subject");
    expect(dimensionForField("mood")).toBe("mood");
  });
});

describe("isPromptDimensionField", () => {
  it("放行会被编译进提示词的字段", () => {
    expect(isPromptDimensionField("subject")).toBe(true);
    expect(isPromptDimensionField("styleRef")).toBe(true);
    expect(isPromptDimensionField("shotType")).toBe(true);
  });

  it("排除参考图绑定和出图配置——它们从不进入编译后的提示词文本", () => {
    expect(isPromptDimensionField("characterReference")).toBe(false);
    expect(isPromptDimensionField("wardrobeReference")).toBe(false);
    expect(isPromptDimensionField("hairReference")).toBe(false);
    expect(isPromptDimensionField("sceneReference")).toBe(false);
    expect(isPromptDimensionField("textureReference")).toBe(false);
    expect(isPromptDimensionField("generationModel")).toBe(false);
    expect(isPromptDimensionField("generationParams")).toBe(false);
  });

  it("排除纯结构/元数据字段", () => {
    expect(isPromptDimensionField("stableShotId")).toBe(false);
    expect(isPromptDimensionField("id")).toBe(false);
  });
});
