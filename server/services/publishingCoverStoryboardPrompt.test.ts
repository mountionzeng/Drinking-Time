import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeAgentMock = vi.fn();

vi.mock("../_core/agentChannel", () => ({
  invokeAgent: (...args: unknown[]) => invokeAgentMock(...args),
}));

import {
  compilePublishingCoverStoryboardPrompt,
  PUBLISHING_COVER_ART_SUFFIX,
} from "./publishingCoverStoryboardPrompt";

describe("publishing cover storyboard prompt", () => {
  beforeEach(() => invokeAgentMock.mockReset());

  it("preserves the chosen medium and composition instead of appending a fixed painting style", async () => {
    invokeAgentMock.mockResolvedValue({
      text: "A warm handmade scene of a determined woman, simplified perspective, uneven painted shapes.",
      modelLabel: "test",
    });

    const result = await compilePublishingCoverStoryboardPrompt({
      provider: "midjourney",
      prompt:
        "【用户持续要求】主体是女性，唯美温暖。\n【艺术谱系】朴素主义，蛋彩、水粉与纸板。\n镜头：人物停顿后看向远处。",
    });

    expect(result).toBe(
      `A warm handmade scene of a determined woman, simplified perspective, uneven painted shapes. ${PUBLISHING_COVER_ART_SUFFIX}`
    );
    const [messages, maxTokens] = invokeAgentMock.mock.calls[0];
    expect(maxTokens).toBe(400);
    expect(messages[0].content).toContain("Preserve the chosen medium");
    expect(messages[1].content).toContain("【艺术谱系】朴素主义");
    expect(result).not.toContain("Handcrafted tempera and gouache");
    expect(result).not.toContain("vertical scene");
    expect(result).not.toContain("quiet empty space near the top");
  });

  it.each([
    ["套色木刻，横向群像", "A relief print with rough carved marks and figures spread across the scene."],
    ["撕纸拼贴，俯视桌面", "An overhead cut-paper collage with torn edges and overlapping planes."],
    ["朦胧彩铅，偏左的近距离局部", "A soft colored-pencil drawing with a close crop weighted to the left."],
  ])("keeps %s intact through the compiler boundary", async (direction, compiled) => {
    invokeAgentMock.mockResolvedValue({ text: compiled });
    const result = await compilePublishingCoverStoryboardPrompt({
      provider: "midjourney",
      prompt: `【用户持续要求】${direction}`,
    });
    expect(invokeAgentMock.mock.calls[0][0][1].content).toContain(direction);
    expect(result).toContain(compiled);
    expect(result).not.toMatch(/tempera|gouache|vertical scene|quiet empty space near the top/);
  });

  it("keeps the original Chinese cover and shot prompt for GPT-image", async () => {
    const prompt = "【艺术谱系】蛋彩、水粉。\n镜头：人物抬头。";

    await expect(
      compilePublishingCoverStoryboardPrompt({
        provider: "gpt-image",
        prompt,
      })
    ).resolves.toBe(prompt);
    expect(invokeAgentMock).not.toHaveBeenCalled();
  });

  it("stops before paid generation when the cover prompt compiler is empty", async () => {
    invokeAgentMock.mockResolvedValue({ text: "", modelLabel: "test" });

    await expect(
      compilePublishingCoverStoryboardPrompt({
        provider: "midjourney",
        prompt: "【艺术谱系】蛋彩、水粉。",
      })
    ).rejects.toThrow("本次未提交图片生成");
  });
});
