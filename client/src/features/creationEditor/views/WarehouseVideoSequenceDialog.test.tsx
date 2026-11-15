import React from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as any[],
  effects: [] as Array<() => unknown>,
  language: "zh",
  scope: { activeStoryId: 7, storyScopeEpoch: 1, setMessages: vi.fn() },
  quote: vi.fn(),
  submit: vi.fn(),
  invalidate: vi.fn(),
  status: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const i = h.cursor++;
    if (!(i in h.slots)) h.slots[i] = initial;
    return [
      h.slots[i],
      (value: any) =>
        (h.slots[i] = typeof value === "function" ? value(h.slots[i]) : value),
    ];
  },
  useRef: (initial: unknown) => {
    const i = h.cursor++;
    return h.slots[i] ?? (h.slots[i] = { current: initial });
  },
  useEffect: (fn: () => unknown) => h.effects.push(fn),
}));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({
  useUiLanguage: () => ({ language: h.language }),
}));
vi.mock("@/features/storyAgent/spine/storySpine", () => ({
  storySpineStore: { getState: () => h.scope },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    warehouseVideoSequence: {
      quote: { useMutation: () => ({ mutateAsync: h.quote }) },
      submit: { useMutation: () => ({ mutateAsync: h.submit }) },
    },
    useUtils: () => ({
      warehouseVideoSequence: { status: { fetch: h.status } },
      storyAgent: {
        storyMaterialState: { invalidate: h.invalidate },
        storyVideoAssets: { invalidate: h.invalidate },
      },
    }),
  },
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: "dialog",
  DialogContent: "section",
  DialogHeader: "header",
  DialogTitle: "h2",
  DialogDescription: "p",
}));
import { WarehouseVideoSequenceDialog } from "./WarehouseVideoSequenceDialog";
const props = {
  storyId: 7,
  stableShotId: "shot-3",
  shotNo: 3,
  images: [9, 3, 5].map((id) => ({
    id,
    imageUrl: `/${id}.png`,
    label: `#${id}`,
  })),
  onClose: vi.fn(),
};
function render() {
  h.cursor = 0;
  h.effects = [];
  return WarehouseVideoSequenceDialog(props);
}
function nodes(tree: any): any[] {
  return !tree || typeof tree !== "object"
    ? []
    : [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
function button(tree: any) {
  return nodes(tree).find((n) => n.type === "button");
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  h.cursor = 0;
  h.slots = [];
  h.effects = [];
  h.language = "zh";
  h.scope.activeStoryId = 7;
  h.scope.storyScopeEpoch = 1;
  h.quote
    .mockReset()
    .mockImplementation(async (input) => ({
      input,
      fingerprint: "a".repeat(64),
      totalCny: 2.06,
    }));
  h.submit
    .mockReset()
    .mockResolvedValue({ takeId: 88, take: { id: 88, status: "processing" } });
});
afterEach(() => vi.unstubAllGlobals());
it("reviews a free quote first, keeps all image IDs in order, and submits only after explicit confirmation", async () => {
  let tree = render();
  button(tree).props.onClick();
  await vi.waitFor(() => expect(h.quote).toHaveBeenCalledOnce());
  expect(h.submit).not.toHaveBeenCalled();
  expect(h.quote.mock.calls[0][0].imageIds).toEqual([9, 3, 5]);
  tree = render();
  expect(button(tree).props.children).toContain("确认生成");
  button(tree).props.onClick();
  button(tree).props.onClick();
  await vi.waitFor(() => expect(h.submit).toHaveBeenCalledOnce());
  expect(h.submit.mock.calls[0][0]).toMatchObject({
    imageIds: [9, 3, 5],
    costConfirmation: { accepted: true, estimatedCny: 2.06 },
  });
});
it("invalidates the quote after edits and closing never purchases", async () => {
  button(render()).props.onClick();
  await vi.waitFor(() => expect(h.quote).toHaveBeenCalledOnce());
  let tree = render();
  nodes(tree)
    .find((n) => n.type === "textarea")
    .props.onChange({ target: { value: "Move more slowly." } });
  tree = render();
  expect(button(tree).props.children).toContain("查看算力");
  tree.props.onOpenChange(false);
  expect(props.onClose).toHaveBeenCalled();
  expect(h.submit).not.toHaveBeenCalled();
});
it("ignores a late quote after switching away and back to the same story", async () => {
  let resolve!: (value: any) => void;
  h.quote.mockImplementation(() => new Promise((r) => (resolve = r)));
  button(render()).props.onClick();
  h.scope.storyScopeEpoch = 3;
  resolve({ input: {}, fingerprint: "x", totalCny: 1 });
  await Promise.resolve();
  expect(button(render()).props.children).toContain("查看算力");
  expect(h.submit).not.toHaveBeenCalled();
});
it("shows English labels and compute units in English mode", async () => {
  h.language = "en";
  button(render()).props.onClick();
  await vi.waitFor(() => expect(h.quote).toHaveBeenCalledOnce());
  const tree = render();
  expect(button(tree).props.children).toBe("Confirm generation");
  const text = JSON.stringify(tree);
  expect(text).toContain("compute");
  expect(text).not.toContain("算力");
});
it("reuses the same request ID after a lost submission response", async () => {
  h.submit.mockRejectedValue(new Error("network"));
  button(render()).props.onClick();
  await vi.waitFor(() => expect(h.quote).toHaveBeenCalledOnce());
  button(render()).props.onClick();
  await vi.waitFor(() => expect(h.submit).toHaveBeenCalledOnce());
  button(render()).props.onClick();
  await vi.waitFor(() => expect(h.submit).toHaveBeenCalledTimes(2));
  expect(h.submit.mock.calls[0][0].requestId).toBe(
    h.submit.mock.calls[1][0].requestId,
  );
});
