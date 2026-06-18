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

import { replyFromCreationAgent, generateNextImage } from "./creationAgent";
import { renderViaGate } from "./renderGate";

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

  it("generateImage sceneAnalysis 保留理由旁路且不注入 prompt", async () => {
    mocks.runJsonAgent.mockResolvedValue({
      parsed: {
        reply: "我按这个空镜画。",
        toolCalls: [
          {
            tool: "generateImage",
            shotNo: "SH01",
            prompt: "legacy prompt should be replaced",
            sceneAnalysis: {
              subjectDescription: "雨后的窄巷积水反光",
              isPerson: false,
              recurringCharacter: null,
              action: "雨水沿屋檐落下",
              emotion: "清冷",
              keyElements: ["窄巷", "积水", "路灯倒影"],
              needsCharacterAnchor: false,
              confidence: 75,
              intent: "解释候选人如何处理模糊问题",
              rationale: "这一镜应该用空巷承接她的冷静判断",
            },
          },
        ],
        focusShotNo: "SH01",
      },
      modelLabel: "mock-model",
    });
    mocks.generateImage.mockResolvedValue({
      status: "ok",
      imageUrl: "/api/images/13.png",
      imageKey: "generated/13.png",
    });

    const result = await replyFromCreationAgent({ ...baseInput, assets: [] });

    expect(result.generatedImage).toMatchObject({
      imageId: 13,
      intent: "解释候选人如何处理模糊问题",
      rationale: "这一镜应该用空巷承接她的冷静判断",
    });
    expect(mocks.createGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("雨后的窄巷积水反光"),
      }),
    );
    expect(mocks.createGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.not.stringContaining("这一镜应该"),
      }),
    );
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

describe("generateNextImage（确定性单图出图，U1）", () => {
  const recipe = {
    style: ["watercolor"],
    palette: [],
    light: [],
    composition: [],
    material: [],
    negative: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGeneratedImage.mockResolvedValue({
      id: 21,
      imageUrl: "/api/images/21.png",
    });
  });

  it("Happy path：无连续性资产 → 走 generateImage，落一张待确认图，返回 ok", async () => {
    mocks.generateImage.mockResolvedValue({
      status: "ok",
      imageUrl: "/api/images/21.png",
      imageKey: "generated/21.png",
    });

    const result = await generateNextImage({
      prompt: "a quiet morning kitchen",
      shotNo: "SH01",
      projectId: 7,
      storyId: 8,
      userId: 9,
      artDirection: recipe,
      assets: [],
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.generatedImage.imageId).toBe(21);
    expect(result.generatedImage.shotNo).toBe("SH01");
    // 配方进入出图网关上下文（实际注入由 renderGate 负责，此处只验证传递）
    expect(renderViaGate).toHaveBeenCalledWith(
      expect.objectContaining({ artDirection: recipe, shotNo: "SH01" }),
      expect.any(Function),
    );
    // 落库为待确认主图（isCurrent），归属正确
    expect(mocks.createGeneratedImage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 7,
        storyId: 8,
        userId: 9,
        shotNo: "SH01",
        isCurrent: true,
        generationType: "generate",
      }),
    );
    expect(mocks.editImage).not.toHaveBeenCalled();
  });

  it("Edge case：焦点镜已有主图 → 用 editImage 做连续性参考", async () => {
    mocks.editImage.mockResolvedValue({
      status: "ok",
      imageUrl: "/api/images/21.png",
      imageKey: "generated/21.png",
    });

    const result = await generateNextImage({
      prompt: "another take",
      shotNo: "SH01",
      projectId: 7,
      storyId: 8,
      userId: 9,
      assets: [asset()],
    });

    expect(result.status).toBe("ok");
    expect(mocks.materializeImageInput).toHaveBeenCalledWith("/api/images/12.png");
    expect(mocks.editImage).toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it("Error path：出图返回 error → 返回 error，不落库", async () => {
    mocks.generateImage.mockResolvedValue({
      status: "error",
      message: "no model available",
    });

    const result = await generateNextImage({
      prompt: "x",
      shotNo: "SH01",
      projectId: 7,
      storyId: 8,
      userId: 9,
      assets: [],
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("no model available");
    }
    expect(mocks.createGeneratedImage).not.toHaveBeenCalled();
  });

  it("Error path：出图层抛异常 → 捕获为 error，不抛、不落库", async () => {
    mocks.generateImage.mockRejectedValue(new Error("network down"));

    const result = await generateNextImage({
      prompt: "x",
      shotNo: "SH01",
      projectId: 7,
      storyId: 8,
      userId: 9,
      assets: [],
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("network down");
    }
    expect(mocks.createGeneratedImage).not.toHaveBeenCalled();
  });

  it("Integration：连调两次产出两张不同 pending（循环可反复触发，不依赖 LLM）", async () => {
    mocks.generateImage.mockResolvedValue({
      status: "ok",
      imageUrl: "/api/images/x.png",
      imageKey: "generated/x.png",
    });
    mocks.createGeneratedImage
      .mockResolvedValueOnce({ id: 31, imageUrl: "/api/images/31.png" })
      .mockResolvedValueOnce({ id: 32, imageUrl: "/api/images/32.png" });

    const first = await generateNextImage({
      prompt: "take one",
      shotNo: "SH02",
      projectId: 7,
      storyId: 8,
      userId: 9,
      assets: [],
    });
    const second = await generateNextImage({
      prompt: "take two",
      shotNo: "SH02",
      projectId: 7,
      storyId: 8,
      userId: 9,
      assets: [],
    });

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;
    expect(first.generatedImage.imageId).toBe(31);
    expect(second.generatedImage.imageId).toBe(32);
    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
  });
});
