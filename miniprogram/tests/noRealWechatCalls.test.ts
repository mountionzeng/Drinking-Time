import { beforeAll, describe, expect, it } from "vitest";

/**
 * 「应用代码没有调用任何微信身份／网络 API」的证据。
 *
 * 做法不是「在开发者工具的网络面板里没看见请求」——那只是没观察到。
 * 这里把 `wx.login` / `wx.request` / `wx.uploadFile` / `wx.downloadFile` /
 * `wx.connectSocket` 换成**会计数并抛错**的 stub，然后用真实的 app.ts 和
 * 三个真实页面模块走完：拒绝隐私 → 同意隐私 → 进入工作区 → 聊天 → 保存正文
 * → 演示 transport 失败 → 重试 → 前后台切换。走完之后断言计数全为 0。
 */

type Counter = Record<string, number>;

const forbidden: Counter = {
  login: 0,
  request: 0,
  uploadFile: 0,
  downloadFile: 0,
  connectSocket: 0,
};

const allowed: Counter = {
  navigateTo: 0,
  showToast: 0,
  showModal: 0,
  setClipboardData: 0,
};

type PageOptions = Record<string, unknown> & { data?: Record<string, unknown> };

const capturedPages: PageOptions[] = [];
let capturedApp: Record<string, unknown> | null = null;

function forbiddenStub(name: string) {
  return (): never => {
    forbidden[name] = (forbidden[name] ?? 0) + 1;
    throw new Error(`应用代码不允许调用 wx.${name}`);
  };
}

function installWechatStubs(): void {
  const store = new Map<string, string>();
  const globalScope = globalThis as unknown as Record<string, unknown>;

  globalScope.wx = {
    getStorageSync: (key: string) => store.get(key) ?? "",
    setStorageSync: (key: string, value: string) => {
      store.set(key, value);
    },
    removeStorageSync: (key: string) => {
      store.delete(key);
    },
    getStorageInfoSync: () => ({
      keys: Array.from(store.keys()),
      currentSize: 0,
      limitSize: 10240,
    }),
    getAccountInfoSync: () => ({ miniProgram: { appId: "touristappid" } }),
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }),
    navigateTo: () => {
      allowed.navigateTo += 1;
    },
    redirectTo: () => {
      allowed.navigateTo += 1;
    },
    navigateBack: () => {},
    showToast: () => {
      allowed.showToast += 1;
    },
    showModal: (options: { success?: (r: { confirm: boolean; cancel: boolean }) => void }) => {
      allowed.showModal += 1;
      options.success?.({ confirm: true, cancel: false });
    },
    setClipboardData: () => {
      allowed.setClipboardData += 1;
    },
    nextTick: (callback: () => void) => callback(),
    login: forbiddenStub("login"),
    request: forbiddenStub("request"),
    uploadFile: forbiddenStub("uploadFile"),
    downloadFile: forbiddenStub("downloadFile"),
    connectSocket: forbiddenStub("connectSocket"),
  };

  globalScope.App = (options: Record<string, unknown>) => {
    capturedApp = options;
  };
  globalScope.getApp = () => capturedApp;
  globalScope.Page = (options: PageOptions) => {
    capturedPages.push(options);
  };
  globalScope.getCurrentPages = () => [];
}

type PageInstance = Record<string, unknown> & {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
};

function instantiate(options: PageOptions): PageInstance {
  const page = {
    ...options,
    data: { ...(options.data ?? {}) },
    setData(patch: Record<string, unknown>) {
      Object.assign(page.data, patch);
    },
  } as PageInstance;
  return page;
}

function call(page: PageInstance, method: string, ...args: unknown[]): unknown {
  const handler = page[method];
  if (typeof handler !== "function") throw new Error(`缺少处理函数 ${method}`);
  return (handler as (...rest: unknown[]) => unknown).apply(page, args);
}

