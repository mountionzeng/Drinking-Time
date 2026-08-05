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
      makeLLMResponse(
        JSON.stringify({
          purpose: "linkedin_job_search",
          audience: "recruiters",
          platform: "linkedin",
          desiredEffect: "让招聘者快速理解我的能力和判断力",
          tone: "专业、清晰、有个人温度",
          confidence: 0.86,
          evidence: ["用户说想放 LinkedIn 上找工作"],
          missingQuestion: "你最想让招聘者记住哪一种能力？",
        })
      )
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
      message => message.role === "system"
    );
    expect(String(system?.content)).toContain("linkedin_job_search");
    expect(String(system?.content)).toContain("招聘者");
    expect(String(system?.content)).toContain("四个一级方向");
    expect(String(system?.content)).toContain("给亲友的礼物");
    expect(String(system?.content)).toContain("介绍自己");
    expect(String(system?.content)).toContain("发在社交平台上");
    expect(String(system?.content)).toContain("给自己讲");
    expect(String(system?.content)).toContain("记录再说");
    expect(String(system?.content)).toContain("创造另外一个世界");
    expect(String(system?.content)).toContain("这里只做用途识别");
  });

  it("模型返回坏 JSON 时，本地兜底仍能识别领英找工作", async () => {
    llmMocks.invokeLLM.mockResolvedValueOnce(
      makeLLMResponse("我觉得这是求职用途")
    );

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
      makeLLMResponse(
        JSON.stringify({
          purpose: "go_viral",
          audience: "everyone",
          platform: "myspace",
          desiredEffect: "",
          tone: "",
          confidence: 9,
          evidence: ["随便写的"],
          missingQuestion: "",
        })
      )
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

  it("未配置 API 时也能把虚构灵感兜底识别为 fiction", async () => {
    envMock.ENV.forgeApiKey = undefined;

    const result = await recognizeStoryIntent({
      message: "我想创造另一个世界，写一个月亮掉进菜市场的虚构故事",
    });

    expect(llmMocks.invokeLLM).not.toHaveBeenCalled();
    expect(result.configured).toBe(false);
    expect(result.modelLabel).toBe("未配置 API");
    expect(result.purpose).toBe("fiction");
    expect(result.audience).toBe("public");
    expect(result.platform).toBe("presentation");
    expect(result.desiredEffect).toContain("虚构灵感");
    expect(result.missingQuestion).toContain("人物");
  });

  it("模型误判时也把“写一个……故事”的入口守回 fiction", async () => {
    llmMocks.invokeLLM.mockResolvedValueOnce(
      makeLLMResponse(
        JSON.stringify({
          purpose: "exploration",
          audience: "unknown",
          platform: "unknown",
          desiredEffect: "继续追问用户想给谁看",
          tone: "开放追问",
          confidence: 0.91,
          evidence: ["模型误判为不确定"],
          missingQuestion: "这个短片最后主要给谁看？",
        })
      )
    );

    const result = await recognizeStoryIntent({
      message: "我想写一个月亮掉进菜市场的故事",
    });

    expect(result.configured).toBe(true);
    expect(result.purpose).toBe("fiction");
    expect(result.audience).toBe("public");
    expect(result.platform).toBe("presentation");
    expect(result.desiredEffect).toContain("虚构灵感");
    expect(result.evidence.join(" ")).toContain("虚构故事");
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

  it.each([
    {
      message: "我想记录这段旅行，以后留给自己回看",
      purpose: "raw_record",
      audience: "self",
    },
    {
      message: "我想把这段经历讲给自己，看看自己的选择怎么变了",
      purpose: "self_reflection",
      audience: "self",
    },
    {
      message: "我是妈妈，想把这件事编成睡前故事讲给孩子",
      purpose: "gift",
      audience: "specific_person",
    },
    {
      message: "我想把这段故事做成礼物送给我的朋友",
      purpose: "gift",
      audience: "specific_person",
    },
    {
      message: "我想发到社交平台，讲给陌生人看",
      purpose: "social_post",
      audience: "public",
    },
    {
      message: "我想介绍自己的经历，讲讲我是怎么转行的",
      purpose: "portfolio",
      audience: "public",
    },
  ])(
    "未配置 API 时把四种讲述方向细分识别为 $purpose",
    async ({ message, purpose, audience }) => {
      envMock.ENV.forgeApiKey = undefined;

      const result = await recognizeStoryIntent({ message });

      expect(result.purpose).toBe(purpose);
      expect(result.audience).toBe(audience);
    }
  );

  it.each([
    ["我要发小红书", "xiaohongshu"],
    ["帮我转成 X 上能发的文字", "x"],
    ["我想发 Twitter / 推特", "x"],
    ["改成 Instagram 的 caption", "instagram"],
    ["这篇准备发 IG", "instagram"],
    ["我想发 LinkedIn 给同行看", "linkedin"],
    ["整理成朋友圈文案", "wechat_moments"],
    ["改成抖音文案", "douyin_tiktok"],
    ["做成 TikTok caption", "douyin_tiktok"],
  ])("未配置 API 时识别发布平台：%s", async (message, platform) => {
    envMock.ENV.forgeApiKey = undefined;

    const result = await recognizeStoryIntent({ message });

    expect(result.purpose).toBe("social_post");
    expect(result.platform).toBe(platform);
  });
});
