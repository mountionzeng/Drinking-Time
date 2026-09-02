import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  presentWorkspace,
  resolveSendIntent,
} from "../src/core/workspacePresentation";
import { createWorkspaceStore } from "../src/core/workspaceState";
import {
  createMockTransport,
  DEMO_RECOVERY_SCOPE,
} from "../src/services/mockTransport";
import { createMemoryStorage } from "../src/services/storage";

const PAGES_ROOT = path.resolve(import.meta.dirname, "..", "src", "pages");

function setup() {
  const transport = createMockTransport();
  const storage = createMemoryStorage();
  const store = createWorkspaceStore({
    scope: DEMO_RECOVERY_SCOPE,
    runtimeMode: "mock",
    transport,
    storage,
    now: () => 1_760_000_000_000,
  });
  return { store, transport, storage, ui: () => presentWorkspace(store.getState()) };
}

describe("mock 标识", () => {
  it("任何状态下都显示测试模式标识", async () => {
    const { store, ui } = setup();
    expect(ui().showsMockBanner).toBe(true);
    expect(ui().mockBadge).toContain("未绑定真实账号");
    await store.start();
    expect(ui().showsMockBanner).toBe(true);
    expect(ui().balance.demo).toBe(true);
    expect(ui().balance.text).toContain("演示余额");
  });
});

describe("聊天状态可见", () => {
  it("idle → pending → synced 都有可读标签", async () => {
    const { store, ui } = setup();
    await store.start();
    // 9001 带一条演示历史，所以一进来就是已同步。
    expect(ui().chat.state).toBe("synced");
    expect(ui().chat.canSend).toBe(true);

    // 没有历史的 Story 才是 idle。
    await store.selectStory(9002);
    expect(ui().chat.state).toBe("idle");
    expect(ui().chat.label).toBe("可以发消息");

    await store.sendMessage("今天想聊聊那杯酒");
    expect(ui().chat.state).toBe("synced");
    expect(ui().chat.label).toBe("已同步");
  });

  it("未知结果时给出查询入口，并明确禁止重复发送", async () => {
    const { store, transport, ui } = setup();
    await store.start();
    transport.setFailureMode("submit-turn-unknown");
    await store.sendMessage("会超时的一句");

    const view = ui();
    expect(view.chat.state).toBe("unknown");
    expect(view.chat.canLookupUnknown).toBe(true);
    expect(view.chat.canSend).toBe(false);
    expect(view.chat.blockedReason).toContain("先查询结果");
    expect(view.chat.label).toContain("不要重复发送");
  });

  it("明确失败时给出「用同一轮重试」", async () => {
    const { store, transport, ui } = setup();
    await store.start();
    transport.setFailureMode("submit-turn-failed");
    await store.sendMessage("会失败的一句");
    expect(ui().chat.state).toBe("error");
    expect(ui().chat.canRetryTurn).toBe(true);
  });
});

describe("正文状态可见", () => {
  it("clean → dirty → 保存 → clean", async () => {
    const { store, ui } = setup();
    await store.start();
    expect(ui().document.state).toBe("clean");
    expect(ui().document.canSave).toBe(false);

    store.editDocument("我改过的正文");
    expect(ui().document.state).toBe("dirty");
    expect(ui().document.canSave).toBe(true);

    await store.saveDocument();
    expect(ui().document.state).toBe("clean");
    expect(ui().document.label).toBe("已保存");
  });

  it("冲突时同时给出两份文本和复制入口", async () => {
    const { store, transport, ui } = setup();
    await store.start();
    store.editDocument("我这边写的");
    transport.setFailureMode("save-conflict");
    await store.saveDocument();

    const view = ui();
    expect(view.document.state).toBe("conflict");
    expect(view.document.canCopyBoth).toBe(true);
    expect(view.document.localBody).toBe("我这边写的");
    expect(view.document.serverBody).toContain("别的设备");
    expect(view.document.canDiscard).toBe(true);
  });
});

