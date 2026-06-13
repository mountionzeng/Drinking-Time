import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageAsset } from "../../shared/imageAsset";

const mocks = vi.hoisted(() => ({
  runJsonAgent: vi.fn(),
  editImage: vi.fn(),
  generateImage: vi.fn(),
  createGeneratedImage: vi.fn(),
  createImageSignal: vi.fn(),
  reassignImage: vi.fn(),
  analyzeVisionReference: vi.fn(),
  materializeImageInput: vi.fn(async (url: string) => `data:image/png;base64,${url}`),
}));

vi.mock("../_core/env", () => ({
  ENV: { forgeApiKey: "test-key" },
}));
vi.mock("./agentRuntime", () => ({
  runJsonAgent: mocks.runJsonAgent,
}));
vi.mock("./imageGen", () => ({
  editImage: mocks.editImage,
  generateImage: mocks.generateImage,
}));
vi.mock("./renderGate", () => ({
  renderViaGate: vi.fn(async (_context, render) => render("rendered prompt")),
}));
vi.mock("../db", () => ({
  createGeneratedImage: mocks.createGeneratedImage,
  createImageSignal: mocks.createImageSignal,
  reassignImage: mocks.reassignImage,
}));
vi.mock("../archive/visionAgent", () => ({
  analyzeVisionReference: mocks.analyzeVisionReference,
}));
vi.mock("./imageAssets", () => ({
  materializeImageInput: mocks.materializeImageInput,
}));

import { replyFromCreationAgent } from "./creationAgent";

function asset(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: 12,
    projectId: 7,
    storyId: 8,
    userId: 9,
    rawShotNo: "SH01",
    canonicalShotNo: "SH01",
    imageKey: "generated/12.png",
    imageUrl: "/api/images/12.png",
    prompt: "quiet window portrait",
    generationType: "generate",
    parentImageId: null,
    isCurrent: true,
    maskKey: null,
    createdAt: "2026-06-13T00:00:00.000Z",
    kind: "story_frame",
    status: "selected",
    assignment: "shot",
    availability: "available",
    isPrimary: true,
    selectionSource: "explicit",
    selectedAt: "2026-06-13T00:01:00.000Z",
    ...overrides,
  };
}

const baseInput = {
  message: "人物不要看镜头，窗外再亮一点",
  projectId: 7,
  storyId: 8,
  userId: 9,
  currentFocusShotNo: "SH01",
  shots: [
    {
      shotNo: "SH01",
      subject: "窗边的人",
      action: "停下来",
      dialogue: "",
      shotType: "medium",
      mood: "quiet",
    },
  ],
  assets: [asset()],
};

describe("replyFromCreationAgent image actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGeneratedImage.mockResolvedValue({
      id: 13,
      imageUrl: "/api/images/13.png",
    });
  });

  it("基于焦点主图生成待确认修改版本并保留父版本", async () => {
    mocks.runJsonAgent.mockResolvedValue({
      parsed: {
        reply: "我来收住人物视线，再提一点窗外亮度。",
        toolCalls: [
          {
            tool: "reviseImage",
            imageId: 12,
            shotNo: "SH01",
            prompt: "keep composition, subject looks away, brighter window",
          },
        ],
        focusShotNo: "SH01",
      },
      modelLabel: "mock-model",
    });
    mocks.editImage.mockResolvedValue({
      status: "ok",
      imageUrl: "/api/images/13.png",
      imageKey: "generated/13.png",
    });

    const result = await replyFromCreationAgent(baseInput);

    expect(mocks.materializeImageInput).toHaveBeenCalledWith("/api/images/12.png");
    expect(mocks.editImage).toHaveBeenCalledWith(
      expect.stringContaining("data:image/png;base64,"),
      "rendered prompt",
      { provider: undefined },
    );
    expect(mocks.createGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 7,
        storyId: 8,
        userId: 9,
        shotNo: "SH01",
        parentImageId: 12,
      }),
    );
    expect(result).toMatchObject({
      assetsChanged: true,
      generatedImage: {
        imageId: 13,
        shotNo: "SH01",
      },
    });
    expect(result.reply).toContain("待确认");
  });

  it("分析焦点图片并由小酌汇总可执行的视觉信息", async () => {
    mocks.runJsonAgent.mockResolvedValue({
      parsed: {
        reply: "我先看一下这张图。",
        toolCalls: [{ tool: "analyzeImage", imageId: 12 }],
        focusShotNo: "SH01",
      },
      modelLabel: "mock-model",
    });
    mocks.analyzeVisionReference.mockResolvedValue({
      configured: true,
      modelLabel: "vision",
      reply: "画面的安静主要来自留白。",
      card: { content: "", rawText: "" },
      analysis: {
        visualStyle: [],
        subject: "人物",
        characters: [],
        environment: "窗边",
        eraAndCulture: "",
        lighting: "低反差侧光",
        colorPalette: ["灰蓝", "暗红"],
        composition: "人物偏右，左侧留白",
        cameraLanguage: "",
        materialsAndTextures: ["粗颗粒"],
        mood: ["安静"],
        productionRisks: ["窗外高光容易过曝"],
        promptDraft: "",
        negativePrompt: "",
        confidence: 0.9,
      },
    });

    const result = await replyFromCreationAgent({
      ...baseInput,
      message: "分析一下为什么还不够安静",
    });

    expect(mocks.analyzeVisionReference).toHaveBeenCalledWith(
      expect.objectContaining({
        imageDataUrl: expect.stringContaining("data:image/png;base64,"),
      }),
    );
    expect(result.reply).toContain("人物偏右，左侧留白");
    expect(result.reply).toContain("窗外高光容易过曝");
    expect(result.assetsChanged).toBe(false);
  });

  it("恢复历史版本时写入统一选择事件", async () => {
    mocks.runJsonAgent.mockResolvedValue({
      parsed: {
        reply: "好，回到上一版。",
        toolCalls: [{ tool: "selectImage", imageId: 12 }],
        focusShotNo: "SH01",
      },
      modelLabel: "mock-model",
    });

    const result = await replyFromCreationAgent(baseInput);

    expect(mocks.createImageSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 9,
        storyId: 8,
        imageId: 12,
        action: "swipe_right",
      }),
    );
    expect(result.assetsChanged).toBe(true);
  });
});
