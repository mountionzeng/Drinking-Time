import { beforeEach, afterEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as any[],
  effects: [] as Array<() => any>,
  dispose: [] as Array<() => void>,
  spine: { activeStoryId: 7, storyScopeEpoch: 1, setMessages: vi.fn() },
  refresh: vi.fn(),
  status: vi.fn(),
  material: vi.fn(),
  utils: {} as any,
  client: {},
}));
vi.mock("react", () => ({
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
  useEffect: (fn: () => any) => h.effects.push(fn),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => h.client }));
vi.mock("@/features/uiLanguage/UiLanguage", () => ({
  useUiLanguage: () => ({ language: "en" }),
}));
vi.mock("@/features/storyAgent/spine/storySpine", () => ({
  storySpineStore: { getState: () => h.spine },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => h.utils,
    creationAgent: {
      refreshShotVideoStatus: {
        useMutation: () => ({ mutateAsync: h.refresh }),
      },
    },
  },
}));
vi.mock("./warehouseRenderActivity", async (original) => ({
  ...(await original<typeof import("./warehouseRenderActivity")>()),
  watchWarehouseRenders: () => () => {},
}));
import { useWarehouseRenderActivity } from "./useWarehouseRenderActivity";
function render() {
  h.cursor = 0;
  h.effects = [];
  return useWarehouseRenderActivity(1, 7, vi.fn());
}
function start() {
  render();
  h.dispose.push(h.effects[0]());
  render();
  h.dispose.push(h.effects[1]());
}
beforeEach(() => {
  vi.clearAllMocks();
  h.slots = [];
  h.effects = [];
  h.dispose = [];
  h.spine.activeStoryId = 7;
  h.spine.storyScopeEpoch = 1;
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify([
        {
          id: "job",
          storyId: 7,
          shotId: "shot-3",
          kind: "video",
          sequence: true,
          state: "rendering",
          requestId: "receipt",
          startedAt: Date.now(),
        },
      ]),
    setItem: vi.fn(),
  });
  h.status
    .mockReset()
    .mockResolvedValue({ take: { id: 88, status: "processing" } });
  h.refresh.mockResolvedValue({
    status: "ok",
    take: { id: 88, status: "available", videoUrl: "/88.mp4" },
  });
  h.material.mockResolvedValue({
    shots: [],
    unassignedVideoTakes: [],
    warehouseImages: [],
  });
  const empty = { fetch: vi.fn().mockResolvedValue([]), invalidate: vi.fn() };
  h.utils = {
    storyAgent: {
      storyMaterialState: { fetch: h.material, invalidate: vi.fn() },
      chatImageRevisions: empty,
    },
    timelineMedia: { audioAssetLibrary: empty },
    warehouseVideoSequence: { status: { fetch: h.status } },
  };
});
afterEach(() => {
  h.dispose.forEach((fn) => fn?.());
  vi.unstubAllGlobals();
});
it("restores a lost-response sequence without the dialog and refreshes its original receipt", async () => {
  start();
  await vi.waitFor(() => expect(h.spine.setMessages).toHaveBeenCalled());
  expect(h.status).toHaveBeenCalledWith({ storyId: 7, requestId: "receipt" });
  expect(h.refresh).toHaveBeenCalledWith({ takeId: 88 });
  const rows = h.spine.setMessages.mock.calls[0][0]([]);
  expect(rows).toMatchObject([
    {
      id: "warehouse-video-88-ready",
      selectionQuote: { storyId: 7, stableShotId: "shot-3" },
    },
  ]);
  expect(h.spine.setMessages.mock.calls[0][0](rows)).toEqual(rows);
  expect(render()[0].state).toBe("ready");
});
it("never posts a late completion into another story scope", async () => {
  let resolve!: (value: any) => void;
  h.status.mockImplementation(() => new Promise((r) => (resolve = r)));
  start();
  await vi.waitFor(() => expect(h.status).toHaveBeenCalled());
  h.spine.storyScopeEpoch = 3;
  resolve({ take: { id: 88, status: "processing" } });
  await vi.waitFor(() => expect(h.refresh).toHaveBeenCalled());
  await Promise.resolve();
  expect(h.spine.setMessages).not.toHaveBeenCalled();
});
