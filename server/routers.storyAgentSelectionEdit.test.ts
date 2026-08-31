import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { selectionContentFingerprint } from "../shared/selectionContext";

const selectionEditMocks = vi.hoisted(() => ({
  handleSelectionEdit: vi.fn(
    async (input: { fullText: string; selectedText: string }) => ({
      isApprovalOnly: false,
      modifiedFullText: input.fullText.replace(
        input.selectedText,
        "我们开心地去了公园"
      ),
      replacementText: "我们开心地去了公园",
      reply: "已只修改所选文字",
    })
  ),
}));

vi.mock("./archive/selectionEdit", () => selectionEditMocks);

process.env.DATABASE_URL = "";

const { appRouter } = await import("./routers");
const {
  createGeneratedImage,
  createStory,
  getStoryById,
  resetMemoryStateForTesting,
} = await import("./db");

function context(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `selection-router-${userId}`,
      email: null,
      name: "Selection router",
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("storyAgent selectionEdit mutation boundary", () => {
  beforeEach(() => {
    resetMemoryStateForTesting();
    selectionEditMocks.handleSelectionEdit.mockClear();
  });

  it("resolves owned authoritative text and persists only that exact card", async () => {
    const ownerId = 8801;
    const original = "今天下雨。我们去了公园。晚上回家。";
    const selectedText = "我们去了公园";
    const start = original.indexOf(selectedText);
    const story = await createStory({
      userId: ownerId,
      title: "selection router",
      body: {
        _revision: 1,
        cards: [
          { id: "card-a", content: original },
          { id: "card-b", content: "这张卡不能变化。" },
        ],
        shots: [],
      },
    });

    const result = await appRouter
      .createCaller(context(ownerId))
      .storyAgent.selectionEdit({
        fullText: "客户端伪造的全文",
        selectedText,
        instruction: "写得开心一点",
        selectionContext: {
          sourceType: "card",
          sourceId: "card-a",
          selectedText,
          fullText: original,
          storyId: story.id,
          contentFingerprint: selectionContentFingerprint(original),
          selection: { kind: "text", start, end: start + selectedText.length },
        },
      });

    expect(result).toMatchObject({ applied: true, stale: false });
    expect(selectionEditMocks.handleSelectionEdit).toHaveBeenCalledWith(
      expect.objectContaining({ fullText: original, selectedText })
    );
    const saved = await getStoryById(story.id, ownerId);
    expect((saved!.body as any).cards).toEqual([
      { id: "card-a", content: "今天下雨。我们开心地去了公园。晚上回家。" },
      { id: "card-b", content: "这张卡不能变化。" },
    ]);
  });

  it("rejects another user before invoking the model or persisting", async () => {
    const ownerId = 8802;
    const original = "今天下雨。我们去了公园。晚上回家。";
    const selectedText = "我们去了公园";
    const start = original.indexOf(selectedText);
    const story = await createStory({
      userId: ownerId,
      title: "owned selection",
      body: {
        _revision: 1,
        cards: [{ id: "card-a", content: original }],
        shots: [],
      },
    });

    const result = await appRouter
      .createCaller(context(ownerId + 1))
      .storyAgent.selectionEdit({
        fullText: original,
        selectedText,
        instruction: "改掉",
        selectionContext: {
          sourceType: "card",
          sourceId: "card-a",
          selectedText,
          fullText: original,
          storyId: story.id,
          contentFingerprint: selectionContentFingerprint(original),
          selection: { kind: "text", start, end: start + selectedText.length },
        },
      });

    expect(result).toMatchObject({ applied: false, stale: true });
    expect(selectionEditMocks.handleSelectionEdit).not.toHaveBeenCalled();
    const saved = await getStoryById(story.id, ownerId);
    expect((saved!.body as any).cards[0].content).toBe(original);
  });

  it("rejects an image that no longer belongs to the selected stable shot", async () => {
    const ownerId = 8803;
    const story = await createStory({
      userId: ownerId,
      title: "image selection",
      body: {
        _revision: 1,
        shots: [{ shotNo: 1, stableShotId: "shot-a" }],
      },
    });
    const image = await createGeneratedImage({
      projectId: null,
      storyId: story.id,
      userId: ownerId,
      shotNo: "0101",
      shotIdentity: "shot-a",
      imageKey: "selected.png",
      imageUrl: "/selected.png",
      prompt: "selected",
      promptCompilationId: null,
      parentImageId: null,
      generationType: "initial",
      maskKey: null,
      isCurrent: true,
    });

    const result = await appRouter
      .createCaller(context(ownerId))
      .storyAgent.selectionEdit({
        fullText: "镜头提示词",
        selectedText: "图片",
        instruction: "改成夜景",
        selectionContext: {
          sourceType: "storyboard-image",
          sourceId: String(image.id),
          selectedText: "图片",
          fullText: "镜头提示词",
          storyId: story.id,
          stableShotId: "shot-b",
          shotNo: 1,
          imageId: image.id,
          objectVersion: `image:${image.id}`,
        },
      });

    expect(result).toMatchObject({ applied: false, stale: true });
    expect(selectionEditMocks.handleSelectionEdit).not.toHaveBeenCalled();
  });
});
