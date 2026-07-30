import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleSelectionEdit } from "./selectionEdit";

const agentMocks = vi.hoisted(() => ({
  invokeAgent: vi.fn(),
}));

vi.mock("../_core/agentChannel", () => agentMocks);

describe("handleSelectionEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps text selection edits capable of returning modified text", async () => {
    agentMocks.invokeAgent.mockResolvedValueOnce({
      text: JSON.stringify({
        isApprovalOnly: false,
        modifiedFullText: "把这句话说得更具体",
        reply: "我把表达收紧了一点。",
      }),
    });

    const result = await handleSelectionEdit({
      fullText: "把这句话说清楚",
      selectedText: "说清楚",
      instruction: "更具体",
      selectionContext: {
        sourceType: "shot",
        sourceId: "0:action",
        selectedText: "说清楚",
        fullText: "把这句话说清楚",
        selection: { kind: "text", start: 4, end: 7 },
      },
    });

    expect(result).toMatchObject({
      isApprovalOnly: false,
      modifiedFullText: "把这句话说得更具体",
    });
  });

  it("treats image and video regions as advice context instead of text rewrites", async () => {
    agentMocks.invokeAgent.mockResolvedValueOnce({
      text: JSON.stringify({
        isApprovalOnly: false,
        modifiedFullText: "模型不该真的改这段",
        reply: "这块区域适合作为人物反应镜头的参考。",
      }),
    });

    const result = await handleSelectionEdit({
      fullText: "人物在窗边停顿；慢慢回头",
      selectedText: "SH01 画面区域 x 20%，y 10%，宽 40%，高 30%",
      instruction: "以这个区域派生一个更近的反应镜头",
      selectionContext: {
        sourceType: "storyboard-image",
        sourceId: "shot-001:current-frame",
        selectedText: "SH01 画面区域 x 20%，y 10%，宽 40%，高 30%",
        fullText: "人物在窗边停顿；慢慢回头",
        objectVersion: "image:current-frame",
        selection: { kind: "rect", x: 0.2, y: 0.1, width: 0.4, height: 0.3 },
        materialStatus: "current-image",
        storyId: 36,
        stableShotId: "shot-001",
        shotNo: 1,
      },
    });

    expect(result).toEqual({
      isApprovalOnly: true,
      modifiedFullText: "人物在窗边停顿；慢慢回头",
      reply: "这块区域适合作为人物反应镜头的参考。",
    });
  });

  it("rewrites the persisted image prompt when the client resolves a prompt target", async () => {
    agentMocks.invokeAgent.mockResolvedValueOnce({
      text: JSON.stringify({
        isApprovalOnly: false,
        modifiedFullText:
          "同一位短黑发女主，穿白色露背及地长裙，站在红黑空间中央；保持既有场景、色彩和材质不变。",
        reply: "已把服装约束改成与其他镜头一致的白色及地长裙。",
      }),
    });

    const result = await handleSelectionEdit({
      fullText:
        "同一位短黑发女主，穿白色短裙，站在红黑空间中央；保持既有场景、色彩和材质不变。",
      selectedText:
        "同一位短黑发女主，穿白色短裙，站在红黑空间中央；保持既有场景、色彩和材质不变。",
      instruction:
        "请把女主的裙子改成和其他镜头一致的白色及地长裙，其余约束保持不变。",
      promptRewrite: true,
      selectionContext: {
        sourceType: "storyboard-image",
        sourceId: "shot-0201:first-frame",
        selectedText: "0201 · 首帧 · 图片构图调整",
        fullText: "0201 · 首帧 · 图片构图调整",
        objectVersion: "image:1417",
        selection: { kind: "rect", x: 0, y: 0, width: 1, height: 1 },
        materialStatus: "current-image",
        storyId: 1165,
        stableShotId: "manual-sh03-mrd2a2mg-8tibci",
        shotNo: 9,
      },
    });

    expect(result).toEqual({
      isApprovalOnly: false,
      modifiedFullText:
        "同一位短黑发女主，穿白色露背及地长裙，站在红黑空间中央；保持既有场景、色彩和材质不变。",
      reply: "已把服装约束改成与其他镜头一致的白色及地长裙。",
    });
  });
});
