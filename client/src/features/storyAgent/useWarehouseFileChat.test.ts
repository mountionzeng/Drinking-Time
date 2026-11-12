import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  inspect: vi.fn(),
  state: {
    accountId: 1,
    activeStoryId: 7,
    storyScopeEpoch: 1,
    storyLoadEpoch: 1,
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    creationAgent: {
      inspectWarehouseFiles: {
        useMutation: () => ({ mutateAsync: m.inspect }),
      },
    },
  },
}));
vi.mock("./spine/storySpine", () => ({
  storySpineStore: { getState: () => ({ ...m.state }) },
}));
import { useWarehouseFileChat } from "./useWarehouseFileChat";
beforeEach(() => {
  m.inspect.mockReset();
  m.state.activeStoryId = 7;
});
it("uses deterministic local inspection and keeps errors handled", async () => {
  const run = useWarehouseFileChat();
  expect(await run(7, "改第03镜")).toBeNull();
  expect(m.inspect).not.toHaveBeenCalled();
  m.inspect.mockResolvedValue("saved locally");
  expect(await run(7, "仓库文件 #3 分析一下")).toEqual({
    handled: true,
    reply: "saved locally",
  });
  m.inspect.mockRejectedValue(new Error("offline"));
  expect(await run(7, "file #3")).toMatchObject({
    handled: true,
    reply: expect.stringContaining("offline"),
  });
});
it("does not attach a late reply to a newly selected story", async () => {
  m.inspect.mockImplementation(async () => {
    m.state.activeStoryId = 8;
    return "original result";
  });
  expect((await useWarehouseFileChat()(7, "file #3"))?.reply).not.toBe(
    "original result"
  );
});
