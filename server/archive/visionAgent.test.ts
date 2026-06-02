import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import { analyzeVisionReference } from "./visionAgent";

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

const analysisPayload = {
  reply: "我看完这张图了，可以作为视觉锚。",
  card: {
    content: "一张潮湿夜色里的街角参考图",
    rawText: "reference.png",
  },
  analysis: {
    visualStyle: ["电影感", "低饱和"],
    subject: "雨夜街角",
    characters: ["撑伞的人"],
    environment: "湿润的城市街道",
    eraAndCulture: "当代城市",
    lighting: "霓虹侧光",
    colorPalette: ["蓝", "紫", "暖黄"],
    composition: "人物在画面右侧，街灯形成纵深",
    cameraLanguage: "中景，轻微长焦",
    materialsAndTextures: ["湿柏油", "玻璃反光"],
    mood: ["怅然", "安静"],
    productionRisks: ["雨丝细节容易糊"],
    promptDraft: "雨夜街角，霓虹侧光，电影感",
    negativePrompt: "水印，文字，过曝",
    confidence: 0.86,
  },
};

describe("analyzeVisionReference 302 vision", () => {
  const originalEnv = {
    forgeApiKey: ENV.forgeApiKey,
    llmModel: ENV.llmModel,
    llmSupportsImage: ENV.llmSupportsImage,
    llmSupportsResponseFormat: ENV.llmSupportsResponseFormat,
    visionApiUrl: ENV.visionApiUrl,
    visionModel: ENV.visionModel,
    dropZoneApiUrl: ENV.dropZoneApiUrl,
    dropZoneModel: ENV.dropZoneModel,
    vision302ApiKey: ENV.vision302ApiKey,
    vision302BaseUrl: ENV.vision302BaseUrl,
    vision302Model: ENV.vision302Model,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ENV.forgeApiKey = "";
    ENV.llmModel = "legacy-vision";
    ENV.llmSupportsImage = false;
    ENV.llmSupportsResponseFormat = true;
    ENV.visionApiUrl = "";
    ENV.visionModel = "";
    ENV.dropZoneApiUrl = "";
    ENV.dropZoneModel = "";
    ENV.vision302ApiKey = "test-302-key";
    ENV.vision302BaseUrl = "https://api.302.ai";
    ENV.vision302Model = "gemini-3-pro-preview";
  });

  afterEach(() => {
    ENV.forgeApiKey = originalEnv.forgeApiKey;
    ENV.llmModel = originalEnv.llmModel;
    ENV.llmSupportsImage = originalEnv.llmSupportsImage;
    ENV.llmSupportsResponseFormat = originalEnv.llmSupportsResponseFormat;
    ENV.visionApiUrl = originalEnv.visionApiUrl;
    ENV.visionModel = originalEnv.visionModel;
    ENV.dropZoneApiUrl = originalEnv.dropZoneApiUrl;
    ENV.dropZoneModel = originalEnv.dropZoneModel;
    ENV.vision302ApiKey = originalEnv.vision302ApiKey;
    ENV.vision302BaseUrl = originalEnv.vision302BaseUrl;
    ENV.vision302Model = originalEnv.vision302Model;
    vi.unstubAllGlobals();
  });

  it("calls 302 vision endpoint and keeps VisualCanvasAnalysis structure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        model: "gemini-3-pro-preview",
        choices: [
          {
            message: {
              content: JSON.stringify(analysisPayload),
            },
          },
        ],
      }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await analyzeVisionReference({
      imageDataUrl: "data:image/png;base64,AAAA",
      fileName: "reference.png",
      brief: "希望保留雨夜的感觉",
    });

    expect(result.modelLabel).toBe("gemini-3-pro-preview");
    expect(result.analysis.subject).toBe("雨夜街角");
    expect(result.analysis.visualStyle).toEqual(["电影感", "低饱和"]);
    expect(result.analysis.mood).toEqual(["怅然", "安静"]);
    expect(result.analysis.confidence).toBe(0.86);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.302.ai/v1/chat/completions");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-302-key");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("gemini-3-pro-preview");
    expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,AAAA");
  });

  it("falls back to the legacy OpenAI-compatible vision channel when 302 is not configured", async () => {
    ENV.vision302ApiKey = "";
    ENV.vision302Model = "";
    ENV.forgeApiKey = "legacy-key";
    ENV.llmSupportsImage = true;
    vi.mocked(invokeLLM).mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(analysisPayload),
          },
        },
      ],
    } as Awaited<ReturnType<typeof invokeLLM>>);

    const result = await analyzeVisionReference({
      imageUrl: "https://example.com/reference.png",
    });

    expect(result.modelLabel).toBe("legacy-vision");
    expect(result.analysis.promptDraft).toBe("雨夜街角，霓虹侧光，电影感");
    expect(invokeLLM).toHaveBeenCalledTimes(1);
  });
});