describe("Story 与 transport 状态", () => {
  it("没有 Story 时给出「先到电脑创建」的空态", async () => {
    const transport = createMockTransport();
    transport.setFailureMode("list-stories");
    const store = createWorkspaceStore({
      scope: DEMO_RECOVERY_SCOPE,
      runtimeMode: "mock",
      transport,
      storage: createMemoryStorage(),
    });
    await store.start();
    const view = presentWorkspace(store.getState());
    expect(view.transport.state).toBe("mock-failure");
    expect(view.transport.canRetry).toBe(true);
    expect(view.transport.label).toContain("演示 transport 失败");
  });

  it("脏正文切 Story 时弹出裁决面板", async () => {
    const { store, ui } = setup();
    await store.start();
    store.editDocument("没保存的文字");
    await store.selectStory(9002);
    const view = ui();
    expect(view.story.showsSwitchDialog).toBe(true);
    expect(view.story.pendingTitle).toContain("便利店");
  });

  it("余额不足时给出联系路径，且不挡正文", async () => {
    const { store, transport, ui } = setup();
    transport.setFailureMode("insufficient-balance");
    await store.start();
    const view = ui();
    expect(view.balance.blocked).toBe(true);
    expect(view.balance.blockedHint).toContain("联系负责人");
    expect(view.chat.canSend).toBe(false);
    store.editDocument("余额不足也能改正文");
    expect(ui().document.canSave).toBe(true);
  });
});

describe("发送闸门", () => {
  it("中文输入法组合期间的回车不发送", () => {
    expect(
      resolveSendIntent({
        source: "enter",
        text: "打了一半的中",
        composing: true,
        canSend: true,
      }),
    ).toEqual({ send: false, reason: "composing" });
  });

  it("组合期间点发送按钮仍然可以发送", () => {
    expect(
      resolveSendIntent({
        source: "button",
        text: "打完了",
        composing: true,
        canSend: true,
      }),
    ).toEqual({ send: true, text: "打完了" });
  });

  it("空白内容和被阻塞时都不发送", () => {
    expect(
      resolveSendIntent({
        source: "button",
        text: "   ",
        composing: false,
        canSend: true,
      }),
    ).toEqual({ send: false, reason: "empty" });
    expect(
      resolveSendIntent({
        source: "button",
        text: "有内容",
        composing: false,
        canSend: false,
      }),
    ).toEqual({ send: false, reason: "blocked" });
  });
});

// ---------------------------------------------------------------------------

function pageFiles(extension: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(entry => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith(extension) ? [full] : [];
    });
  return walk(PAGES_ROOT);
}

describe("页面范围", () => {
  it("页面里没有图片、素材、分镜、时间线、预览、视频或 Story 创建入口", () => {
    const forbidden = [
      /<image\b/,
      /<video\b/,
      /<camera\b/,
      /chooseImage|chooseMedia|chooseVideo|uploadFile/,
      /素材|分镜|时间线|时间轴|预览视频|新建\s*Story|创建\s*Story|新建故事/,
    ];
    const offenders: string[] = [];
    for (const file of [...pageFiles(".wxml"), ...pageFiles(".ts")]) {
      const content = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(content)) {
          offenders.push(`${path.basename(path.dirname(file))} → ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("所有动作按钮的触控目标不小于 88rpx（= 44px）", () => {
    const appWxss = readFileSync(
      path.resolve(import.meta.dirname, "..", "src", "app.wxss"),
      "utf8",
    );
    expect(appWxss).toMatch(/\.action\s*\{[^}]*min-height:\s*88rpx/);
    expect(appWxss).toMatch(/\.action\s*\{[^}]*min-width:\s*88rpx/);
    // 字号放大时不能截断：不允许固定 height，也不允许 nowrap。
    expect(appWxss).not.toMatch(/\.action\s*\{[^}]*[^-]height:\s*\d/);
    expect(appWxss).toMatch(/\.action\s*\{[^}]*white-space:\s*normal/);
  });

  it("每个页面都渲染 mock 标识", () => {
    for (const file of pageFiles(".wxml")) {
      expect(readFileSync(file, "utf8"), file).toContain("mock-banner");
    }
  });

  it("输入区适配 safe-area 与软键盘", () => {
    const workspaceWxml = readFileSync(
      path.join(PAGES_ROOT, "workspace", "index.wxml"),
      "utf8",
    );
    expect(workspaceWxml).toContain("safe-bottom");
    expect(workspaceWxml).toContain('adjust-position="{{true}}"');
    const appWxss = readFileSync(
      path.resolve(import.meta.dirname, "..", "src", "app.wxss"),
      "utf8",
    );
    expect(appWxss).toContain("env(safe-area-inset-bottom)");
  });
});
