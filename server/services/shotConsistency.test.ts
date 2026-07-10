import { beforeEach, describe, expect, it, vi } from "vitest";

const visionMocks = vi.hoisted(() => ({
  visionChannelConfigured: vi.fn(() => true),
  invokeVisionJson: vi.fn(),
}));

vi.mock("./visionChannel", () => visionMocks);

const dbMocks = vi.hoisted(() => ({
  getStoryById: vi.fn(),
}));

vi.mock("../db", () => dbMocks);

const assetMocks = vi.hoisted(() => ({
  getStoryImageAssets: vi.fn(),
  materializeImageInput: vi.fn(async (url: string) => `data:${url}`),
}));

vi.mock("./imageAssets", () => assetMocks);

import { analyzeStoryShotConsistency } from "./shotConsistency";

function makeAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    kind: "story_frame",
    assignment: "shot",
    isPrimary: true,
    status: "selected",
    availability: "ok",
    imageUrl: "https://img.example/sh01.png",
    canonicalShotNo: "SH01",
    rawShotNo: "SH01",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  visionMocks.visionChannelConfigured.mockReturnValue(true);
  dbMocks.getStoryById.mockResolvedValue({ id: 7, body: {} });
});

describe("analyzeStoryShotConsistency", () => {
  it("视觉通道未配置时返回 not_configured 并给出配置指引", async () => {
    visionMocks.visionChannelConfigured.mockReturnValue(false);
    const result = await analyzeStoryShotConsistency({ storyId: 7, userId: 1 });
    expect(result.status).toBe("not_configured");
    if (result.status === "not_configured") {
      expect(result.message).toContain("VISION_302_MODEL");
    }
    expect(dbMocks.getStoryById).not.toHaveBeenCalled();
  });

  it("既没传锚点、故事也没有人物锚点时提示先设锚点", async () => {
    assetMocks.getStoryImageAssets.mockResolvedValue([makeAsset()]);
    const result = await analyzeStoryShotConsistency({ storyId: 7, userId: 1 });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("锚点");
    }
    expect(visionMocks.invokeVisionJson).not.toHaveBeenCalled();
  });

  it("成对送图（锚点在前）并过滤非法维度，rejected 素材不参与", async () => {
    assetMocks.getStoryImageAssets.mockResolvedValue([
      makeAsset({ id: 11, imageUrl: "https://img.example/sh01.png" }),
      makeAsset({
        id: 12,
        imageUrl: "https://img.example/sh02.png",
        canonicalShotNo: "SH02",
      }),
      makeAsset({ id: 13, status: "rejected" }),
    ]);
    visionMocks.invokeVisionJson.mockResolvedValue({
      text: JSON.stringify({
        verdict: "inconsistent",
        mismatches: [
          { dimension: "hairstyle", note: "锚点短发，这张长发" },
          { dimension: "made_up_dimension", note: "应被过滤" },
        ],
      }),
      modelLabel: "vision-test",
    });

    const result = await analyzeStoryShotConsistency({
      storyId: 7,
      userId: 1,
      anchorImageUrl: "https://img.example/anchor.png",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.findings).toHaveLength(2);
    expect(result.modelLabel).toBe("vision-test");
    expect(visionMocks.invokeVisionJson).toHaveBeenCalledTimes(2);
    const firstCall = visionMocks.invokeVisionJson.mock.calls[0][0];
    expect(firstCall.imageUrls[0]).toBe("data:https://img.example/anchor.png");
    expect(result.findings[0].mismatches).toEqual([
      { dimension: "hairstyle", note: "锚点短发，这张长发" },
    ]);
    expect(result.findings[0].verdict).toBe("inconsistent");
  });

  it("模型嘴上说一致但列出了差异时，以差异为准判不一致", async () => {
    assetMocks.getStoryImageAssets.mockResolvedValue([makeAsset({ id: 21 })]);
    visionMocks.invokeVisionJson.mockResolvedValue({
      text: JSON.stringify({
        verdict: "consistent",
        mismatches: [{ dimension: "clothing", note: "服饰颜色不同" }],
      }),
      modelLabel: "vision-test",
    });

    const result = await analyzeStoryShotConsistency({
      storyId: 7,
      userId: 1,
      anchorImageUrl: "https://img.example/anchor.png",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.findings[0].verdict).toBe("inconsistent");
  });

  it("单个镜头分析失败只降级该镜头为 unknown，不影响其余", async () => {
    assetMocks.getStoryImageAssets.mockResolvedValue([
      makeAsset({ id: 31, imageUrl: "https://img.example/sh01.png" }),
      makeAsset({
        id: 32,
        imageUrl: "https://img.example/sh02.png",
        canonicalShotNo: "SH02",
      }),
    ]);
    visionMocks.invokeVisionJson
      .mockRejectedValueOnce(new Error("模型超时"))
      .mockResolvedValueOnce({
        text: JSON.stringify({ verdict: "consistent", mismatches: [] }),
        modelLabel: "vision-test",
      });

    const result = await analyzeStoryShotConsistency({
      storyId: 7,
      userId: 1,
      anchorImageUrl: "https://img.example/anchor.png",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const unknown = result.findings.find(finding => finding.imageId === 31);
    const okOne = result.findings.find(finding => finding.imageId === 32);
    expect(unknown?.verdict).toBe("unknown");
    expect(unknown?.note).toContain("模型超时");
    expect(okOne?.verdict).toBe("consistent");
  });
});
