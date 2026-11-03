import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { useStoryRename } from "./useStoryRename";

const state = vi.hoisted(() => ({
  accountId: "owner", activeStoryId: 7, remoteStoryId: 7, storyScopeEpoch: 1,
  setStoryTitle: vi.fn(), setStoryList: vi.fn(),
}));
const mutateAsync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trpc", () => ({ trpc: {
  storyAgent: { storyRename: { useMutation: () => ({ mutateAsync }) } },
  useUtils: () => ({ storyAgent: { storyGet: { invalidate: vi.fn() }, storyList: { invalidate: vi.fn() } } }),
} }));
vi.mock("./spine/storySpine", () => ({
  storySpineStore: { getState: () => ({ ...state }) },
  useStorySpine: (select: (value: typeof state) => unknown) => select(state),
}));
beforeEach(() => {
  vi.clearAllMocks(); mutateAsync.mockReset();
  state.accountId = "owner";
});
function action() {
  let rename!: ReturnType<typeof useStoryRename>;
  function Harness() { rename = useStoryRename(); return null; }
  renderToStaticMarkup(createElement(Harness));
  return rename;
}
it("serializes both title inputs so a slow earlier response cannot overwrite the later title", async () => {
  let finish!: (result: { status: string }) => void;
  mutateAsync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ status: "ok" });
  const rename = action();
  const first = rename(7, "先改名"); const second = rename(7, "最后名称");
  await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
  finish({ status: "ok" }); await Promise.all([first, second]);
  expect(mutateAsync.mock.calls.map(([input]) => input.title)).toEqual(["先改名", "最后名称"]);
  expect(state.setStoryTitle).toHaveBeenLastCalledWith("最后名称");
});
it("allows a later save after a failed request and rejects a queued save after account switch", async () => {
  mutateAsync.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "ok" });
  const rename = action();
  await expect(rename(7, "失败名称")).rejects.toThrow("offline");
  await rename(7, "重试名称");
  expect(state.setStoryTitle).toHaveBeenLastCalledWith("重试名称");
  const switched = rename(7, "旧账号名称"); state.accountId = "other";
  await expect(switched).rejects.toThrow("账号已切换");
  expect(mutateAsync).toHaveBeenCalledTimes(2);
});
