import { describe, expect, it } from "vitest";

import {
  createMockTransport,
  DEMO_RECOVERY_SCOPE,
  DEMO_STORIES,
} from "../src/services/mockTransport";
import { isRecoveryScope } from "../src/core/types";

function submitRequest(overrides: Record<string, unknown> = {}) {
  return {
    storyId: 9001,
    clientTurnId: "turn-1",
    requestHash: "sct1-aaaabbbbccccddddeeeeffff00001111",
    userClientMessageId: "user-1",
    assistantClientMessageId: "assistant-1",
    userContent: "今天想聊聊那杯酒",
    ...overrides,
  } as Parameters<ReturnType<typeof createMockTransport>["submitTurn"]>[0];
}

describe("演示数据", () => {
  it("演示作用域是合法的不透明 scope，明确只属于 mock", () => {
    expect(isRecoveryScope(DEMO_RECOVERY_SCOPE)).toBe(true);
    expect(DEMO_RECOVERY_SCOPE).toContain("mock");
  });

  it("演示 Story 里没有真实姓名、联系方式或账号信息", () => {
    // 只扫文案，不扫时间戳 —— 时间戳会假装成手机号。
    const text = DEMO_STORIES.map(story => story.title).join("\n");
    expect(text).not.toMatch(/@|\b1[3-9]\d{9}\b|openid|wx[0-9a-f]{16}/);
    for (const story of DEMO_STORIES) {
      expect(story.title.startsWith("演示")).toBe(true);
    }
  });

  it("列表与打开 Story 返回确定性演示数据，余额标为演示", async () => {
    const transport = createMockTransport();
    const list = await transport.listStories();
    expect(list.ok && list.data).toHaveLength(2);

    const opened = await transport.openStory(9001);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.data.balance.demo).toBe(true);
      expect(opened.data.document.body).toContain("演示正文");
    }
  });
});

describe("整轮幂等", () => {
  it("同一 requestHash 只生成一次，重复提交返回同一份结果", async () => {
    const transport = createMockTransport();
    const first = await transport.submitTurn(submitRequest());
    expect(transport.generationCount).toBe(1);
    const second = await transport.submitTurn(submitRequest());
    expect(transport.generationCount).toBe(1);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.assistantContent).toBe(first.data.assistantContent);
    }
  });

  it("重复提交不会重复扣费", async () => {
    const transport = createMockTransport();
    const first = await transport.submitTurn(submitRequest());
    const second = await transport.submitTurn(submitRequest());
    if (first.ok && second.ok) {
      expect(second.data.balance.availableCents).toBe(
        first.data.balance.availableCents,
      );
    }
  });

  it("不同 requestHash 才算新的一轮", async () => {
    const transport = createMockTransport();
    await transport.submitTurn(submitRequest());
    await transport.submitTurn(
      submitRequest({ requestHash: "sct1-1111222233334444555566667777888" }),
    );
    expect(transport.generationCount).toBe(2);
  });

  it("查询未提交过的 turn 返回 missing，查询提交过的返回同一段文字", async () => {
    const transport = createMockTransport();
    const missing = await transport.lookupTurn({
      storyId: 9001,
      clientTurnId: "turn-x",
      requestHash: "sct1-not-submitted",
    });
    expect(missing.ok && missing.data.status).toBe("missing");

    const submitted = await transport.submitTurn(submitRequest());
    const found = await transport.lookupTurn({
      storyId: 9001,
      clientTurnId: "turn-1",
      requestHash: "sct1-aaaabbbbccccddddeeeeffff00001111",
    });
    expect(found.ok && found.data.status).toBe("synced");
    if (found.ok && submitted.ok) {
      expect(found.data.assistantContent).toBe(submitted.data.assistantContent);
    }
    // 查询不是生成。
    expect(transport.generationCount).toBe(1);
  });

  it("回答是确定性的，不依赖任何模型", async () => {
    const a = createMockTransport();
    const b = createMockTransport();
    const first = await a.submitTurn(submitRequest());
    const second = await b.submitTurn(submitRequest());
    if (first.ok && second.ok) {
      expect(second.data.assistantContent).toBe(first.data.assistantContent);
      expect(first.data.assistantContent).toContain("未调用任何模型");
    }
  });
});

describe("正文 CAS", () => {
  it("基于当前 revision 保存成功，revision 递增", async () => {
    const transport = createMockTransport();
    const result = await transport.saveDocumentBody({
      storyId: 9001,
      versionId: "demo-version-9001",
      platform: "xiaohongshu",
      baseBodyRevision: 1,
      body: "改过的演示正文",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.document.bodyRevision).toBe(2);
      expect(result.data.document.body).toBe("改过的演示正文");
    }
  });

  it("基于过期 revision 保存冲突，并带回服务端那份", async () => {
    const transport = createMockTransport();
    const result = await transport.saveDocumentBody({
      storyId: 9001,
      versionId: "demo-version-9001",
      platform: "xiaohongshu",
      baseBodyRevision: 99,
      body: "过期的修改",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("conflict");
      expect(result.error.latestDocument?.body).toContain("演示正文");
    }
  });
});

describe("演示失败状态", () => {
  it("失败是显式切换出来的，不会静默恢复成看起来真实的成功", async () => {
    const transport = createMockTransport();
    transport.setFailureMode("list-stories");
    const failed = await transport.listStories();
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.message).toContain("演示");

    // 没有显式改回来之前，它一直失败。
    expect((await transport.listStories()).ok).toBe(false);
    transport.setFailureMode("none");
    expect((await transport.listStories()).ok).toBe(true);
  });

  it("未知结果与明确失败是两种状态", async () => {
    const transport = createMockTransport();
    transport.setFailureMode("submit-turn-unknown");
    const unknown = await transport.submitTurn(submitRequest());
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.resultUnknown).toBe(true);

    transport.setFailureMode("submit-turn-failed");
    const failed = await transport.submitTurn(submitRequest());
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.resultUnknown).toBe(false);

    // 两种失败都没有真的生成过。
    expect(transport.generationCount).toBe(0);
  });

  it("余额不足时明确拒绝，不产生生成", async () => {
    const transport = createMockTransport();
    transport.setFailureMode("insufficient-balance");
    const result = await transport.submitTurn(submitRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("insufficient-balance");
      expect(result.error.retryable).toBe(false);
    }
    expect(transport.generationCount).toBe(0);
  });
});
