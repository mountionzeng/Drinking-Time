import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingShotImageError } from "@shared/shotImageRender";
import { useShotImageRender } from "./useShotImageRender";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import type { StoryMaterialState } from "@shared/storyMaterial";
const pendingTasks = vi.hoisted(() => ({ fetch: vi.fn(async () => [] as Array<{requestId: string; shotIdentity: string; recoverable: boolean}>) }));
const recovery = vi.hoisted(() => ({ mutateAsync: vi.fn(), invalidate: vi.fn(async () => {}) }));
vi.stubGlobal("React", React);
vi.mock("@/lib/trpc", () => ({ trpc: { storyAgent: { recoverStoryboardImage: { useMutation: () => ({ mutateAsync: recovery.mutateAsync, isPending: false }) } }, useUtils: () => ({ storyAgent: { chatImageRevisions: { invalidate: recovery.invalidate }, pendingStoryboardImages: { fetch: pendingTasks.fetch, invalidate: recovery.invalidate }, storyImages: { invalidate: recovery.invalidate }, storyMaterialState: { invalidate: recovery.invalidate }, storyGet: { invalidate: recovery.invalidate } } }) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), warning: vi.fn() } }));
afterEach(() => { vi.useRealTimers(); recovery.mutateAsync.mockReset(); recovery.invalidate.mockClear(); });
function setup() {
  let api!: ReturnType<typeof useShotImageRender>;
  function Host() {
    api = useShotImageRender(7, "shot-a");
    return null;
  }
  renderToStaticMarkup(<Host />);
  // Traverse the actual dialog controls so confirmation/cancel exercise the resolver.
  const buttons: React.ReactElement<any>[] = [];
  function visit(node: React.ReactNode) {
    React.Children.forEach(node, item => {
      if (!React.isValidElement<any>(item)) return;
      if (item.type === "button") buttons.push(item);
      visit(
        (item as React.ReactElement<{ children?: React.ReactNode }>).props
          .children
      );
    });
  }
  visit(api.dialogs);
  const generate = vi
    .fn()
    .mockResolvedValue({ generatedCount: 4, imageId: 48, imageUrl: "/48.png" });
  const input = {
    label: "02",
    settings: { count: 4, references: { imageIds: [44], assets: {} } },
    shot: {
      shotNo: 2,
      stableShotId: "shot-a",
      promptDraft: "原始画面",
    } as CreationEditorShot,
    previousShots: [],
    material: {
      unassignedImages: [],
      shots: [
        { imageVersions: [{ id: 44, imageUrl: "/44.png" }], relatedImages: [] },
      ],
    } as unknown as StoryMaterialState,
    revisionInstruction: "让小猫看向镜头",
    canStart: () => true,
    start: vi.fn(),
    finish: vi.fn(),
    generate,
  };
  return {
    api,
    input,
    act: (text: string) =>
      buttons.find(button => button.props.children === text)!.props.onClick(),
  };
}
describe("MJ revision cost and submission", () => {
  it("prepares one GPT frame without requiring a manually selected reference", async () => {
    const { api, input } = setup();
    input.generate.mockResolvedValue({ generatedCount: 1, imageId: 48, imageUrl: "/48.png" });
    const result = await api.render({ ...input, revisionInstruction: undefined,
      generationProvider: "gpt-image", skipCostConfirmation: true,
      settings: { count: 4, references: { imageIds: [], assets: {} } } });
    expect(result).toMatchObject({ status: "success", imageId: 48 });
    expect(input.generate).toHaveBeenCalledTimes(1);
    expect(input.generate.mock.calls[0][0]).toMatchObject({ imageProvider: "gpt-image", candidateCount: undefined });
  });

  it("quotes GPT as one edit, never buys four tasks and preserves the chosen provider", async () => {
    const { api, input, act } = setup();
    input.generate.mockResolvedValue({ generatedCount: 1, imageId: 48, imageUrl: "/48.png" });
    const pending = api.render({ ...input, revisionProvider: "gpt-image", skipCostConfirmation: true });
    expect(input.generate).not.toHaveBeenCalled();
    act("确认费用并渲染");
    expect(await pending).toMatchObject({ status: "success", imageId: 48 });
    expect(input.generate).toHaveBeenCalledTimes(1);
    expect(input.generate.mock.calls[0][0]).toMatchObject({ imageProvider: "gpt-image", candidateCount: undefined, costConfirmation: { accepted: true, estimatedCny: 1.43 } });
  });
  it("submits one four-image task even when a caller carries legacy eight-image settings", async () => {
    const { api, input } = setup();
    input.settings.count = 8;
    const result = await api.render({ ...input, revisionInstruction: undefined, skipCostConfirmation: true });
    expect(result.status).toBe("success");
    expect(input.generate).toHaveBeenCalledTimes(1);
    expect(input.generate.mock.calls[0][0]).toMatchObject({
      candidateCount: 4,
      costConfirmation: { accepted: true, estimatedCny: 0.68 },
    });
  });
  it("reuses a parent batch confirmation for a supplemental shot with the same selected reference", async () => {
    const { api, input } = setup();
    input.material = { ...input.material, shots: [{ stableShotId: "shot-a", imageVersions: [], imageGenerationReference: { id: 44, imageUrl: "/44.png" } }] } as unknown as StoryMaterialState;
    const result = await api.render({ ...input, revisionInstruction: undefined, skipCostConfirmation: true });
    expect(result.status).toBe("success");
    expect(input.generate).toHaveBeenCalledTimes(1);
    expect(input.generate.mock.calls[0][0]).toMatchObject({ reference: { selection: { imageIds: [44], assets: {} } }, imageProvider: "midjourney" });
  });
  it("waits for confirmation then sends only the selected image and retains candidate response", async () => {
    const { api, input, act } = setup();
    const pending = api.render(input);
    expect(input.generate).not.toHaveBeenCalled();
    act("确认费用并渲染");
    expect(await pending).toMatchObject({
      status: "success",
      imageId: 48,
      imageUrl: "/48.png",
    });
    expect(input.generate).toHaveBeenCalledTimes(1);
    expect(input.generate.mock.calls[0][0]).toMatchObject({
      imageProvider: "midjourney",
      candidateCount: undefined,
      explicitInstruction: expect.stringContaining("让小猫看向镜头"),
      reference: { selection: { imageIds: [44], assets: {} }, referenceRevision: true },
      costConfirmation: { accepted: true, estimatedCny: 0.68 },
    });
  });
  it.each(["取消", "确认费用并渲染"])(
    "does not submit on cancellation or target drift: %s",
    async action => {
      const { api, input, act } = setup();
      const pending = api.render(input);
      input.canStart = () => false;
      act(action);
      expect(await pending).toMatchObject({ status: "cancelled" });
      expect(input.generate).not.toHaveBeenCalled();
    }
  );
  it("fails before quoting if the selected image disappeared", async () => {
    const { api, input } = setup();
    input.settings.references.imageIds = [999];
    expect(await api.render(input)).toMatchObject({ status: "error" });
    expect(input.generate).not.toHaveBeenCalled();
  });
});

