import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useShotImageRender } from "./useShotImageRender";
import type { CreationEditorShot } from "@/features/creationEditor/types";
import type { StoryMaterialState } from "@shared/storyMaterial";
vi.stubGlobal("React", React);
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
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
    settings: { count: 1, references: { imageIds: [44], assets: {} } },
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
      candidateCount: 4,
      explicitInstruction: expect.stringContaining("让小猫看向镜头"),
      reference: { selection: { imageIds: [44], assets: {} } },
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
