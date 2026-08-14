import { beforeEach, describe, expect, it, vi } from "vitest";

const imageGenMocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
}));

vi.mock("./imageGen", () => ({
  generateImage: imageGenMocks.generateImage,
}));

import { createArtRiff } from "./artAgent";

describe("createArtRiff", () => {
  beforeEach(() => {
    imageGenMocks.generateImage.mockReset();
    imageGenMocks.generateImage.mockResolvedValue({
      status: "ok",
      imageUrl: "https://storage.example/riff.png",
      imageKey: "riff.png",
    });
  });

  it("把参考图分析交给统一美术工程，不再自行追加电影感色调", async () => {
    await createArtRiff({
      imageUrl: "https://storage.example/reference.png",
      instruction: "让主体更小，空间更不可思议",
      projectPreference: "避免统一暗色调",
      previousPrompt: "一个人站在空房间里",
      previousAnalysis: {
        subject: "一个人",
        environment: "空房间",
        visualStyle: ["纸本拼贴"],
        colorPalette: ["矿物色"],
        lighting: "光成为实体",
        composition: "极端留白",
        materialsAndTextures: ["粗纸纤维"],
        mood: ["温柔的不安"],
      },
      imageProvider: "midjourney",
    });

    const submittedPrompt = imageGenMocks.generateImage.mock.calls[0]?.[0];
    expect(submittedPrompt).toContain("【视觉 riff 内容简报】");
    expect(submittedPrompt).toContain(
      "【用户持续要求】避免统一暗色调；让主体更小"
    );
    expect(submittedPrompt).toContain("【故事视觉配方】");
    expect(submittedPrompt).toContain("纸本拼贴");
    expect(submittedPrompt).toContain("矿物色");
    expect(submittedPrompt).toContain("【修改边界】");
    expect(submittedPrompt).toContain("【艺术跃迁】");
    expect(submittedPrompt).not.toContain("cinematic still");
    expect(submittedPrompt).not.toContain("warm neutrals");
  });
});