async function flush(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

let start: PageInstance;
let privacy: PageInstance;
let workspace: PageInstance;

beforeAll(async () => {
  installWechatStubs();
  await import("../src/app");
  await import("../src/pages/start/index");
  await import("../src/pages/privacy/index");
  await import("../src/pages/workspace/index");
  expect(capturedPages).toHaveLength(3);
  start = instantiate(capturedPages[0] as PageOptions);
  privacy = instantiate(capturedPages[1] as PageOptions);
  workspace = instantiate(capturedPages[2] as PageOptions);
});

describe("stub 本身是有效的", () => {
  it("被禁的 API 一旦调用就会计数并抛错", () => {
    const probe: Counter = { ...forbidden };
    const wechat = (globalThis as unknown as Record<string, { login: () => void }>)
      .wx;
    expect(() => wechat.login()).toThrow(/wx\.login/);
    expect(forbidden.login).toBe((probe.login ?? 0) + 1);
    // 复位，后面的流程断言必须从 0 开始。
    forbidden.login = 0;
  });
});

describe("走完全流程", () => {
  it("未同意隐私说明时进不去工作区", () => {
    call(start, "onShow");
    expect(start.data.canEnterWorkspace).toBe(false);
    const before = allowed.navigateTo;
    call(start, "enterWorkspace");
    expect(allowed.navigateTo).toBe(before);
    expect(allowed.showToast).toBeGreaterThan(0);
  });

  it("明确拒绝后仍然进不去", () => {
    call(privacy, "onShow");
    call(privacy, "onReject");
    expect(privacy.data.status).toBe("rejected");
    call(start, "onShow");
    expect(start.data.canEnterWorkspace).toBe(false);
  });

  it("同意后才能进入工作区", () => {
    call(privacy, "onAccept");
    expect(privacy.data.accepted).toBe(true);
    call(start, "onShow");
    expect(start.data.canEnterWorkspace).toBe(true);
    const before = allowed.navigateTo;
    call(start, "enterWorkspace");
    expect(allowed.navigateTo).toBe(before + 1);
  });

  it("工作区能加载演示 Story、聊天、保存正文", async () => {
    call(workspace, "onLoad");
    await flush();
    expect(workspace.data.ready).toBe(true);
    expect((workspace.data.storyTitles as string[]).length).toBe(2);

    call(workspace, "onDraftInput", { detail: { value: "今天想聊聊那杯酒" } });
    call(workspace, "onSendTap");
    await flush();
    expect((workspace.data.messages as unknown[]).length).toBeGreaterThan(1);

    call(workspace, "onBodyInput", { detail: { value: "在小程序里改的正文" } });
    call(workspace, "onSaveBody");
    await flush();
    const ui = workspace.data.ui as { document: { state: string } };
    expect(ui.document.state).toBe("clean");
  });

  it("中文输入法组合期间的回车不会发出去", async () => {
    const before = (workspace.data.messages as unknown[]).length;
    call(workspace, "onCompositionStart");
    call(workspace, "onDraftInput", { detail: { value: "打了一半的中" } });
    call(workspace, "onDraftConfirm");
    await flush();
    expect((workspace.data.messages as unknown[]).length).toBe(before);
    expect(workspace.data.draft).toBe("打了一半的中");
    call(workspace, "onCompositionEnd");
  });

  it("演示 transport 失败与重试都不发请求", async () => {
    // 2 = 「打开 Story 失败」：这正是 onRetryTransport 会走的那条路径。
    call(workspace, "onFailureModeChange", { detail: { value: 2 } });
    call(workspace, "onRetryTransport");
    await flush();
    let ui = workspace.data.ui as { transport: { state: string; canRetry: boolean } };
    expect(ui.transport.state).toBe("mock-failure");
    expect(ui.transport.canRetry).toBe(true);

    call(workspace, "onFailureModeChange", { detail: { value: 0 } });
    call(workspace, "onRetryTransport");
    await flush();
    ui = workspace.data.ui as { transport: { state: string; canRetry: boolean } };
    expect(ui.transport.state).toBe("mock-ready");
  });

  it("冲突时复制两份文本、放弃草稿都不发请求", async () => {
    call(workspace, "onBodyInput", { detail: { value: "又改了一次" } });
    // 5 = 「正文冲突」
    call(workspace, "onFailureModeChange", { detail: { value: 5 } });
    call(workspace, "onSaveBody");
    await flush();
    const ui = workspace.data.ui as { document: { state: string } };
    expect(ui.document.state).toBe("conflict");

    const beforeCopy = allowed.setClipboardData;
    call(workspace, "onCopyBoth");
    expect(allowed.setClipboardData).toBe(beforeCopy + 1);

    call(workspace, "onDiscardDraft");
    await flush();
    call(workspace, "onFailureModeChange", { detail: { value: 0 } });
  });

  it("前后台切换不发请求也不丢草稿", async () => {
    call(workspace, "onBodyInput", { detail: { value: "离开前没保存的文字" } });
    call(workspace, "onHide");
    call(workspace, "onShow");
    await flush();
    const ui = workspace.data.ui as { document: { localBody: string } };
    expect(ui.document.localBody).toBe("离开前没保存的文字");
  });
});

describe("最终断言", () => {
  it("整个流程里应用代码一次都没有调用微信身份或网络 API", () => {
    expect(forbidden).toEqual({
      login: 0,
      request: 0,
      uploadFile: 0,
      downloadFile: 0,
      connectSocket: 0,
    });
  });
});
