import { describe, expect, it } from "vitest";

import { recoveryKey } from "../src/core/recoveryState";
import { createWorkspaceStore } from "../src/core/workspaceState";
import { createMemoryStorage } from "../src/services/storage";
import { transportOk } from "../src/services/transport";
import { balance, createFakeTransport } from "./support/fakeTransport";

const SCOPE = "demo-scope-aaaa";
const NOW = 1_760_000_000_000;

function setup(transport = createFakeTransport()) {
  const storage = createMemoryStorage();
  let counter = 0;
  const store = createWorkspaceStore({
    scope: SCOPE,
    runtimeMode: "mock",
    transport,
    storage,
    now: () => NOW,
    idFactory: () => `id-${(counter += 1)}`,
  });
  return { store, storage, transport };
}

describe("启动与 Story 选择", () => {
  it("happy path：打开最近 Story，聊一轮、存一次正文都回到权威状态", async () => {
    const { store, transport } = setup();
    await store.start();

    expect(store.getState().storyPhase).toBe("selected");
    expect(store.getState().activeStoryId).toBe(1);
    expect(store.getState().balance?.demo).toBe(true);

    await store.sendMessage("今天想聊聊那杯酒");
    const afterChat = store.getState();
    expect(afterChat.turns[0]?.status).toBe("synced");
    expect(afterChat.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    store.editDocument("我在手机上改的正文");
    expect(store.getState().document.status).toBe("dirty");
    await store.saveDocument();
    expect(store.getState().document.status).toBe("saved");
    expect(store.getState().document.body).toBe("我在手机上改的正文");
    expect(transport.calls.saveDocumentBody).toHaveLength(1);
  });

  it("没有 Story 时进入 empty，不展示上一份数据", async () => {
    const { store } = setup(createFakeTransport({ stories: [] }));
    await store.start();
    expect(store.getState().storyPhase).toBe("empty");
    expect(store.getState().activeStoryId).toBeNull();
    expect(store.getState().messages).toEqual([]);
  });

  it("transport 失败时进入 error 并可重试", async () => {
    const transport = createFakeTransport();
    transport.nextListStoriesError = {
      kind: "unavailable",
      message: "演示 transport 故障",
      retryable: true,
      resultUnknown: false,
    };
    const { store } = setup(transport);
    await store.start();
    expect(store.getState().storyPhase).toBe("error");
    expect(store.getState().transportStatus).toBe("failure");
    expect(store.getState().transportError).toBe("演示 transport 故障");

    await store.retryTransport();
    expect(store.getState().storyPhase).toBe("selected");
    expect(store.getState().transportStatus).toBe("ready");
  });
});

describe("聊天幂等", () => {
  it("快速重复点击只产生一个 pending turn，只提交一次", async () => {
    const transport = createFakeTransport();
    const control = transport.holdNextSubmit();
    const { store } = setup(transport);
    await store.start();

    const first = store.sendMessage("重复点击");
    await store.sendMessage("重复点击");
    await store.sendMessage("重复点击");
    expect(store.getState().turns).toHaveLength(1);
    expect(transport.calls.submitTurn).toHaveLength(1);

    control.resolve(
      transportOk({
        assistantContent: "只回答一次",
        persisted: true,
        balance: balance(),
      }),
    );
    await first;
    expect(store.getState().turns).toHaveLength(1);
    expect(transport.calls.submitTurn).toHaveLength(1);
  });

  it("未知结果只能查询，查询用同一个 requestHash，不会二次生成", async () => {
    const transport = createFakeTransport();
    transport.nextSubmitError = {
      kind: "timeout",
      message: "请求超时，结果未知",
      retryable: true,
      resultUnknown: true,
    };
    const { store } = setup(transport);
    await store.start();
    await store.sendMessage("会超时的一句");

    const unknownTurn = store.getState().turns[0];
    expect(unknownTurn?.status).toBe("generation-unknown");
    const originalHash = unknownTurn?.requestHash;

    // 未知期间再发消息不会新建 turn。
    await store.sendMessage("再发一次试试");
    expect(store.getState().turns).toHaveLength(1);
    expect(transport.calls.submitTurn).toHaveLength(1);
    expect(store.getState().chatError).toContain("不要重复生成");

    transport.lookupResponse = {
      status: "synced",
      assistantContent: "服务端其实已经生成了",
      balance: balance(2900),
    };
    await store.lookupUnknownTurn();

    expect(transport.calls.lookupTurn[0]?.requestHash).toBe(originalHash);
    expect(transport.calls.submitTurn).toHaveLength(1);
    const settled = store.getState().turns[0];
    expect(settled?.status).toBe("synced");
    expect(settled?.requestHash).toBe(originalHash);
  });

  it("查询发现服务端没有这一轮时，允许用同一 turn 重试", async () => {
    const transport = createFakeTransport();
    transport.nextSubmitError = {
      kind: "unknown-result",
      message: "结果未知",
      retryable: true,
      resultUnknown: true,
    };
    const { store } = setup(transport);
    await store.start();
    await store.sendMessage("一句话");

    transport.lookupResponse = {
      status: "missing",
      assistantContent: null,
      balance: null,
    };
    await store.lookupUnknownTurn();
    const hash = store.getState().turns[0]?.requestHash;
    expect(store.getState().turns[0]?.status).toBe("generation-failed");

    await store.retryTurn();
    expect(transport.calls.submitTurn).toHaveLength(2);
    // 重试用的是同一个幂等键。
    expect(transport.calls.submitTurn[1]?.requestHash).toBe(hash);
    expect(store.getState().turns[0]?.status).toBe("synced");
  });
});

describe("Story 隔离", () => {
  it("Story A 的迟到结果不渲染到 Story B，但会写进 A 自己的恢复记录", async () => {
    const transport = createFakeTransport();
    const control = transport.holdNextSubmit();
    const { store, storage } = setup(transport);
    await store.start();

    const pending = store.sendMessage("在 Story 1 发的消息");
    await store.selectStory(2);
    expect(store.getState().activeStoryId).toBe(2);

    control.resolve(
      transportOk({
        assistantContent: "Story 1 的迟到回答",
        persisted: true,
        balance: balance(),
      }),
    );
    await pending;

    // 当前视图是 Story 2，绝不能出现 Story 1 的文字。
    const visible = JSON.stringify(store.getState().messages);
    expect(visible).not.toContain("Story 1 的迟到回答");
    expect(visible).not.toContain("在 Story 1 发的消息");

    // 但 Story 1 自己的恢复记录里结果已经落好了。
    const storedStory1 = storage.getItem(recoveryKey("conversation", SCOPE, 1));
    expect(storedStory1).toContain("Story 1 的迟到回答");
  });

  it("脏正文切 Story 会被拦下，取消则留在原地", async () => {
    const { store } = setup();
    await store.start();
    store.editDocument("还没保存的文字");

    await store.selectStory(2);
    expect(store.getState().storyPhase).toBe("switching-dirty");
    expect(store.getState().pendingStoryId).toBe(2);
    expect(store.getState().activeStoryId).toBe(1);
    expect(store.getState().document.body).toBe("还没保存的文字");

    await store.resolveStorySwitch("cancel");
    expect(store.getState().storyPhase).toBe("selected");
    expect(store.getState().activeStoryId).toBe(1);
    expect(store.getState().document.body).toBe("还没保存的文字");
  });

  it("明确放弃草稿后才切走，新 Story 看不到旧文字", async () => {
    const { store, storage } = setup();
    await store.start();
    store.editDocument("Story 1 的草稿");

    await store.selectStory(2);
    await store.resolveStorySwitch("discard");

    expect(store.getState().activeStoryId).toBe(2);
    expect(store.getState().document.body).toBe("Story 2 的服务端正文");
    expect(storage.getItem(recoveryKey("document", SCOPE, 1))).toBeNull();
  });
});

describe("生命周期", () => {
  it("onHide 只写本机存储，不发任何请求", async () => {
    const transport = createFakeTransport();
    const { store, storage } = setup(transport);
    await store.start();
    store.editDocument("离开前没保存的文字");

    const before = {
      list: transport.calls.listStories,
      open: transport.calls.openStory.length,
      submit: transport.calls.submitTurn.length,
      save: transport.calls.saveDocumentBody.length,
    };
    store.onHide();
    expect({
      list: transport.calls.listStories,
      open: transport.calls.openStory.length,
      submit: transport.calls.submitTurn.length,
      save: transport.calls.saveDocumentBody.length,
    }).toEqual(before);
    expect(storage.getItem(recoveryKey("document", SCOPE, 1))).toContain(
      "离开前没保存的文字",
    );
  });

  it("onShow 刷新权威但不覆盖 dirty 正文", async () => {
    const transport = createFakeTransport();
    const { store } = setup(transport);
    await store.start();
    store.editDocument("手机上没保存的文字");

    // 别的设备把服务端正文改了。
    transport.documents.set(1, {
      ...(transport.documents.get(1) ?? {
        storyId: 1,
        storyRevision: 1,
        versionId: "version-1",
        platform: "xiaohongshu" as const,
        body: "",
        bodyRevision: 1,
        updatedAt: NOW,
      }),
      body: "电脑上改过的正文",
      bodyRevision: 5,
    });

    await store.onShow();
    expect(store.getState().document.body).toBe("手机上没保存的文字");
    expect(store.getState().document.status).toBe("conflict");
    expect(store.getState().document.conflict?.latestDocument?.body).toBe(
      "电脑上改过的正文",
    );
  });

  it("退出后旧作用域的草稿被清掉，枚举存储也读不到", async () => {
    const { store, storage } = setup();
    await store.start();
    store.editDocument("退出前的文字");
    store.onHide();
    expect(storage.getItem(recoveryKey("document", SCOPE, 1))).toContain(
      "退出前的文字",
    );

    store.signOut();
    const remaining = storage
      .keys()
      .map(key => storage.getItem(key) ?? "")
      .join("\n");
    expect(remaining).not.toContain("退出前的文字");
    expect(store.getState().document.body).toBe("");
    expect(store.getState().activeStoryId).toBeNull();
  });

  it("换账号作用域后，新作用域读不到上一个作用域的草稿", async () => {
    const storage = createMemoryStorage();
    const transport = createFakeTransport();
    const first = createWorkspaceStore({
      scope: SCOPE,
      runtimeMode: "mock",
      transport,
      storage,
      now: () => NOW,
    });
    await first.start();
    first.editDocument("上一个账号的正文");
    first.onHide();

    const second = createWorkspaceStore({
      scope: "demo-scope-bbbb",
      runtimeMode: "mock",
      transport,
      storage,
      now: () => NOW,
    });
    await second.start();

    expect(second.getState().document.body).toBe("Story 1 的服务端正文");
    const remaining = storage
      .keys()
      .map(key => storage.getItem(key) ?? "")
      .join("\n");
    expect(remaining).not.toContain("上一个账号的正文");
  });
});

describe("正文冲突与余额", () => {
  it("base revision 过期时保留两份文本，不自动覆盖", async () => {
    const transport = createFakeTransport();
    const { store } = setup(transport);
    await store.start();
    store.editDocument("我这边的文字");

    transport.documents.set(1, {
      storyId: 1,
      storyRevision: 1,
      versionId: "version-1",
      platform: "xiaohongshu",
      body: "别处已经改过的文字",
      bodyRevision: 9,
      updatedAt: NOW,
    });

    await store.saveDocument();
    const state = store.getState();
    expect(state.document.status).toBe("conflict");
    expect(state.document.conflict?.localBody).toBe("我这边的文字");
    expect(state.document.conflict?.latestDocument?.body).toBe(
      "别处已经改过的文字",
    );
  });

  it("余额不足挡住新的付费调用，但不挡正文编辑", async () => {
    const transport = createFakeTransport();
    transport.balanceCents = 0;
    const { store } = setup(transport);
    await store.start();
    expect(store.getState().balanceBlocked).toBe(true);

    await store.sendMessage("还想再聊一句");
    expect(transport.calls.submitTurn).toHaveLength(0);
    expect(store.getState().chatError).toContain("余额不足");

    store.editDocument("余额不足时仍然可以改正文");
    expect(store.getState().document.status).toBe("dirty");
    await store.saveDocument();
    expect(store.getState().document.status).toBe("saved");
  });
});

describe("恢复记录损坏", () => {
  it("坏掉的恢复记录不阻断启动，直接按服务端权威渲染", async () => {
    const storage = createMemoryStorage();
    storage.setItem(recoveryKey("document", SCOPE, 1), "{这不是 JSON");
    storage.setItem(recoveryKey("conversation", SCOPE, 1), JSON.stringify("也不是数组"));
    const transport = createFakeTransport();
    const store = createWorkspaceStore({
      scope: SCOPE,
      runtimeMode: "mock",
      transport,
      storage,
      now: () => NOW,
    });

    await expect(store.start()).resolves.toBeUndefined();
    expect(store.getState().storyPhase).toBe("selected");
    expect(store.getState().document.body).toBe("Story 1 的服务端正文");
    expect(store.getState().messages).toEqual([]);
  });
});
