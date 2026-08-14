import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeAgentMock = vi.fn();

vi.mock("../_core/agentChannel", () => ({
  invokeAgent: (...args: unknown[]) => invokeAgentMock(...args),
}));

import {
  compilePublishingCoverStoryboardPrompt,
  PUBLISHING_COVER_PAINTING_SUFFIX,
} from "./publishingCoverStoryboardPrompt";

describe("publishing cover storyboard prompt", () => {
  beforeEach(() => invokeAgentMock.mockReset());

  it("uses the cover painting compiler and the established cover medium suffix for Midjourney", async () => {
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
      `A warm handmade scene of a determined woman, simplified perspective, uneven painted shapes. ${PUBLISHING_COVER_PAINTING_SUFFIX}`
    );
    const [messages, maxTokens] = invokeAgentMock.mock.calls[0];
    expect(maxTokens).toBe(400);
    expect(messages[0].content).toContain("single vertical painted scene");
    expect(messages[1].content).toContain("【艺术谱系】朴素主义");
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
