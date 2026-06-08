import { beforeEach, describe, expect, it, vi } from "vitest";

const llmMocks = vi.hoisted(() => ({
  invokeLLM: vi.fn(),
}));

const envMock = vi.hoisted(() => ({
  ENV: {
    forgeApiKey: "test-key" as string | undefined,
    forgeApiUrl: "http://mock",
    llmModel: "mock-model",
    dropZoneModel: undefined as string | undefined,
    dropZoneApiUrl: undefined as string | undefined,
  },
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: llmMocks.invokeLLM,
}));

vi.mock("../_core/env", () => envMock);

import { recognizeStoryIntent } from "./storyAgent";

function makeLLMResponse(content: string) {
  return {
    id: "mock",
    created: 0,
    model: "mock-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content },
        finish_reason: "stop",
      },
    ],
  };
}

describe("recognizeStoryIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.ENV.forgeApiKey = "test-key";
  });

  it("识别 LinkedIn 求职用途，并保留招聘者/领英语义", async () => {
    llmMocks.invokeLLM.mockResolvedValueOnce(
      makeLLMResponse(JSON.stringify({
        purpose: "linkedin_job_search",
        audience: "recruiters",
        platform: "linkedin",
        desiredEffect: "让招聘者快速理解我的能力和判断力",
        tone: "专业、清晰、有个人温度",
        confidence: 0.86,
        evidence: ["用户说想放 LinkedIn 上找工作"],
        missingQuestion: "你最想让招聘者记住哪一种能力？",
      })),
    );

    const result = await recognizeStoryIntent({
      message: "我想把这个短片放 LinkedIn 上找工作，让别人知道我适合什么岗位",
    });

    expect(result).toMatchObject({
      configured: true,
      modelLabel: "mock-model",
      purpose: "linkedin_job_search",
      audience: "recruiters",
      platform: "linkedin",
    });
    expect(result.desiredEffect).toContain("招聘者");
    expect(result.confidence).toBe(0.86);

    const system = llmMocks.invokeLLM.mock.calls[0][0].messages.find(
      (message) => message.role === "system",
    );
    expect(String(system?.content)).toContain("linkedin_job_search");
    expect(String(system?.content)).toContain("招聘者");
  });

  it("模型返回坏 JSON 时，本地兜底仍能识别领英找工作", async () => {
    llmMocks.invokeLLM.mockResolvedValueOnce(makeLLMResponse("我觉得这是求职用途"));

    const result = await recognizeStoryIntent({
      message: "这个片子主要想发到领英上找工作，给招聘的人看",
    });

    expect(result.configured).toBe(true);
    expect(result.modelLabel).toBe("本地兜底");
    expect(result.purpose).toBe("linkedin_job_search");
    expect(result.audience).toBe("recruiters");
    expect(result.platform).toBe("linkedin");
    expect(result.missingQuestion).toContain("能力");
  });

  it("模型给出未知枚举时会归一化成安全默认值", async () => {
    llmMocks.invokeLLM.mockResolvedValueOnce(
      makeLLMResponse(JSON.stringify({
        purpose: "go_viral",
        audience: "everyone",
        platform: "myspace",
        desiredEffect: "",
        tone: "",
        confidence: 9,
        evidence: ["随便写的"],
        missingQuestion: "",
      })),
    );

    const result = await recognizeStoryIntent({
      message: "我还没想好这个短片要干嘛",
    });

    expect(result.purpose).toBe("exploration");
    expect(result.audience).toBe("unknown");
    expect(result.platform).toBe("unknown");
    expect(result.confidence).toBe(1);
    expect(result.desiredEffect).toContain("真实目的");
    expect(result.missingQuestion).toContain("给自己看");
  });

  it("未配置 API 时不调用模型，直接返回本地兜底", async () => {
    envMock.ENV.forgeApiKey = undefined;

    const result = await recognizeStoryIntent({
      message: "我想发 LinkedIn 找工作",
    });

    expect(llmMocks.invokeLLM).not.toHaveBeenCalled();
    expect(result.configured).toBe(false);
    expect(result.modelLabel).toBe("未配置 API");
    expect(result.purpose).toBe("linkedin_job_search");
  });
});