it("checks persisted tasks before quoting after reopening and never generates again", async () => {
  const { api, input } = setup();
  pendingTasks.fetch.mockResolvedValueOnce([{requestId: "existing", shotIdentity: "shot-a", recoverable: true}]);
  recovery.mutateAsync.mockResolvedValueOnce({ status: "ok", imageId: 48, imageUrl: "/48.png", candidates: [1,2,3,4] });
  const result = await api.render({ ...input, revisionInstruction: undefined, skipCostConfirmation: true });
  expect(result).toMatchObject({status: "success", imageId: 48});
  expect(recovery.mutateAsync).toHaveBeenCalledWith({storyId: 7, requestId: "existing"});
  expect(input.generate).not.toHaveBeenCalled();
});

it("automatically follows the same accepted task to four images without another purchase", async () => {
  vi.useFakeTimers();
  const { api, input } = setup();
  input.generate.mockRejectedValueOnce(new PendingShotImageError("仍在生成", "original"));
  recovery.mutateAsync.mockResolvedValueOnce({ status: "error", recoveryPending: true, error: "pending" })
    .mockResolvedValueOnce({ status: "ok", imageId: 48, imageUrl: "/48.png", candidates: [1,2,3,4] });
  const result = api.render({ ...input, revisionInstruction: undefined, skipCostConfirmation: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(input.finish).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(6000);
  expect(await result).toMatchObject({status: "success", imageId: 48});
  expect(input.generate).toHaveBeenCalledTimes(1);
  expect(recovery.mutateAsync.mock.calls).toEqual([[{storyId: 7, requestId: "original"}], [{storyId: 7, requestId: "original"}]]);
  expect(recovery.invalidate).toHaveBeenCalledTimes(4);
  expect(input.finish).toHaveBeenCalledTimes(1);
});

it("coalesces repeated recovery of the same request", async () => {
  vi.useFakeTimers();
  const { api, input } = setup();
  const task = { requestId: "same", shotIdentity: "shot-a", recoverable: true };
  pendingTasks.fetch.mockResolvedValueOnce([task]).mockResolvedValueOnce([task]);
  recovery.mutateAsync.mockResolvedValueOnce({ status: "error", recoveryPending: true })
    .mockResolvedValueOnce({ status: "ok", imageId: 48, imageUrl: "/48.png", candidates: [1,2,3,4] });
  const args = { ...input, revisionInstruction: undefined, skipCostConfirmation: true };
  const first = api.render(args);
  const second = api.render(args);
  await vi.advanceTimersByTimeAsync(6000);
  expect((await Promise.all([first, second])).map(result => result.status)).toEqual(["success", "success"]);
  expect(recovery.mutateAsync).toHaveBeenCalledTimes(2);
  expect(recovery.invalidate).toHaveBeenCalledTimes(4);
  expect(input.generate).not.toHaveBeenCalled();
});

it("does not query or generate when submission is still uncertain", async () => {
  const { api, input } = setup();
  pendingTasks.fetch.mockResolvedValueOnce([{ requestId: "unknown", shotIdentity: "shot-a", recoverable: false }]);
  expect(await api.render({ ...input, revisionInstruction: undefined, skipCostConfirmation: true })).toMatchObject({status: "error"});
  expect(recovery.mutateAsync).not.toHaveBeenCalled();
  expect(input.generate).not.toHaveBeenCalled();
});

it("releases chat after an accepted revision and leaves recovery to the durable gallery", async () => {
  const { withMediaChatSession, answerMediaChatQuestion } = await import("../mediaChatSession");
  const { api, input } = setup();
  input.generate.mockRejectedValue(new PendingShotImageError("accepted", "receipt"));
  const pending = withMediaChatSession(7, () => api.render({ ...input, revisionProvider: "gpt-image" }));
  answerMediaChatQuestion(7, "确认");
  expect(await pending).toMatchObject({ status: "success", message: expect.stringContaining("你可以继续发送") });
  expect(input.generate).toHaveBeenCalledWith(expect.objectContaining({ reference: expect.objectContaining({ conversationRevision: true }) }));
  expect(recovery.mutateAsync).not.toHaveBeenCalled();
});
