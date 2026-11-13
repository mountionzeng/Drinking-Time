import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { StudioUiContext } from "@shared/studioAssistant";
const m = vi.hoisted(() => ({
  chat: vi.fn(),
  confirm: vi.fn(),
  apply: vi.fn(),
  refs: [] as Array<{ current: unknown }>,
  cursor: 0,
  state: {
    accountId: 1,
    activeStoryId: 7,
    storyScopeEpoch: 1,
    storyLoadEpoch: 1,
    messages: [] as Array<{ role: string; content: string }>,
  },
}));
vi.mock("react", () => ({
  useRef: (initial: unknown) => {
    const i = m.cursor++;
    return m.refs[i] ?? (m.refs[i] = { current: initial });
  },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    studioAssistant: {
      chat: { useMutation: () => ({ mutateAsync: m.chat }) },
      confirm: { useMutation: () => ({ mutateAsync: m.confirm }) },
    },
  },
}));
vi.mock("./spine/storySpine", () => ({
  storySpineStore: { getState: () => m.state },
}));
import { useStudioAssistant } from "./useStudioAssistant";
let ui: StudioUiContext;
const render = () => {
  m.cursor = 0;
  const snapshot = { ...ui };
  return useStudioAssistant(() => snapshot, m.apply);
};
beforeEach(() => {
  m.refs = [];
  m.cursor = 0;
  Object.assign(m.state, {
    accountId: 1,
    activeStoryId: 7,
    storyScopeEpoch: 1,
    storyLoadEpoch: 1,
    messages: [],
  });
  m.chat
    .mockReset()
    .mockResolvedValue({
      handled: true,
      reply: "Ready",
      pending: { kind: "send", token: "signed-request" },
    });
  m.confirm.mockReset().mockResolvedValue({ handled: true, reply: "Sent" });
  m.apply.mockReset();
  vi.stubGlobal("window", new EventTarget());
  ui = {
    storyId: 7,
    workspace: "publishing",
    warehouseOpen: false,
    mailboxOpen: false,
    contactId: null,
    saveStatus: "saved",
    selection: null,
    language: "en",
  };
});
afterEach(() => vi.unstubAllGlobals());
describe("conversation interface bridge", () => {
  it("uses the submitted snapshot and omits the duplicated current user message from history", async () => {
    m.state.messages = [
      { role: "assistant", content: "Earlier" },
      { role: "user", content: "打开邮箱" },
    ];
    await render()("打开邮箱", { ...ui, saveStatus: "pending" });
    expect(m.chat.mock.calls[0][0]).toMatchObject({
      ui: { saveStatus: "pending" },
      history: [{ role: "assistant", content: "Earlier" }],
    });
  });
  it("uses the same signed request for retry after an unknown confirmation result", async () => {
    const run = render();
    await run("把故事发给岱");
    m.confirm.mockRejectedValueOnce(new Error("offline"));
    expect((await run("confirm send"))?.reply).toContain("offline");
    await run("confirm send");
    expect(m.confirm.mock.calls.map(c => c[0].token)).toEqual([
      "signed-request",
      "signed-request",
    ]);
    await run("confirm send");
    expect(m.confirm).toHaveBeenCalledTimes(2);
  });
  it.each(["cancel action", "请帮我写一首诗"])(
    "invalidates consent after %s",
    async message => {
      const run = render();
      await run("把故事发给岱");
      await run(message);
      await run("confirm send");
      expect(m.confirm).not.toHaveBeenCalled();
    }
  );
  it.each(["account", "story", "page", "contact"])(
    "rejects a confirmation after changing %s",
    async change => {
      const run = render();
      await run("把故事发给岱");
      if (change === "account") m.state.accountId = 2;
      if (change === "story") m.state.storyScopeEpoch++;
      if (change === "page") ui.workspace = "editing";
      if (change === "contact") ui.contactId = "x".repeat(43);
      render();
      await run("confirm send");
      expect(m.confirm).not.toHaveBeenCalled();
    }
  );
  it("does not apply late navigation after a render changes page", async () => {
    let resolve!: (result: unknown) => void;
    m.chat.mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const run = render();
    const waiting = run("打开邮箱");
    ui.workspace = "editing";
    render();
    resolve({
      handled: true,
      reply: "Opening mailbox",
      uiAction: { type: "mailbox" },
    });
    const outcome = await waiting;
    outcome?.afterReply?.();
    expect(m.apply).not.toHaveBeenCalled();
    expect(outcome?.reply).toContain("changed");
  });
  it("applies UI actions only after the response is stored and checks scope again", async () => {
    m.chat.mockResolvedValue({
      handled: true,
      reply: "Opening",
      uiAction: { type: "mailbox" },
    });
    const run = render(),
      outcome = await run("打开邮箱");
    expect(m.apply).not.toHaveBeenCalled();
    outcome?.afterReply?.();
    expect(m.apply).toHaveBeenCalledWith({ type: "mailbox" });
    const second = await run("打开邮箱");
    m.apply.mockClear();
    m.state.storyLoadEpoch++;
    second?.afterReply?.();
    expect(m.apply).not.toHaveBeenCalled();
  });
  it("does not fall through to an ordinary chat after an API error or duplicate submit", async () => {
    let reject!: (error: Error) => void;
    m.chat.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        })
    );
    const run = render(),
      first = run("打开邮箱");
    expect((await run("打开邮箱"))?.handled).toBe(true);
    expect(m.chat).toHaveBeenCalledTimes(1);
    reject(new Error("offline"));
    expect((await first)?.handled).toBe(true);
  });
});
