import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  fetch: vi.fn(),
  decide: vi.fn(),
  invalidate: vi.fn(),
  select: vi.fn(),
  state: {
    accountId: 1,
    activeStoryId: 1,
    storyScopeEpoch: 1,
    storyLoadEpoch: 1,
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    storyAgent: {
      decideChatImageRevision: {
        useMutation: () => ({ mutateAsync: m.decide }),
      },
    },
    useUtils: () => ({
      storyAgent: {
        chatImageRevisions: { fetch: m.fetch, invalidate: m.invalidate },
        storyGet: { invalidate: m.invalidate },
        storyImages: { invalidate: m.invalidate },
        storyMaterialState: { invalidate: m.invalidate },
      },
    }),
  },
}));
vi.mock("./spine/storySpine", () => ({
  storySpineStore: {
    getState: () => ({ ...m.state, setActiveSelection: m.select }),
  },
}));
import { useImageRevisionChat } from "./useImageRevisionChat";
beforeEach(() => {
  vi.clearAllMocks();
  m.state.activeStoryId = 1;
  m.fetch.mockResolvedValue([
    {
      requestId: "r",
      shotNo: 1,
      stableShotId: "s1",
      sourceImageId: 10,
      status: "succeeded",
      candidates: [{ imageId: 20, imageUrl: "/20" }],
    },
  ]);
});
it("only explicit replacement makes a mutation, and then refreshes material and selection", async () => {
  const run = useImageRevisionChat();
  expect(await run(1, "再把脸变亮一些")).toBeNull();
  expect(m.decide).not.toHaveBeenCalled();
  expect((await run(1, "替换原图"))?.reply).toContain("已用新图替换");
  expect(m.decide).toHaveBeenCalledWith({
    storyId: 1,
    requestId: "r",
    kind: "replace",
    imageId: 20,
  });
  expect(m.select).toHaveBeenCalledWith(
    expect.objectContaining({ imageId: 20, stableShotId: "s1" })
  );
});
it("does not guess a candidate and can resolve an exact image ID", async () => {
  m.fetch.mockResolvedValue([
    {
      requestId: "r",
      shotNo: 1,
      status: "succeeded",
      candidates: [{ imageId: 20 }, { imageId: 21 }],
    },
  ]);
  const run = useImageRevisionChat();
  expect((await run(1, "替换原图"))?.reply).toContain("2 张新图");
  expect(m.decide).not.toHaveBeenCalled();
  await run(1, "图片 #21 替换原图");
  expect(m.decide).toHaveBeenCalledWith(
    expect.objectContaining({ imageId: 21 })
  );
});
it("keeps the original and never chooses a new image on a decline", async () => {
  await useImageRevisionChat()(1, "保留原图");
  expect(m.decide).toHaveBeenCalledWith({
    storyId: 1,
    requestId: "r",
    kind: "keep",
    imageId: undefined,
  });
  expect(m.select).not.toHaveBeenCalled();
});
it("rejects a late choice after the user switches stories", async () => {
  m.fetch.mockImplementation(async () => {
    m.state.activeStoryId = 2;
    return [];
  });
  await useImageRevisionChat()(1, "替换原图");
  expect(m.decide).not.toHaveBeenCalled();
});
